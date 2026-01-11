import os
import asyncio
import hashlib
import logging
import time
from functools import partial
from urllib.parse import urlparse, urljoin

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from bs4 import BeautifulSoup
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone, timedelta
import urllib3.exceptions as urllib3_exceptions
from requests.exceptions import RetryError as RequestsRetryError
import redis
from dateutil import parser as dateparser

from app.modules.crawler import adaptive_crawl
from app.kafka_producer import produce_news, close_producer, create_startup_topics

LOG = logging.getLogger("crawler.main")

if not logging.getLogger().hasHandlers():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
    )

# ensure this module logger has a level and at least one handler
LOG.setLevel(getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO))
if not LOG.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    LOG.addHandler(handler)
LOG.propagate = True

app = FastAPI(title="Crawler Service")


class CrawlRequest(BaseModel):
    url: str


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
SOURCES = os.getenv("CRAWL_SOURCES", "https://www.coindesk.com/arc/outboundfeeds/rss/,https://vnexpress.net")
CRAWL_INTERVAL = int(os.getenv("CRAWL_INTERVAL_SECONDS", str(1 * 60)))
REDIS_TTL = int(os.getenv("CRAWLER_REDIS_TTL", str(7 * 24 * 3600)))
# politeness: minimal seconds between requests to the same host
CRAWLER_PER_HOST_DELAY = float(os.getenv("CRAWLER_PER_HOST_DELAY", "2.0"))

redis_client = redis.from_url(REDIS_URL)


def _make_session() -> requests.Session:
    s = requests.Session()
    # Retry config: retry on common transient errors and 429
    # NOTE: remove 429 from status_forcelist so we can handle 429 explicitly
    retries = Retry(total=2, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504], allowed_methods=["HEAD", "GET", "OPTIONS"])
    adapter = HTTPAdapter(max_retries=retries)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    # default header
    s.headers.update({"User-Agent": "crawler-service/1.0"})
    return s


# shared session used for discovery and fetches
session = _make_session()

# per-host last request time to enforce politeness
_per_host_last_request: dict[str, float] = {}
# hosts temporarily blocked due to anti-bot/rate-limit responses
_host_block_until: dict[str, float] = {}

# cooldown when a host shows anti-bot page (seconds)
CRAWLER_HOST_COOLDOWN = int(os.getenv('CRAWLER_HOST_COOLDOWN_SECONDS', '3600'))


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode('utf-8')).hexdigest()


def _get_source_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower().replace('www.', '')
    return host


def _extract_symbol(text: str) -> str | None:
    if not text:
        return None
    text_upper = text.upper()
    # Simple mapping for demonstration; can be expanded or moved to config
    if 'BITCOIN' in text_upper or 'BTC' in text_upper:
        return 'BTCUSDT'
    if 'ETHEREUM' in text_upper or 'ETH' in text_upper:
        return 'ETHUSDT'
    if 'DOGECOIN' in text_upper or 'DOGE' in text_upper:
        return 'DOGEUSDT'
    if 'SOLANA' in text_upper or 'SOL' in text_upper:
        return 'SOLUSDT'
    if 'BNB' in text_upper:
        return 'BNBUSDT'
    return None


