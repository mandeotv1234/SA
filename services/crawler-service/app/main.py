import os
import asyncio
import hashlib
import logging
import time
from functools import partial
from urllib.parse import urlparse, urljoin
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI
from pydantic import BaseModel
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import redis
from email.utils import parsedate_to_datetime

from app.db import init_db, get_active_sources, update_source_status
from app.services.discovery import get_links_from_rss, get_links_from_html
from app.services.extractor import smart_extract
from app.kafka_producer import produce_news, close_producer, create_startup_topics

LOG = logging.getLogger("crawler.main")
if not logging.getLogger().hasHandlers():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
    )

app = FastAPI(title="Crawler Service")

class CrawlRequest(BaseModel):
    url: str

# Redis & Config
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
CRAWL_INTERVAL = int(os.getenv("CRAWL_INTERVAL_SECONDS", "300"))
REDIS_TTL = int(os.getenv("CRAWLER_REDIS_TTL", str(7 * 24 * 3600)))
CRAWLER_PER_HOST_DELAY = float(os.getenv("CRAWLER_PER_HOST_DELAY", "2.0"))
CRAWLER_HOST_COOLDOWN = int(os.getenv('CRAWLER_HOST_COOLDOWN_SECONDS', '3600'))

redis_client = redis.from_url(REDIS_URL)

_per_host_last_request: dict[str, float] = {}
_host_block_until: dict[str, float] = {}

def _make_session() -> requests.Session:
    s = requests.Session()
    retries = Retry(total=2, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504], allowed_methods=["HEAD", "GET", "OPTIONS"])
    adapter = HTTPAdapter(max_retries=retries)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update({"User-Agent": "crawler-service/1.0 (Refined Architecture)"})
    return s

session = _make_session()

def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode('utf-8')).hexdigest()

async def process_article_task(item: dict):
    """Async task to extract and publish article."""
    url = item.get('link')
    if not url: return

    key = f"crawler:seen:{_url_hash(url)}"
    if redis_client.exists(key):
        return

    # Check directly provided content first (RSS optimization)
    # If we have title + long content, we can skip fetching!
    if item.get('manual_content') and item.get('manual_title') and len(item['manual_content']) > 500:
        if "Google News" in item['manual_title']:
            LOG.info(f"Skipping Google News aggregator: {url}")
            return

        LOG.info(f"Using direct RSS content for {url}")
        
        # Use our extractor helpers just to clean/parse date if needed
        # Or construct payload directly
        payload = {
            'source': urlparse(url).netloc.replace("www.", ""),
            'url': url,
            'title': item['manual_title'],
            'content': item['manual_content'], # This might be HTML, refined by consumer or basic cleanup
            'published_at': item.get('manual_date'),
            'category': 'Crypto', # Default or inference
            'symbol': 'BTCUSDT',  # Simplify for now or run regex
            'sentiment': 'Neutral',
            'relevance_score': 1.0 # High confidence since it's from feed
        }
        
        # We might want to run symbol detection on the content
        # from app.modules.llm_fallback import _detect_symbols
        # but importing might check logic. Let's do basic cleanup.
        
        produce_news(payload)
        LOG.info(f"Published (RSS Direct): {payload['title']}")
        redis_client.set(key, 1, ex=REDIS_TTL)
        return

    # Fallback to standard Fetch & Extract
    host = urlparse(url).netloc
    
    # Check block
    now = time.monotonic()
    if block_until := _host_block_until.get(host):
        if now < block_until:
            return

    loop = asyncio.get_running_loop()
    try:
        resp = await loop.run_in_executor(None, partial(session.get, url, timeout=20))
        if resp.status_code == 429:
             _host_block_until[host] = time.monotonic() + 60
             return
        resp.raise_for_status()
        html = resp.text
        
        # 2. Extract
        data = await loop.run_in_executor(None, partial(smart_extract, url, html))
        
        if not data or not data.get('title'):
             LOG.warning(f"Skipping {url}: extraction incomplete")
             return
             
        # 3. Publish
        payload = {
            'source': host.replace("www.", ""),
            'url': url,
            'title': data.get('title'),
            'content': data.get('content'),
            'published_at': data.get('date'),
            'symbol': data.get('symbols', ['BTCUSDT'])[0] if data.get('symbols') else None,
            'category': data.get('category', 'General'),
            'sentiment': data.get('sentiment', 'Neutral'),
            'relevance_score': data.get('relevance_score', 0.5)
        }
        
        produce_news(payload)
        LOG.info(f"Published: {payload['title']} ({url})")
        
        redis_client.set(key, 1, ex=REDIS_TTL)
        
    except Exception as e:
        LOG.error(f"Error processing {url}: {e}")

async def crawl_cycle():
    """Discover links from all active sources."""
    sources = get_active_sources()
    if not sources:
        LOG.info("No active sources in DB (crawl_sources collection).")
        return

    LOG.info(f"Starting discovery on {len(sources)} sources.")
    all_items = []
    
    for src in sources:
        url = src['url']
        src_type = src.get('source_type', 'html')
        
        # Check host blocks
        host = urlparse(url).netloc
        now = time.monotonic()
        if block_until := _host_block_until.get(host):
            if now < block_until:
                continue

        # Politeness wait
        last = _per_host_last_request.get(host)
        if last:
            wait = CRAWLER_PER_HOST_DELAY - (now - last)
            if wait > 0:
                await asyncio.sleep(wait)

        # Discovery
        found_items = []
        try:
            loop = asyncio.get_running_loop()
            if src_type == 'rss':
                found_items = await loop.run_in_executor(None, partial(get_links_from_rss, url, session))
            else:
                # HTML discovery requies fetch
                resp = await loop.run_in_executor(None, partial(session.get, url, timeout=20))
                _per_host_last_request[host] = time.monotonic()
                if resp.status_code == 200:
                    found_items = await loop.run_in_executor(None, partial(get_links_from_html, url, resp.text))
            
            update_source_status(url, error=False)
        except Exception as e:
            LOG.error(f"Discovery failed for {url}: {e}")
            update_source_status(url, error=True)
            continue
            
        all_items.extend(found_items)

    # Process links (Dedup happens in process_article_task via Redis)
    # Be gentle with concurrency
    sem = asyncio.Semaphore(10)
    
    async def _sem_task(item):
        async with sem:
            await process_article_task(item)
            
    await asyncio.gather(*[_sem_task(i) for i in all_items])

_bg_task = None

@app.on_event('startup')
async def startup_event():
    LOG.info("Crawler Service v2.0 Starting...")
    init_db()
    create_startup_topics()
    
    loop = asyncio.get_running_loop()
    async def _loop():
        while True:
            try:
                await crawl_cycle()
            except Exception:
                LOG.exception("Cycle failed")
            await asyncio.sleep(CRAWL_INTERVAL)
            
    global _bg_task
    _bg_task = loop.create_task(_loop())

@app.on_event('shutdown')
async def shutdown_event():
    if _bg_task:
        _bg_task.cancel()
    close_producer()
    session.close()
    LOG.info("Crawler Stopped.")

@app.post('/crawl/')
async def crawl_endpoint(req: CrawlRequest):
    asyncio.create_task(process_article_task(req.url))
    return {"status": "queued"}

@app.get('/health')
def health():
    return {"status": "ok"}
