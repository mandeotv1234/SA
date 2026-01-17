"""
Heuristic-based content extraction without LLM.
Uses BeautifulSoup + trafilatura for fast extraction.
"""
import logging
from typing import Dict
from bs4 import BeautifulSoup
from dateutil import parser as dateparser
import trafilatura

LOG = logging.getLogger("crawler.extraction")

# Keywords for relevance and category detection
CRYPTO_KEYWORDS = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain',
    'binance', 'coinbase', 'defi', 'nft', 'altcoin', 'token',
    'solana', 'sol', 'bnb', 'doge', 'dogecoin', 'xrp', 'ripple',
    'fed', 'federal reserve', 'interest rate', 'inflation', 'cpi',
    'sec', 'regulation', 'etf', 'halving', 'whale', 'liquidation'
]

SYMBOL_MAPPING = {
    'bitcoin': 'BTCUSDT', 'btc': 'BTCUSDT',
    'ethereum': 'ETHUSDT', 'eth': 'ETHUSDT',
    'solana': 'SOLUSDT', 'sol': 'SOLUSDT',
    'bnb': 'BNBUSDT', 'binance coin': 'BNBUSDT',
    'dogecoin': 'DOGEUSDT', 'doge': 'DOGEUSDT',
    'xrp': 'XRPUSDT', 'ripple': 'XRPUSDT',
    'cardano': 'ADAUSDT', 'ada': 'ADAUSDT',
}


def _extract_title(soup: BeautifulSoup, html: str) -> str:
    """Extract title using multiple strategies."""
    # Try og:title
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        return og_title["content"].strip()
    
    # Try <title>
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    
    # Try h1
    h1 = soup.find("h1")
    if h1:
        return h1.get_text().strip()
    
    return "Untitled"


def _extract_date(soup: BeautifulSoup) -> str | None:
    """Extract publication date from HTML."""
    for name in ("date", "pubdate", "publishdate", "article:published_time", 
                 "og:pubdate", "og:published_time", "article:published"):
        tag = soup.find("meta", {"name": name}) or soup.find("meta", {"property": name})
        if tag and tag.get("content"):
            try:
                return dateparser.parse(tag["content"]).isoformat()
            except:
                pass
    
    time_tag = soup.find('time')
    if time_tag:
        dt = time_tag.get('datetime') or time_tag.get_text().strip()
        if dt:
            try:
                return dateparser.parse(dt).isoformat()
            except:
                pass
    return None


def _extract_content(html: str) -> str:
    """Extract main content using trafilatura."""
    content = trafilatura.extract(html)
    if content:
        return content[:5000]  # Limit length
    return ""


def _detect_symbols(text: str) -> list:
    """Detect which crypto symbols are mentioned in the text."""
    text_lower = text.lower()
    detected = set()
    for keyword, symbol in SYMBOL_MAPPING.items():
        if keyword in text_lower:
            detected.add(symbol)
    return list(detected) if detected else ['BTCUSDT']  # Default to BTC


def _calculate_relevance(text: str) -> float:
    """Calculate relevance score based on keyword density."""
    text_lower = text.lower()
    count = sum(1 for kw in CRYPTO_KEYWORDS if kw in text_lower)
    # Base 0.3, +0.1 per keyword, max 1.0
    return min(1.0, 0.3 + count * 0.1)


def _detect_sentiment(text: str) -> str:
    """Simple keyword-based sentiment detection."""
    text_lower = text.lower()
    positive = ['tăng', 'surge', 'bullish', 'rally', 'gain', 'profit', 'ath', 'breakout', 'soar']
    negative = ['giảm', 'crash', 'bearish', 'dump', 'loss', 'scam', 'hack', 'ban', 'plunge', 'correction']
    
    pos = sum(1 for w in positive if w in text_lower)
    neg = sum(1 for w in negative if w in text_lower)
    
    if pos > neg + 1:
        return "Positive"
    elif neg > pos + 1:
        return "Negative"
    return "Neutral"


def extract_with_heuristics(html: str, url: str) -> Dict:
    """
    Extract article content using heuristics only.
    No LLM calls - fast and efficient.
    """
    try:
        soup = BeautifulSoup(html, "html.parser")
        
        title = _extract_title(soup, html)
        date = _extract_date(soup)
        content = _extract_content(html)
        
        if not content or len(content) < 100:
            # Fallback: get paragraphs
            paragraphs = [p.get_text().strip() for p in soup.find_all("p") if len(p.get_text().strip()) > 50]
            content = "\n\n".join(paragraphs[:10])[:5000]
        
        full_text = f"{title} {content}"
        
        symbols = _detect_symbols(full_text)
        relevance = _calculate_relevance(full_text)
        sentiment = _detect_sentiment(full_text)
        
        # Determine category
        if relevance >= 0.5:
            category = "Crypto"
        elif relevance >= 0.4:
            category = "Finance"
        else:
            category = "General"
        
        LOG.info(f"Extracted: {title[:50]}... | symbols={symbols} | rel={relevance:.2f}")
        
        return {
            "title": title,
            "date": date,
            "content": content,
            "category": category,
            "relevance_score": round(relevance, 2),
            "sentiment": sentiment,
            "symbols": symbols,
            "url": url
        }
        
    except Exception as e:
        LOG.error(f"Extraction failed for {url}: {e}")
        return {
            "error": "extraction_failed",
            "detail": str(e),
            "url": url
        }