async def process_url_if_new(url: str):
    key = f"crawler:url:{_url_hash(url)}"
    try:
        exists = redis_client.exists(key)
    except Exception:
        # If Redis fails, proceed but avoid crashing
        exists = 0
    if exists:
        LOG.debug("Skipping known URL %s", url)
        return
    # mark as seen with TTL
    try:
        redis_client.set(key, 1, ex=REDIS_TTL)
    except Exception:
        LOG.exception("Failed to set redis key for %s", url)

    # extract content using thread executor so heavy CPU / blocking libs don't block the event loop
    loop = asyncio.get_running_loop()
    try:
        func = partial(adaptive_crawl, url, session)
        data = await loop.run_in_executor(None, func)
    except Exception:
        LOG.exception("adaptive_crawl failed for %s", url)
        return
    # log extraction outcome for visibility
    content = data.get('content') if isinstance(data, dict) else None
    if not data or data.get('error'):
        LOG.warning("Failed to extract %s: %s", url, data)
        return
    # if content exists, log length; otherwise note fallback or empty
    if content and isinstance(content, str) and len(content) > 0:
        LOG.info("Extracted content from %s (len=%d)", url, len(content))
    else:
        LOG.info("Extraction returned no content for %s; data keys=%s", url, list(data.keys()) if isinstance(data, dict) else type(data))

    # normalize published_at
    published = data.get('date') or data.get('published_at') or None
    published_iso = None
    if published:
        try:
            published_iso = dateparser.parse(published).isoformat()
        except Exception:
            published_iso = None

    # Extract symbol from title + content
    full_text = (data.get('title') or '') + ' ' + (data.get('content') or '')
    symbol = _extract_symbol(full_text)
    
    if not symbol and len(full_text) > 100:
        LOG.info("No symbol found in article: %s (len=%d). Text snippet: %s", url, len(full_text), full_text[:100])

    payload = {
        'source': _get_source_from_url(url),
        'url': url,
        'title': data.get('title'),
        'content': data.get('content'),
        'published_at': published_iso,
        'symbol': symbol,
        'sentiment': data.get('sentiment'),
        'user_rating': data.get('user_rating'),
        'category': data.get('category'),
        'relevance_score': data.get('relevance_score')
    }

    try:
        produce_news(payload)
        LOG.info("Published news: %s (title=%s, symbol=%s)", url, payload.get('title'), symbol)
    except Exception:
        LOG.exception("Failed publishing %s", url)


# DB Config
DB_HOST = os.getenv("POSTGRES_HOST", "postgres")
DB_NAME = os.getenv("POSTGRES_DB", "appdb")
DB_USER = os.getenv("POSTGRES_USER", "dev")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "dev")

import psycopg2
from psycopg2.extras import RealDictCursor

def get_active_sources():
    """Fetch active crawl sources from Postgres."""
    sources = []
    # Default env sources as fallback
    env_sources = [s.strip() for s in os.getenv("CRAWL_SOURCES", "").split(',') if s.strip()]
    sources.extend(env_sources)

    try:
        conn = psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASSWORD)
        with conn.cursor() as cur:
            cur.execute("SELECT url FROM crawl_sources WHERE is_active = TRUE")
            rows = cur.fetchall()
            for r in rows:
                if r[0] not in sources:
                    sources.append(r[0])
        conn.close()
    except Exception as e:
        LOG.error(f"Failed to fetch sources from DB: {e}")
    
    return list(set(sources))

