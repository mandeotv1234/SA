"""
Gemini API client for crawler-service content extraction fallback.
"""
import os
import logging
import requests
from typing import Optional, Dict

LOG = logging.getLogger("crawler.gemini")


class GeminiClient:
    """Client for Gemini API to extract article content when heuristics fail."""
    
    def __init__(self):
        self.api_key = os.getenv('GEMINI_API_KEY')
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")
        
        self.model = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
        self.api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        
        LOG.info(f"[GEMINI-INIT] Model: {self.model}")
    
    def extract_article(self, html_text: str, url: str) -> Optional[Dict]:
        """
        Use Gemini to extract article details from HTML text.
        
        Args:
            html_text: Cleaned HTML text (no scripts/styles)
            url: Article URL
            
        Returns:
            Dict with extracted article data or None if failed
        """
        prompt = f"""
Extract article details from this HTML text.

URL: {url}

HTML Text:
{html_text[:8000]}

Return ONLY valid JSON (no markdown, no explanation):
{{
    "title": "Article Title",
    "date": "ISO8601 date or null",
    "content": "Full parsed article content (main text only, no ads/navigation)",
    "symbols": ["BTCUSDT", "ETHUSDT", ...],
    "sentiment": "Positive/Negative/Neutral",
    "category": "Crypto/Finance/General"
}}

Rules:
- Extract ONLY the main article content, ignore ads, navigation, comments
- Detect crypto symbols mentioned (BTC, ETH, SOL, BNB, DOGE, XRP, ADA, AVAX, DOT, POL)
- Sentiment based on article tone
- Category: Crypto if crypto-focused, Finance if financial news, General otherwise
"""
        
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 2048,
                "topP": 0.95,
                "topK": 40
            }
        }
        
        try:
            response = requests.post(
                f"{self.api_url}?key={self.api_key}",
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            
            # Extract response text
            candidates = result.get('candidates', [])
            if not candidates:
                LOG.error("[GEMINI] No candidates in response")
                return None
            
            parts = candidates[0].get('content', {}).get('parts', [])
            if not parts:
                LOG.error("[GEMINI] No parts in candidate")
                return None
            
            text = parts[0].get('text', '')
            
            # Parse JSON
            import json
            import re
            
            # Remove markdown code blocks if present
            clean_text = re.sub(r'```json\s*', '', text)
            clean_text = re.sub(r'```\s*', '', clean_text)
            clean_text = clean_text.strip()
            
            try:
                data = json.loads(clean_text)
            except json.JSONDecodeError:
                # Try to find JSON in text
                match = re.search(r'\{.*\}', clean_text, re.DOTALL)
                if match:
                    data = json.loads(match.group(0))
                else:
                    LOG.error(f"[GEMINI] Failed to parse JSON: {clean_text[:200]}")
                    return None
            
            # Add metadata
            data['relevance_score'] = 0.9  # High relevance since LLM extracted
            data['url'] = url
            
            LOG.info(f"[GEMINI] Successfully extracted: {data.get('title', '')[:50]}...")
            return data
            
        except requests.exceptions.RequestException as e:
            LOG.error(f"[GEMINI] API request failed: {e}")
            return None
        except Exception as e:
            LOG.error(f"[GEMINI] Extraction failed: {e}")
            return None
