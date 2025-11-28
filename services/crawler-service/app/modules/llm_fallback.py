import os
import json
import logging
from typing import Dict
from bs4 import BeautifulSoup
from dateutil import parser as dateparser

LOG = logging.getLogger("crawler.llm")

# Prefer new env var name; fall back to the old one if present for backwards compatibility
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_URL")

PROMPT = (
    "You are an extractor that receives a full HTML document and must return a JSON object "
    "with keys: title, date (ISO 8601 or empty), and content (clean text). Return ONLY valid JSON.\n\n"
    "HTML:\n"
)


def _heuristic_extract(html: str) -> Dict:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    paragraphs = [p.get_text().strip() for p in soup.find_all("p")]
    content = "\n\n".join(paragraphs)[:20000]
    return {"title": title, "date": None, "content": content}


def extract_with_llm(html: str) -> Dict:
    """Use Google Gemini via google-generativeai SDK in JSON mode to extract structured fields.

    If the SDK isn't available or the API key is not set, fall back to simple heuristics.
    """
    if GEMINI_API_KEY:
        try:
            try:
                import google.generativeai as genai
            except Exception:
                genai = None
            if genai:
                # configure client
                try:
                    genai.configure(api_key=GEMINI_API_KEY)
                except Exception:
                    # some SDK versions use different configuration entrypoints
                    try:
                        genai.Client(api_key=GEMINI_API_KEY)
                    except Exception:
                        pass

                prompt = PROMPT + html

                # Request JSON Mode so model returns strict JSON
                # We attempt to call `generate` which may exist across SDK versions; be defensive.
                resp = None
                try:
                    resp = genai.generate(
                        model="gemini-1.5-flash",
                        prompt=prompt,
                        max_output_tokens=1024,
                        temperature=0.0,
                        response_mime_type="application/json",
                    )
                except Exception:
                    try:
                        # some SDKs expose chat.create-style API
                        resp = genai.chat.create(
                            model="gemini-1.5-flash",
                            messages=[{"role": "user", "content": prompt}],
                            response_mime_type="application/json",
                        )
                    except Exception:
                        resp = None

                if resp is not None:
                    # Try several common shapes to extract the returned JSON string
                    text = None
                    try:
                        # SDKs sometimes return a simple string attribute
                        text = getattr(resp, "text", None) or getattr(resp, "content", None)
                    except Exception:
                        text = None

                    if not text:
                        # dict-like shapes
                        try:
                            # resp may be dict-like with keys 'output' or 'candidates'
                            if isinstance(resp, dict):
                                if "output" in resp and isinstance(resp["output"], list) and len(resp["output"]) > 0:
                                    o = resp["output"][0]
                                    # gemini SDK may nest content candidates
                                    if isinstance(o, dict) and "content" in o:
                                        c = o["content"]
                                        if isinstance(c, list) and len(c) > 0 and isinstance(c[0], dict) and "text" in c[0]:
                                            text = c[0]["text"]
                                if not text and "candidates" in resp and isinstance(resp["candidates"], list):
                                    cand = resp["candidates"][0]
                                    if isinstance(cand, dict) and "content" in cand and isinstance(cand["content"], str):
                                        text = cand["content"]
                        except Exception:
                            text = None

                    if not text:
                        try:
                            text = json.dumps(resp)
                        except Exception:
                            text = str(resp)

                    # parse as JSON
                    try:
                        j = json.loads(text)
                        d = j
                        published_iso = None
                        if d and d.get("date"):
                            try:
                                published_iso = dateparser.parse(d.get("date")).isoformat()
                            except Exception:
                                published_iso = None
                        return {"title": d.get("title"), "date": published_iso, "content": d.get("content")}
                    except Exception:
                        LOG.exception("Failed to parse JSON from Gemini response; falling back to heuristics")
        except Exception:
            LOG.exception("Gemini extraction failed, falling back to heuristic extractor")

    # fallback heuristic extraction
    return _heuristic_extract(html)