async def discover_and_queue_once():
    """Discover candidate article URLs from configured sources and process them."""
    sources = get_active_sources()
    LOG.info(f"Active sources: {len(sources)}")
    
    tasks = []
    for s in sources:
        try:
            # check if host is temporarily blocked due to anti-bot/rate-limit
            LOG.info("Starting discovery on source %s", s)
            host = urlparse(s).netloc
            now = time.monotonic()
            blocked_until = _host_block_until.get(host)
            if blocked_until and now < blocked_until:
                remaining = int(blocked_until - now)
                LOG.info("Skipping discovery for %s; host blocked for %ds due to previous anti-bot detection", host, remaining)
                continue

            # enforce per-host politeness
            last = _per_host_last_request.get(host)
            if last:
                wait = CRAWLER_PER_HOST_DELAY - (now - last)
                if wait > 0:
                    LOG.debug("Waiting %.2fs to respect politeness to %s", wait, host)
                    await asyncio.sleep(wait)

            loop = asyncio.get_running_loop()
            p = partial(session.get, s, timeout=15, headers={"User-Agent": "crawler-service/1.0"})
            try:
                resp = await loop.run_in_executor(None, p)
            except (RequestsRetryError, urllib3_exceptions.MaxRetryError) as e:
                # Session exhausted its retries (often too many 429/responses) — back off and continue
                LOG.warning("Max retries reached for %s: %s. Backing off for %ds", s, e, int(CRAWLER_PER_HOST_DELAY * 5))
                await asyncio.sleep(CRAWLER_PER_HOST_DELAY * 5)
                continue
            except Exception as e:
                LOG.exception("HTTP request failed for %s: %s", s, e)
                continue

            _per_host_last_request[host] = time.monotonic()

            if resp.status_code == 429:
                # Detailed handling & logging for 429 Too Many Requests
                ra = resp.headers.get('Retry-After')
                ra_seconds = 60
                if ra:
                    try:
                        # numeric seconds
                        ra_seconds = int(ra)
                    except Exception:
                        try:
                            # HTTP-date format
                            dt = parsedate_to_datetime(ra)
                            if dt.tzinfo is None:
                                dt = dt.replace(tzinfo=timezone.utc)
                            now_dt = datetime.now(timezone.utc)
                            delta = (dt - now_dt).total_seconds()
                            ra_seconds = max(0, int(delta))
                        except Exception:
                            ra_seconds = 60

                # collect common rate-limit headers for debugging
                rl_headers = {h: resp.headers.get(h) for h in ('Retry-After', 'X-RateLimit-Remaining', 'X-RateLimit-Limit', 'X-RateLimit-Reset', 'Server')}
                # small snippet of response body to aid debugging (server may include human-readable reason)
                snippet = None
                try:
                    snippet = resp.text.strip().replace('\n', ' ')[:300]
                except Exception:
                    snippet = '<unreadable body>'

                LOG.warning("Received 429 (Too Many Requests) from %s; sleeping %ds per Retry-After. rate-headers=%s; snippet=%s",
                            s, ra_seconds, rl_headers, snippet)
                LOG.info("HTTP 429 means the remote site is rate-limiting requests (too many requests from this client). "
                         "Common causes: frequent polling from the same IP, crawling without respect to robots.txt or APIs, or transient spikes. "
                         "Consider increasing CRAWLER_PER_HOST_DELAY, using site RSS/sitemaps, or honoring Retry-After headers.")

                # detect common anti-bot markers (Cloudflare, Vercel security checkpoint, captcha)
                lc_snip = (snippet or '').lower()
                server_hdr = (rl_headers.get('Server') or '').lower()
                is_anti_bot = False
                if 'cloudflare' in server_hdr or 'vercel' in lc_snip or 'security checkpoint' in lc_snip or 'captcha' in lc_snip or 'please enable javascript' in lc_snip:
                    is_anti_bot = True

                if is_anti_bot:
                    # mark host blocked for a longer cooldown so we stop spamming the protection system
                    _host_block_until[host] = time.monotonic() + CRAWLER_HOST_COOLDOWN
                    unblock_dt = datetime.now(timezone.utc) + timedelta(seconds=CRAWLER_HOST_COOLDOWN)
                    LOG.warning("Anti-bot detected for %s; marking blocked until %s (cooldown %ds).", host, unblock_dt.isoformat(), CRAWLER_HOST_COOLDOWN)
                    LOG.info("Suggestion: use RSS/sitemap or site API for %s, increase CRAWLER_PER_HOST_DELAY, or rotate IPs if you have permission.", host)
                    await asyncio.sleep(max(ra_seconds, int(CRAWLER_PER_HOST_DELAY * 2)))
                    continue

                await asyncio.sleep(max(ra_seconds, int(CRAWLER_PER_HOST_DELAY * 2)))
                continue

            resp.raise_for_status()
            html = resp.text
            parser = 'xml' if html.lstrip().startswith('<?xml') else 'html.parser'
            soup = BeautifulSoup(html, parser)
            anchors = soup.find_all('a', href=True)
            seen = set()
            count = 0
            for a in anchors:
                href = a['href']
                if href.startswith('javascript:') or href.startswith('#'):
                    continue
                # normalize
                full = urljoin(s, href)
                parsed_src = urlparse(full)
                if not parsed_src.scheme.startswith('http'):
                    continue
                # simple heuristics: same host or path contains keywords
                if parsed_src.netloc.replace('www.', '') != urlparse(s).netloc.replace('www.', ''):
                    # allow some cross-host links? skip for now
                    continue
                if full in seen:
                    continue
                seen.add(full)
                # heuristics: avoid assets and short urls
                path = parsed_src.path.lower()
                if any(ext in path for ext in ['.jpg', '.png', '.mp4', '.pdf', '.css', '.js']):
                    continue
                if len(path) < 3:
                    continue
                
                # EXCLUSION PATTERNS: Skip non-article pages
                exclude_patterns = [
                    '/tag/', '/category/', '/tags/', '/categories/',  # Category/tag pages
                    '/app', '/download', '/vne-go', '/ung-dung',      # App download pages
                    '/about', '/contact', '/lien-he', '/gioi-thieu',  # Static pages
                    '/login', '/register', '/dang-nhap', '/dang-ky',  # Auth pages
                    '/search', '/tim-kiem', '/rss', '/feed',          # Utility pages
                    '/author/', '/tac-gia/', '/video/', '/podcast/',  # Media/author pages
                    '/lich-van-nien', '/thoi-tiet', '/weather',       # Irrelevant tools
                    '/quang-cao', '/advertising', '/subscribe',       # Ads/subscription
                ]
                if any(excl in path for excl in exclude_patterns):
                    continue
                
                # for news-like links, many sites include year/month or /news/
                # refined filtering for high-relevance financial news
                relevant_keywords = [
                    '/news/', '/article/', '/tin-tuc/', '/bai-viet/',
                    '/2024/', '/2025/', '/2026/',  # Year patterns
                    '/bitcoin', '/ethereum', '/crypto', '/btc', '/eth',
                    '/market', '/finance', '/tai-chinh', '/kinh-te',
                    '/policy', '/fed', '/rate', '/bank', '/ngan-hang',
                    '/breaking/', '/analysis/', '/phan-tich/'
                ]
                if any(k in path for k in relevant_keywords):
                    tasks.append(full)
                    count += 1
                elif count < 10:  # Reduced from 20 to be more selective
                    # allow some additional links up to 10
                    tasks.append(full)
                    count += 1
                if count >= 100:  # Reduced from 200 for quality over quantity
                    break
        except Exception:
            LOG.exception("Failed discovery on %s", s)
        else:
            LOG.info("Discovered %d candidate links from %s", count, s)

    # deduplicate tasks globally
    unique = []
    seenu = set()
    for u in tasks:
        if u in seenu: continue
        seenu.add(u)
        unique.append(u)

    # process sequentially or with limited concurrency
    sem = asyncio.Semaphore(1)

    async def _proc(u):
        async with sem:
            await process_url_if_new(u)

    await asyncio.gather(*[_proc(u) for u in unique])


