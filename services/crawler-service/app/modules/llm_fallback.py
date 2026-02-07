"""
Heuristic-based content extraction without LLM.
Uses BeautifulSoup + trafilatura for fast extraction.
"""
import logging
from typing import Dict
from bs4 import BeautifulSoup
from dateutil import parser as dateparser
import trafilatura
import os
import json
import requests
import re

LOG = logging.getLogger("crawler.extraction")

# Keywords for relevance and category detection
CRYPTO_KEYWORDS = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain',
    'binance', 'coinbase', 'defi', 'nft', 'altcoin', 'token',
    'solana', 'sol', 'bnb', 'doge', 'dogecoin', 'xrp', 'ripple',
    'fed', 'federal reserve', 'interest rate', 'inflation', 'cpi',
    'sec', 'regulation', 'etf', 'halving', 'whale', 'liquidation',
    'tài sản mã hóa', 'tiền mã hóa', 'tiền điện tử', 'sàn giao dịch'
]

# High-impact keywords that significantly boost relevance
HIGH_IMPACT_KEYWORDS = [
    'cấp phép', 'giấy phép', 'phê duyệt', 'hợp pháp hóa', 'thí điểm',
    'license', 'approval', 'legalize', 'etf', 'sec approval',
    'institutional adoption', 'regulatory', 'government', 'central bank',
    'ngân hàng trung ương', 'chính phủ', 'bộ tài chính', 'quy định'
]

