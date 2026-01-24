import logging
import feedparser
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
import requests

LOG = logging.getLogger("crawler.discovery")

def get_links_from_rss(url: str, session: requests.Session) -> list[dict]:
    """
    Fetch RSS feed and return items.
    Returns list of dict: {link: str, content: str|None, title: str|None, date: str|None}
    """
    try:
        resp = session.get(url, timeout=15)
        resp.raise_for_status()
        
        feed = feedparser.parse(resp.content)
        items = []
        for entry in feed.entries:
            link = entry.get('link')
            if not link:
                continue
                
            # RSS often contains full content in 'content' or 'summary'
            # Check content:encoded (feedparser maps this to 'content')
            full_content = None
            if hasattr(entry, 'content'):
                # entry.content is a list of dicts, e.g. [{'type': 'text/html', 'value': '...'}]
                for c in entry.content:
                    if c.get('value') and len(c.get('value')) > 200:
                        full_content = c.get('value')
                        break
            
            # If not in content, check summary (description)
            if not full_content and hasattr(entry, 'summary'):
                 if len(entry.summary) > 300: # heuristic: if long, might be full content
                     full_content = entry.summary

            # Title
            title = entry.get('title')
            # Date
            pub_date = entry.get('published') or entry.get('updated')
            
            items.append({
                "link": link,
                "manual_content": full_content,
                "manual_title": title,
                "manual_date": pub_date
            })
        
        LOG.info(f"Discovered {len(items)} items from RSS {url}")
        return items
    except Exception as e:
        LOG.error(f"Failed to parse RSS {url}: {e}")
        return []

def get_links_from_html(url: str, html: str) -> list[dict]:
    """Discover links from HTML."""
    soup = BeautifulSoup(html, "html.parser")
    anchors = soup.find_all('a', href=True)
    links = []
    base_domain = urlparse(url).netloc
    
    seen = set()
    
    for a in anchors:
        href = a['href']
        if href.startswith('javascript:') or href.startswith('#'):
            continue
            
        full = urljoin(url, href)
        parsed = urlparse(full)
        
        if parsed.netloc != base_domain:
            continue
            
        if full in seen:
            continue
        
        path = parsed.path.lower()
        exclude_patterns = ['/tag/', '/category/', '/login', '/register', '/search', '/about', '.pdf']
        if any(ex in path for ex in exclude_patterns):
            continue
        
        # Keywords
        relevant = ['/news/', '/article/', '.html', '-', '/202', '/market/', '/finance/']
        if len(path) > 10 or any(k in path for k in relevant):
             seen.add(full)
             links.append({"link": full})
             
    return links