_bg_task = None


@app.on_event('startup')
async def startup_event():
    LOG.info('Crawler starting up, connecting to Redis %s', REDIS_URL)
    
    # Ensure Kafka topics exist
    try:
        create_startup_topics()
    except Exception as e:
        LOG.warning("Failed to create startup topics: %s", e)

    loop = asyncio.get_event_loop()

    async def _loop():
        while True:
            try:
                await discover_and_queue_once()
            except Exception:
                LOG.exception('Discovery iteration failed')
            await asyncio.sleep(CRAWL_INTERVAL)

    global _bg_task
    _bg_task = loop.create_task(_loop())


@app.on_event('shutdown')
async def shutdown_event():
    LOG.info('Crawler shutting down')
    if _bg_task:
        _bg_task.cancel()
        try:
            await _bg_task
        except asyncio.CancelledError:
            pass
    # flush kafka
    try:
        close_producer()
    except Exception:
        LOG.exception('Error closing producer')
    # close requests session
    try:
        session.close()
    except Exception:
        LOG.exception('Error closing HTTP session')


@app.post('/crawl/')
async def crawl(req: CrawlRequest):
    url = req.url
    await process_url_if_new(url)
    return {"status": "queued", "url": url}


@app.get('/health')
def health():
    return {"alive": True}
