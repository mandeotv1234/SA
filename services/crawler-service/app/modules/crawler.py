import trafilatura
import requests
from .llm_fallback import extract_with_llm
from bs4 import BeautifulSoup
from typing import Dict
from dateutil import parser as dateparser


def _simple_meta_extract(html: str) -> Dict:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    date = None
    # try common meta names and properties
    for name in ("date", "pubdate", "publishdate", "article:published_time", "og:pubdate", "og:published_time", "article:published", "timestamp"):
        tag = soup.find("meta", {"name": name}) or soup.find("meta", {"property": name}) or soup.find("meta", {"itemprop": name})
        if tag and tag.get("content"):
            date = tag["content"]
            break
    # sometimes time tag present
    if not date:
        time_tag = soup.find('time')
        if time_tag and time_tag.get('datetime'):
            date = time_tag.get('datetime')
        elif time_tag:
            date = time_tag.get_text().strip()

    text = trafilatura.extract(html) or ""

    # normalize date to ISO if possible
    published_iso = None
    if date:
        try:
            published_iso = dateparser.parse(date).isoformat()
        except Exception:
            published_iso = None

    return {"title": title, "date": published_iso, "content": text}


def adaptive_crawl(url: str, session: requests.sessions.Session | None = None) -> Dict:
    """Fetch and extract content from URL.

    If a requests.Session is provided it will be used (so callers can share retry/adapters).
    This function is synchronous by design and intended to be run in a thread executor from async code.
    """
    client = session or requests
    try:
        r = client.get(url, timeout=15, headers={"User-Agent": "crawler-service/1.0"})
        r.raise_for_status()
        html = r.text
        
        # Always use LLM extraction to ensure we get Category, Relevance, Sentiment, etc.
        # The extract_with_llm function handles its own fallback to heuristics if needed.
        return extract_with_llm(html, url)
        
    except Exception as e:
        return {"error": "fetch_failed", "detail": str(e), "url": url}
