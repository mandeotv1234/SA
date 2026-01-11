import os
import json
import logging
import requests
from typing import Dict
from dateutil import parser as dateparser

LOG = logging.getLogger("crawler.llm")

def _heuristic_extract(html: str) -> Dict:
    """Fallback if LLM fails."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    paragraphs = [p.get_text().strip() for p in soup.find_all("p")]
    content = "\n\n".join(paragraphs)[:20000]
    return {
        "title": title, 
        "date": None, 
        "content": content,
        "category": "General",
        "relevance_score": 0.5,
        "sentiment": "Neutral",
        "user_rating": None
    }

def extract_with_llm(html_content: str, url: str) -> Dict:
    """
    Uses a self-hosted LLM (Llama 3.2 via Ollama/Ngrok) to parse raw HTML 
    and extract structured JSON data.
    """
    
    # Clean up HTML slightly to reduce token count
    cleaned_html = html_content.strip() if html_content else ""
    if len(cleaned_html) > 15000:
        cleaned_html = cleaned_html[:15000] + "..."

    prompt = (
        "Bạn là chuyên gia trích xuất tin tức tài chính. Phân tích HTML và trả về JSON.\n\n"
        "QUY TẮC QUAN TRỌNG:\n"
        "1. CHỈ XỬ LÝ bài viết tin tức thực sự về tài chính, crypto, kinh tế.\n"
        "2. NẾU đây KHÔNG phải bài viết tin tức (trang chủ, trang danh mục, trang ứng dụng, trang liên hệ...), "
        "trả về: {\"is_article\": false, \"reject_reason\": \"lý do\"}\n"
        "3. NẾU là bài viết tin tức tài chính hợp lệ, trả về JSON với các key sau:\n\n"
        "{\n"
        "  \"is_article\": true,\n"
        "  \"title\": \"Tiêu đề bài viết\",\n"
        "  \"date\": \"YYYY-MM-DDTHH:MM:SSZ hoặc null\",\n"
        "  \"content\": \"Tóm tắt nội dung tin tức (100-300 từ), tập trung vào sự kiện chính và tác động thị trường\",\n"
        "  \"category\": \"Finance\" | \"Crypto\" | \"Economy\" | \"Policy\" | \"Market\",\n"
        "  \"relevance_score\": 0.0-1.0 (mức độ liên quan đến thị trường crypto/tài chính),\n"
        "  \"sentiment\": \"Positive\" | \"Negative\" | \"Neutral\",\n"
        "  \"key_points\": [\"điểm chính 1\", \"điểm chính 2\"],\n"
        "  \"affected_assets\": [\"BTC\", \"ETH\", ...] (các tài sản bị ảnh hưởng)\n"
        "}\n\n"
        "HTML Content:\n"
        f"{cleaned_html}\n\n"
        "CHỈ TRẢ VỀ JSON, KHÔNG CÓ TEXT KHÁC."
    )

    ollama_url = os.getenv("OLLAMA_API_URL")
    if not ollama_url:
        LOG.error("OLLAMA_API_URL is not set.")
        return _heuristic_extract(html_content)
        
    model = os.getenv("OLLAMA_MODEL", "llama3.2")
    api_endpoint = f"{ollama_url}/api/generate"

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json"
    }

    try:
        LOG.info(f"Sending HTML (len={len(cleaned_html)}) to Ollama at {ollama_url}...")
        resp = requests.post(api_endpoint, json=payload, timeout=60)
        resp.raise_for_status()
        
        data = resp.json()
        raw_response = data.get("response", "")
        
        # Parse JSON from the response text
        j = None
        try:
            j = json.loads(raw_response)
        except json.JSONDecodeError:
            # Fallback: try to find JSON block if Llama adds extra text
            start = raw_response.find('{')
            end = raw_response.rfind('}') + 1
            if start != -1 and end != -1:
                try:
                    j = json.loads(raw_response[start:end])
                except:
                    pass
        
        if not j:
            LOG.error(f"Failed to parse JSON from Ollama response: {raw_response[:200]}...")
            return _heuristic_extract(html_content)

        # Check if LLM rejected this as non-article
        if j.get("is_article") == False:
            reject_reason = j.get("reject_reason", "Not a news article")
            LOG.info(f"LLM rejected {url}: {reject_reason}")
            return {"error": "not_article", "reason": reject_reason, "url": url}

        # Post-process date
        published_iso = j.get("date")
        if published_iso:
             try:
                published_iso = dateparser.parse(published_iso).isoformat()
             except:
                published_iso = None
        
        # Extract relevance score, default to 0.7 for valid articles
        relevance = j.get("relevance_score")
        if relevance is None or not isinstance(relevance, (int, float)):
            relevance = 0.7  # Default high relevance for LLM-approved articles
        
        return {
            "title": j.get("title"), 
            "date": published_iso, 
            "content": j.get("content"),
            "category": j.get("category") or "Crypto",
            "relevance_score": relevance,
            "sentiment": j.get("sentiment") or "Neutral",
            "key_points": j.get("key_points"),
            "affected_assets": j.get("affected_assets"),
            "user_rating": j.get("user_rating")
        }

    except Exception as e:
        LOG.error(f"Ollama extraction failed for {url}: {e}")
        return _heuristic_extract(html_content)
