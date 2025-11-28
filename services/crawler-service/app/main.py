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
from app.kafka_producer import produce_news, close_producer

LOG = logging.getLogger("crawler.main")

app = FastAPI(title="Crawler Service")


class CrawlRequest(BaseModel):
    url: str


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
SOURCES = os.getenv("CRAWL_SOURCES", "https://www.coindesk.com,https://vnexpress.net")
CRAWL_INTERVAL = int(os.getenv("CRAWL_INTERVAL_SECONDS", str(15 * 60)))
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

    payload = {
        'source': _get_source_from_url(url),
        'url': url,
        'title': data.get('title'),
        'content': data.get('content'),
        'published_at': published_iso,
    }

    try:
        produce_news(payload)
        LOG.info("Published news: %s (title=%s)", url, payload.get('title'))
    except Exception:
        LOG.exception("Failed publishing %s", url)


async def discover_and_queue_once():
    """Discover candidate article URLs from configured sources and process them."""
    sources = [s.strip() for s in SOURCES.split(',') if s.strip()]
    tasks = []
    for s in sources:
        try:
            # check if host is temporarily blocked due to anti-bot/rate-limit
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
            soup = BeautifulSoup(html, 'html.parser')
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
                if any(ext in path for ext in ['.jpg', '.png', '.mp4', '.pdf']):
                    continue
                if len(path) < 3:
                    continue
                # for news-like links, many sites include year/month or /news/
                if any(k in path for k in ['/news', '/article', '/tin-', '/202', '/20']):
                    tasks.append(full)
                    count += 1
                elif count < 20:
                    # allow some additional links up to 20
                    tasks.append(full)
                    count += 1
                if count >= 200:
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
    sem = asyncio.Semaphore(10)

    async def _proc(u):
        async with sem:
            await process_url_if_new(u)

    await asyncio.gather(*[_proc(u) for u in unique])


_bg_task = None


@app.on_event('startup')
async def startup_event():
    LOG.info('Crawler starting up, connecting to Redis %s', REDIS_URL)

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