SYMBOL_MAPPING = {
    # Bitcoin
    'bitcoin': 'BTCUSDT', 'btc': 'BTCUSDT',
    # Ethereum
    'ethereum': 'ETHUSDT', 'eth': 'ETHUSDT', 'ether': 'ETHUSDT',
    # Solana
    'solana': 'SOLUSDT', 'sol': 'SOLUSDT',
    # Binance Coin
    'bnb': 'BNBUSDT', 'binance coin': 'BNBUSDT', 'binance': 'BNBUSDT',
    # Dogecoin
    'dogecoin': 'DOGEUSDT', 'doge': 'DOGEUSDT',
    # XRP/Ripple
    'xrp': 'XRPUSDT', 'ripple': 'XRPUSDT',
    # Cardano
    'cardano': 'ADAUSDT', 'ada': 'ADAUSDT',
    # Avalanche
    'avalanche': 'AVAXUSDT', 'avax': 'AVAXUSDT',
    # Polkadot
    'polkadot': 'DOTUSDT', 'dot': 'DOTUSDT',
    # Polygon
    'polygon': 'POLUSDT', 'matic': 'POLUSDT', 'pol': 'POLUSDT',
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
        return content
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
    """
    Calculate relevance score based on keyword density and impact.
    High-impact keywords (regulatory, adoption) significantly boost score.
    """
    text_lower = text.lower()
    
    # Count high-impact keywords (worth 0.3 each)
    high_impact_count = sum(1 for kw in HIGH_IMPACT_KEYWORDS if kw in text_lower)
    
    # Count regular crypto keywords (worth 0.1 each)
    crypto_count = sum(1 for kw in CRYPTO_KEYWORDS if kw in text_lower)
    
    # Calculate score
    # High impact: 0.3 per keyword (regulatory/adoption news)
    # Regular: 0.1 per keyword (general crypto mentions)
    # Base: 0.2 (minimum for any crypto-related article)
    score = 0.2 + (high_impact_count * 0.3) + (crypto_count * 0.1)
    
    return min(1.0, round(score, 2))


def _detect_sentiment(text: str) -> tuple[str, float]:
    """
    Enhanced sentiment detection with numeric score.
    Returns: (label, score) where score is -1.0 to +1.0
    """
    text_lower = text.lower()
    
    # Expanded keyword lists with weights
    very_positive = ['cấp phép', 'phê duyệt', 'hợp pháp hóa', 'thông qua', 'chấp thuận', 
                     'approval', 'approved', 'legalize', 'adoption', 'breakthrough', 
                     'ath', 'all-time high', 'moon', 'bullrun']
    positive = ['tăng', 'surge', 'bullish', 'rally', 'gain', 'profit', 'breakout', 'soar',
                'tích cực', 'lạc quan', 'tăng trưởng', 'phát triển', 'mở rộng', 'tiềm năng',
                'rise', 'growth', 'expand', 'potential', 'opportunity', 'buy', 'accumulation']
    
    very_negative = ['scam', 'hack', 'fraud', 'bankruptcy', 'ban', 'cấm', 'lừa đảo', 
                     'phá sản', 'crash', 'collapse', 'sụp đổ']
    negative = ['giảm', 'bearish', 'dump', 'plunge', 'drop', 'fall', 'decline', 'loss',
                'tiêu cực', 'lo ngại', 'rủi ro', 'cảnh báo', 'suy giảm', 'correction',
                'sell', 'liquidation', 'fear', 'panic', 'warning', 'risk', 'concern']
    
    # Count matches with weights
    very_pos_count = sum(1 for kw in very_positive if kw in text_lower)
    pos_count = sum(1 for kw in positive if kw in text_lower)
    very_neg_count = sum(1 for kw in very_negative if kw in text_lower)
    neg_count = sum(1 for kw in negative if kw in text_lower)
    
    # Calculate weighted score
    # Very positive/negative keywords have 2x weight
    pos_score = (very_pos_count * 2) + pos_count
    neg_score = (very_neg_count * 2) + neg_count
    
    total = pos_score + neg_score
    
    if total == 0:
        return ("Neutral", 0.0)
    
    # Calculate normalized score (-1 to +1)
    raw_score = (pos_score - neg_score) / total
    
    # Apply sigmoid-like scaling for more granular scores
    # This prevents extreme -1/+1 unless very strong signals
    score = max(-1.0, min(1.0, raw_score * 0.8))
    
    # Determine label based on score thresholds
    if score >= 0.3:
        label = "Positive"
    elif score <= -0.3:
        label = "Negative"
    else:
        label = "Neutral"
    
    return (label, round(score, 2))


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
        
        # --- LLM FALLBACK START ---
        if (not content or len(content) < 200) and os.getenv("GEMINI_API_KEY"):
            LOG.info(f"Heuristics failed for {url}. Attempting LLM extraction via Gemini...")
            llm_result = extract_with_gemini(html, url)
            if llm_result:
                return llm_result
        # --- LLM FALLBACK END ---

        full_text = f"{title} {content}"
        
        symbols = _detect_symbols(full_text)
        relevance = _calculate_relevance(full_text)
        sentiment_label, sentiment_score = _detect_sentiment(full_text)
        
        # Determine category
        if relevance >= 0.5:
            category = "Crypto"
        elif relevance >= 0.4:
            category = "Finance"
        else:
            category = "General"
        
        LOG.info(f"Extracted: {title[:50]}... | symbols={symbols} | rel={relevance:.2f} | sentiment={sentiment_score:.2f}")
        
        return {
            "title": title,
            "date": date,
            "content": content,
            "category": category,
            "relevance_score": round(relevance, 2),
            "sentiment_label": sentiment_label,
            "sentiment_score": sentiment_score,
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


def extract_with_gemini(html: str, url: str) -> Dict | None:
    """
    Use Gemini to parse difficult HTML structure.
    """
    try:
        from .gemini_client import GeminiClient
        
        # Strip script/style to save tokens
        soup = BeautifulSoup(html, "html.parser")
        for script in soup(["script", "style", "svg", "noscript"]):
            script.extract()
        clean_html = soup.get_text(separator=' ', strip=True)[:8000]  # Limit input
        
        # Use Gemini client
        client = GeminiClient()
        result = client.extract_article(clean_html, url)
        
        if result:
            LOG.info(f"[GEMINI] Successfully extracted: {result.get('title', '')[:50]}...")
        
        return result
        
    except Exception as e:
        LOG.error(f"Gemini Extraction failed: {e}")
        return None
