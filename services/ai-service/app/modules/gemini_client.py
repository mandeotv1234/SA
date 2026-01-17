"""
Gemini Client for AI predictions.
Replaces Ollama Client, using Google's GenAI API for smarter analysis.
"""
import os
import json
import logging
import time
from typing import Dict, List, Optional
from datetime import datetime, timezone
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold

LOG = logging.getLogger("ai.gemini")

# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Using gemini-1.5-pro for high reasoning capability, or 2.0-flash if speed is priority.
# User requested "newest", currently 1.5 Pro (latest) is very strong.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-pro-latest")

# Configure GenAI
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    LOG.error("GEMINI_API_KEY not found in environment variables!")

def get_model():
    """Get configured Gemini model instance with JSON schema enforcement."""
    generation_config = {
        "temperature": 0.2,
        "top_p": 0.95,
        "top_k": 40,
        "max_output_tokens": 8192,
        "response_mime_type": "application/json",
    }
    
    # Safety settings - allow standard market discussions
    safety_settings = {
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
    }

    return genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        generation_config=generation_config,
        safety_settings=safety_settings
    )

def generate_market_prediction(
    news_summaries: List[Dict],
    symbols: List[str] = None
) -> Dict:
    """
    Generate market prediction based on aggregated news using Gemini.
    """
    if symbols is None:
        symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]
    
    if not news_summaries:
        LOG.warning("No news to analyze")
        return {"error": "no_news", "predictions": []}
        
    if not GEMINI_API_KEY:
        LOG.error("Gemini API Key missing")
        return {"error": "api_key_missing", "predictions": []}

    # Build news summary for prompt
    news_text = ""
    positive_count = 0
    negative_count = 0
    
    # Limit number of articles to fit in context window (Gemini has large window but we keep it focused)
    # Gemini 1.5 Pro has 128k-1M context, so 50 articles is easy.
    for i, news in enumerate(news_summaries, 1):
        title = news.get("title", "")
        sentiment = news.get("sentiment", "Neutral")
        content = (news.get("content") or "")[:500] # Increase content length for Gemini
        published_at = news.get("published_at", "N/A")
        
        if sentiment == "Positive":
            positive_count += 1
        elif sentiment == "Negative":
            negative_count += 1
            
        news_text += f"{i}. [{sentiment}] {title} ({published_at})\n   {content}\n\n"
    
    prompt = f"""Bạn là một chuyên gia phân tích thị trường tài chính và crypto cấp cao (Senior Market Analyst).

DỮ LIỆU ĐẦU VÀO:
- Danh sách {len(news_summaries)} tin tức mới nhất:
{news_text}

THỐNG KÊ CƠ BẢN:
- Tích cực: {positive_count}
- Tiêu cực: {negative_count}
- Tổng số: {len(news_summaries)}

NHIỆM VỤ:
Phân tích tổng hợp các tin tức trên để dự đoán xu hướng giá ngắn hạn (24h) cho các cặp tiền sau: {', '.join(symbols)}.
Hãy suy luận logic từ các sự kiện vĩ mô, tin tức dự án, và tâm lý thị trường.

YÊU CẦU OUTPUT (JSON Schema):
Trả về JSON object chính xác theo cấu trúc sau (không bọc trong markdown):
{{
  "analysis_summary": "Tóm tắt súc tích (3-4 câu) về tình hình thị trường dựa trên tin tức được cung cấp.",
  "market_sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "predictions": [
    {{
      "symbol": "Mã cặp tiền (ví dụ BTCUSDT)",
      "direction": "UP" | "DOWN" | "NEUTRAL",
      "change_percent": (số float, dự đoán % thay đổi, ví dụ 2.5 hoặc -1.2),
      "confidence": (số float 0.0-1.0, độ tin cậy),
      "reason": "Lý do chính (1 câu ngắn gọn)"
    }}
  ],
  "key_factors": ["Danh sách các yếu tố chính tác động (ngắn gọn)"],
  "risks": ["Danh sách rủi ro tiềm ẩn"]
}}
"""

    try:
        LOG.info(f"Calling Gemini ({GEMINI_MODEL}) for {len(symbols)} symbols based on {len(news_summaries)} articles...")
        model = get_model()
        response = model.generate_content(prompt)
        
        # Gemini with response_mime_type="application/json" generally returns clean JSON
        try:
            parsed = json.loads(response.text)
            
            # Enrich with metadata
            parsed["timestamp"] = datetime.now(timezone.utc).isoformat()
            parsed["news_count"] = len(news_summaries)
            parsed["model"] = GEMINI_MODEL
            
            LOG.info("Gemini prediction success")
            return parsed
            
        except json.JSONDecodeError:
            LOG.error(f"JSON Decode Error. Raw text: {response.text[:200]}")
            # Fallback basic parse if needed (unlikely with JSON mode)
            return {"error": "parse_error", "raw": response.text[:1000]}
            
    except Exception as e:
        LOG.error(f"Gemini API Error: {str(e)}")
        # Exponential backoff is good, but handled by caller or custom retry logic usually.
        # For now return error.
        return {
            "error": "gemini_api_failed", 
            "details": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

def generate_single_article_insight(news: Dict) -> Dict:
    """Generate quick insight for a single article."""
    if not GEMINI_API_KEY:
        return {"error": "api_key_missing", "impact": "LOW"}

    title = news.get("title", "")
    content = (news.get("content") or "")[:1000]
    
    prompt = f"""Phân tích tin tức crypto sau:
Tiêu đề: {title}
Nội dung: {content}

Trả về JSON:
{{
  "impact": "HIGH" | "MEDIUM" | "LOW",
  "affected_symbols": ["List các token bị ảnh hưởng"],
  "short_term_direction": "UP" | "DOWN" | "NEUTRAL",
  "reason": "Giải thích 1 câu"
}}
"""
    try:
        model = get_model()
        response = model.generate_content(prompt)
        return json.loads(response.text)
    except Exception:
        return {"impact": "LOW", "error": "analysis_failed"}
