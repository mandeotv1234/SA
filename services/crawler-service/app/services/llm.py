import os
import requests
import logging
import json

LOG = logging.getLogger("crawler.llm")

OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2") 

def generate_extraction_rules(html_snippet: str, url: str) -> dict | None:
    """
    Ask LLM to generate CSS selectors for the given HTML snippet.
    """
    system_prompt = """You are an expert web scraper. Your goal is to analyze the HTML and identifying CSS selectors for the article's:
1. Title
2. Publish Date
3. Main Content Body

Return ONLY a valid JSON object with keys: "title_selector", "date_selector", "content_selector".
Do not include markdown formatting or explanations.
"""
    
    user_prompt = f"""
URL: {url}
HTML Snippet:
```html
{html_snippet}
```

Identify the CSS selectors.
"""

    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": False,
        "temperature": 0.1,
        "format": "json"
    }

    try:
        # If OLLAMA_API_URL is an ngrok link or external, it might need /api/chat path
        endpoint = f"{OLLAMA_API_URL}/api/chat"
        # If the user provided a root URL like '...ngrok-free.app', we append /api/chat
        # if it ends with /v1, it might be openai compatible, but let's assume standard Ollama API
        
        LOG.info(f"Requesting LLM extraction rules for {url} from {endpoint}")
        response = requests.post(endpoint, json=payload, timeout=60)
        response.raise_for_status()
        
        res_json = response.json()
        content = res_json.get("message", {}).get("content", "")
        
        # Parse JSON from content
        rules = json.loads(content)
        return rules
    except Exception as e:
        LOG.error(f"LLM generation failed: {e}")
        return None
