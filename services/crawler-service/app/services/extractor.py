import logging
import trafilatura
from bs4 import BeautifulSoup
from dateutil import parser as dateparser
from app.db import get_extraction_rule, save_extraction_rule
from app.services.llm import generate_extraction_rules
from app.modules.llm_fallback import extract_with_heuristics

LOG = logging.getLogger("crawler.extractor")

def extract_with_selectors(html: str, selectors: dict) -> dict | None:
    try:
        soup = BeautifulSoup(html, "html.parser")
        data = {}
        
        # Title
        if selectors.get("title_selector"):
            el = soup.select_one(selectors["title_selector"])
            if el:
                data["title"] = el.get_text().strip()
                
        # Date
        if selectors.get("date_selector"):
            el = soup.select_one(selectors["date_selector"])
            if el:
                # Try to get datetime attr or text
                val = el.get("datetime") or el.get_text().strip()
                try:
                    data["date"] = dateparser.parse(val).isoformat()
                except:
                    data["date"] = val
                    
        # Content
        if selectors.get("content_selector"):
            el = soup.select_one(selectors["content_selector"])
            if el:
                data["content"] = el.get_text().strip()
        
        # Validation
        if data.get("title") and data.get("content"):
            return data
        return None
    except Exception as e:
        LOG.warning(f"Selector extraction failed: {e}")
        return None

def smart_extract(url: str, html: str) -> dict:
    from urllib.parse import urlparse
    domain = urlparse(url).netloc
    
    # 1. Try DB Rules
    rules = get_extraction_rule(domain)
    if rules:
        LOG.info(f"Using saved rules for {domain}")
        data = extract_with_selectors(html, rules)
        if data:
            return data
        LOG.info(f"Saved rules failed for {url}, falling back.")

    # 2. Try Trafilatura (Heuristic)
    traf_content = trafilatura.extract(html)
    if traf_content and len(traf_content) > 200:
        # Trafilatura is usually very good at full text.
        # But we still need Title and Date.
        # Let's rely on our existing heuristic module for Title/Date + Trafilatura for content
        heuristic_data = extract_with_heuristics(html, url)
        if heuristic_data.get("content") and len(heuristic_data["content"]) > 100:
            return heuristic_data
    
    # 3. If heuristics failed or produced bad result, Trigger LLM Learning
    LOG.info(f"Triggering LLM Structure Learning for {url}")
    # Truncate HTML to avoid token limits (send header + part of body)
    snippet = html[:32000] 
    
    new_rules = generate_extraction_rules(snippet, url)
    if new_rules:
        LOG.info(f"LLM generated rules for {domain}: {new_rules}")
        save_extraction_rule(domain, new_rules)
        # Retry extraction with new rules
        data = extract_with_selectors(html, new_rules)
        if data:
            # Merge with other metadata
            data["url"] = url
            return data
            
    # 4. Ultimate Fallback
    return extract_with_heuristics(html, url)
