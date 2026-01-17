"""
Adaptive crawler module.
Uses heuristic extraction only (no LLM calls).
"""
import trafilatura
import requests
from .llm_fallback import extract_with_heuristics
from bs4 import BeautifulSoup
from typing import Dict
from dateutil import parser as dateparser


def adaptive_crawl(url: str, session: requests.sessions.Session | None = None) -> Dict:
    """
    Fetch and extract content from URL using heuristics.
    No LLM calls - fast and efficient.
    
    Args:
        url: The URL to crawl
        session: Optional requests session for connection pooling
        
    Returns:
        Dict with extracted article data
    """
    client = session or requests
    try:
        r = client.get(url, timeout=15, headers={"User-Agent": "crawler-service/1.0"})
        r.raise_for_status()
        html = r.text
        
        # Use heuristic extraction (no LLM)
        return extract_with_heuristics(html, url)
        
    except Exception as e:
        return {"error": "fetch_failed", "detail": str(e), "url": url}
