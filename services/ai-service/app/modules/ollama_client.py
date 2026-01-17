"""
Ollama Client for AI predictions.
Uses local/remote Ollama server for LLM inference.
"""
import os
import json
import logging
import requests
from typing import Dict, List, Optional
from datetime import datetime, timezone

LOG = logging.getLogger("ai.ollama")

# Ollama configuration
OLLAMA_URL = os.getenv("OLLAMA_URL", "https://1f3828300a59.ngrok-free.app")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "120"))


def call_ollama(prompt: str, max_retries: int = 2) -> Optional[str]:
    """
    Call Ollama API with the given prompt.
    Returns the generated text or None on failure.
    """
    url = f"{OLLAMA_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False
    }
    
    print(f"[OLLAMA] URL: {OLLAMA_URL}")
    print(f"[OLLAMA] Model: {OLLAMA_MODEL}")
    
    for attempt in range(max_retries):
        try:
            print(f"[OLLAMA] Attempt {attempt + 1}/{max_retries}...")
            response = requests.post(
                url, 
                json=payload, 
                timeout=OLLAMA_TIMEOUT,
                headers={"Content-Type": "application/json"}
            )
            
            print(f"[OLLAMA] Status: {response.status_code}")
            
            response.raise_for_status()
            
            result = response.json()
            text = result.get("response", "")
            print(f"[OLLAMA] Response received (len={len(text)})")
            return text
            
        except requests.exceptions.Timeout:
            print(f"[OLLAMA] TIMEOUT (attempt {attempt + 1})")
        except requests.exceptions.ConnectionError as e:
            print(f"[OLLAMA] CONNECTION ERROR: {e}")
            return None
        except Exception as e:
            print(f"[OLLAMA] ERROR: {e}")
    
    print(f"[OLLAMA] All retries failed")
    return None


def parse_prediction_json(text: str) -> Optional[Dict]:
    """
    Parse JSON from Ollama response.
    Handles cases where JSON is embedded in markdown or extra text.
    """
    if not text:
        return None
    
    # Log first 500 chars for debugging
    print(f"[OLLAMA RAW] {text[:500]}...")
    
    # Remove markdown code blocks
    text = text.replace("```json", "").replace("```", "")
    text = text.strip()
    
    try:
        # Try direct parse
        return json.loads(text)
    except Exception as e:
        print(f"[PARSE] Direct parse failed: {e}")
    
    # Try to find JSON object
    start = text.find('{')
    end = text.rfind('}') + 1
    if start != -1 and end > start:
        try:
            json_str = text[start:end]
            return json.loads(json_str)
        except Exception as e:
            print(f"[PARSE] Object parse failed: {e}")
    
    # Try to extract predictions array if it exists
    if '"predictions"' in text:
        try:
            # Find the predictions array
            pred_start = text.find('"predictions"')
            if pred_start != -1:
                # Build a minimal valid JSON
                bracket_start = text.find('[', pred_start)
                bracket_end = text.rfind(']') + 1
                if bracket_start != -1 and bracket_end > bracket_start:
                    predictions_str = text[bracket_start:bracket_end]
                    predictions = json.loads(predictions_str)
                    return {
                        "predictions": predictions,
                        "analysis_summary": "Extracted from partial response",
                        "market_sentiment": "NEUTRAL"
                    }
        except Exception as e:
            print(f"[PARSE] Predictions extract failed: {e}")
    
    print(f"[PARSE] All parsing methods failed")
    return None


def generate_market_prediction(
    news_summaries: List[Dict],
    symbols: List[str] = None
) -> Dict:
    """
    Generate market prediction based on aggregated news.
    
    Args:
        news_summaries: List of news articles with title, content, sentiment
        symbols: List of symbols to predict (default: major cryptos)
        
    Returns:
        Dict with predictions for each symbol
    """
    if symbols is None:
        symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]
    
    if not news_summaries:
        LOG.warning("No news to analyze")
        return {"error": "no_news", "predictions": []}
    
    # Build news summary for prompt
    news_text = ""
    positive_count = 0
    negative_count = 0
    
    for i, news in enumerate(news_summaries[:15], 1):  # Limit to 15 articles
        title = news.get("title", "")[:100]
        sentiment = news.get("sentiment", "Neutral")
        content = (news.get("content") or "")[:200]
        
        if sentiment == "Positive":
            positive_count += 1
        elif sentiment == "Negative":
            negative_count += 1
            
        news_text += f"{i}. [{sentiment}] {title}\n   {content}...\n\n"
    
    prompt = f"""Bạn là chuyên gia phân tích thị trường crypto. Dựa trên {len(news_summaries)} tin tức mới nhất:

{news_text}

THỐNG KÊ:
- Tin tích cực: {positive_count}
- Tin tiêu cực: {negative_count}
- Tin trung lập: {len(news_summaries) - positive_count - negative_count}

NHIỆM VỤ: Phân tích và dự đoán xu hướng giá trong 24 giờ tới cho các cặp tiền: {', '.join(symbols)}

TRẢ VỀ JSON THEO ĐỊNH DẠNG:
{{
  "analysis_summary": "Tóm tắt phân tích thị trường (2-3 câu)",
  "market_sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "predictions": [
    {{
      "symbol": "BTCUSDT",
      "direction": "UP" | "DOWN" | "NEUTRAL",
      "change_percent": 2.5,
      "confidence": 0.75,
      "reason": "Lý do cụ thể dựa trên tin tức"
    }}
  ],
  "key_factors": ["yếu tố 1", "yếu tố 2"],
  "risks": ["rủi ro 1"]
}}

CHỈ TRẢ VỀ JSON, KHÔNG CÓ TEXT KHÁC."""

    LOG.info(f"Generating prediction for {len(symbols)} symbols based on {len(news_summaries)} news articles")
    
    response_text = call_ollama(prompt)
    
    if not response_text:
        return {
            "error": "ollama_failed",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "predictions": []
        }
    
    parsed = parse_prediction_json(response_text)
    
    if parsed:
        parsed["timestamp"] = datetime.now(timezone.utc).isoformat()
        parsed["news_count"] = len(news_summaries)
        parsed["model"] = OLLAMA_MODEL
        return parsed
    else:
        # Return raw response if parsing fails
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "raw_response": response_text[:1000],
            "predictions": [],
            "error": "parse_failed"
        }


def generate_single_article_insight(news: Dict) -> Dict:
    """
    Generate quick insight for a single article (lightweight).
    Used for immediate feedback, not full prediction.
    """
    title = news.get("title", "")
    content = (news.get("content") or "")[:500]
    sentiment = news.get("sentiment", "Neutral")
    symbols = news.get("symbols", ["BTCUSDT"])
    
    prompt = f"""Phân tích nhanh tin tức crypto:

Tiêu đề: {title}
Nội dung: {content}
Sentiment: {sentiment}

TRẢ VỀ JSON:
{{
  "impact": "HIGH" | "MEDIUM" | "LOW",
  "affected_symbols": {json.dumps(symbols)},
  "short_term_direction": "UP" | "DOWN" | "NEUTRAL",
  "reason": "1 câu giải thích"
}}

CHỈ TRẢ VỀ JSON."""

    response_text = call_ollama(prompt)
    parsed = parse_prediction_json(response_text)
    
    if parsed:
        return parsed
    return {"impact": "LOW", "error": "parse_failed"}
