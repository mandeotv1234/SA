"""
News Aggregator for batch AI analysis.
- Collects news into buffer
- Runs scheduled prediction every 5 minutes
- Predicts for ALL major trading pairs
"""
import os
import time
import logging
import threading
from typing import Dict, List
from datetime import datetime, timezone
from collections import deque

from app.kafka_producer import produce_ai_insight
from app.modules.ollama_client import OllamaClient


from app.modules.inference import InferenceEngine

# Initialize Inference Engine
# Ensure model path is correct or allow fallback
MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/lstm_sentiment_hybrid_v1.pth")
_inference_engine = InferenceEngine(model_path=MODEL_PATH, device=os.getenv("DEVICE", "cpu"))

LOG = logging.getLogger("ai.aggregator")

# Configuration
MAX_NEWS_BUFFER = int(os.getenv("MAX_NEWS_BUFFER", "500"))
PREDICTION_INTERVAL_SEC = int(os.getenv("PREDICTION_INTERVAL_SEC", "300")) 

# All trading pairs to predict
ALL_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "POLUSDT"
]

# Thread-safe news buffer
_news_buffer: deque = deque(maxlen=MAX_NEWS_BUFFER)
_seen_urls: set = set()
_buffer_lock = threading.Lock()
_scheduler_running = False
_last_prediction_time: float = 0
_last_result: Dict = None

def get_last_result() -> Dict:
    global _last_result
    return _last_result if _last_result else {"status": "no_prediction_yet"}


def add_news(news_payload: Dict) -> bool:
    """Add news to buffer. Returns True if this is new news."""
    url = news_payload.get("url")
    if not url:
        raw = news_payload.get("raw", {})
        while isinstance(raw, dict) and raw.get("raw"):
            raw = raw["raw"]
        url = raw.get("url") if isinstance(raw, dict) else None
    
    if not url:
        return False

    title = news_payload.get("title", "")
    if "Google News" in title or not title:
        return False
    
    with _buffer_lock:
        if url in _seen_urls:
            return False
        
        _seen_urls.add(url)
        
        article = {
            "url": url,
            "title": news_payload.get("title", ""),
            "content": news_payload.get("content", "")[:2000],
            "sentiment": news_payload.get("sentiment_label") or news_payload.get("sentiment", "Neutral"),
            "symbols": news_payload.get("symbols", ["BTCUSDT"]),
            "relevance": float(news_payload.get("relevance_score", 0.5)),
            "category": news_payload.get("category", "General"),
            "timestamp": time.time()
        }
        
        _news_buffer.append(article)
        print(f"[BUFFER+] Added #{len(_news_buffer)}: {article['title'][:40]}...")
        
        return True


def run_scheduled_prediction() -> Dict:
    """
    Run Deep Learning prediction on buffered news and market data.
    """
    global _last_prediction_time
    
    with _buffer_lock:
        # Get all news
        news_list = list(_news_buffer)
        
        # Cleanup old news
        cutoff = time.time() - 86400 # 24h
        while _news_buffer and _news_buffer[0].get("timestamp", 0) < cutoff:
            _news_buffer.popleft()
    
    _last_prediction_time = time.time()
    
    print(f"\n{'='*60}")
    print(f"[DEEP LEARNING PREDICTION] {datetime.now().strftime('%H:%M:%S')}")
    print(f"[INFO] Analyzing {len(news_list)} articles for {len(ALL_SYMBOLS)} symbols")
    print(f"{'='*60}")
    
    predictions = []
    
    for symbol in ALL_SYMBOLS:
        print(f"  [LOOP-DEBUG] Processing {symbol}...")
        try:
            # Run Deep Learning Inference
            pred = _inference_engine.predict_for_symbol(symbol, news_list)
            
            if pred:
                predictions.append(pred)
                
                # Extract 1h forecast for logging
                forecast_1h = pred.get('forecast', {}).get('next_1h', {})
                direction = forecast_1h.get('direction', 'SIDEWAYS')
                confidence = forecast_1h.get('confidence', 0)
                reason_short = pred.get('causal_analysis', {}).get('explanation_vi', '')[:100]
                
                icon = '🚀' if direction == 'UP' else ('📉' if direction == 'DOWN' else '➡️')
                print(f"  {icon} {symbol}: {direction} (Conf: {confidence}%)")
                print(f"     Causal: {reason_short}...")
                
                # 🔥 PUBLISH IMMEDIATELY after processing each symbol
                try:
                    single_prediction_payload = {
                        "meta": {
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "model_version": "hybrid_lstm_finbert_v2",
                            "engine": "Dual-Stream Deep Learning",
                            "analyzed_articles": len(news_list),
                            "symbol": symbol  # Add symbol to meta for filtering
                        },
                        "predictions": [pred]  # Single prediction
                    }
                    produce_ai_insight(single_prediction_payload)
                    print(f"  [KAFKA-PUBLISH] Sent prediction to 'ai_insights': {symbol}")
                except Exception as e:
                    print(f"  [KAFKA ERROR] Failed to publish {symbol}: {e}")
            else:
                print(f"  [WARN] Skipping {symbol} - insufficient data")
                
        except Exception as e:
            print(f"  [ERROR] Failed for {symbol}: {e}")

    # Calculate overall market sentiment score
    sentiment_score = 0
    valid_preds = 0
    for p in predictions:
        f1h = p.get('forecast', {}).get('next_1h', {})
        d = f1h.get('direction')
        c = f1h.get('confidence', 0)
        if d == 'UP': sentiment_score += (c/100)
        elif d == 'DOWN': sentiment_score -= (c/100)
        valid_preds += 1
    
    avg_sentiment = sentiment_score / valid_preds if valid_preds > 0 else 0
    sentiment_label = "NEUTRAL"
    if avg_sentiment > 0.2: sentiment_label = "BULLISH"
    elif avg_sentiment < -0.2: sentiment_label = "BEARISH"

    # Construct final aggregated result (for backward compatibility)
    result_payload = {
        "meta": {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "model_version": "hybrid_lstm_finbert_v2",
            "market_sentiment_score": round(avg_sentiment, 2),
            "market_sentiment_label": sentiment_label,
            "engine": "Dual-Stream Deep Learning",
            "analyzed_articles": len(news_list)
        },
        "predictions": predictions
    }

    # Save to global state
    global _last_result
    _last_result = result_payload

    # Also publish aggregated result for market overview
    try:
        produce_ai_insight(result_payload)
        print(f"[KAFKA] Published aggregated_prediction (all {len(predictions)} symbols)")
    except Exception as e:
        print(f"[KAFKA ERROR] {e}")
    
    return result_payload


def _scheduler_loop():
    """Background scheduler that runs prediction every PREDICTION_INTERVAL_SEC."""
    global _scheduler_running
    
    print(f"[SCHEDULER] Started - DL prediction every {PREDICTION_INTERVAL_SEC}s")
    print(f"[SCHEDULER] First run in 30 seconds...")
    
    time.sleep(5)
    
    while _scheduler_running:
        try:
            # Always run prediction even if buffer is empty (Technical Analysis fallback)
            run_scheduled_prediction()
        except Exception as e:
            print(f"[SCHEDULER ERROR] {e}")
            import traceback
            traceback.print_exc()
        
        time.sleep(PREDICTION_INTERVAL_SEC)


def start_scheduler():
    global _scheduler_running
    if _scheduler_running: return
    _scheduler_running = True
    thread = threading.Thread(target=_scheduler_loop, daemon=True)
    thread.start()
    print(f"[SCHEDULER] Background thread started")


def stop_scheduler():
    global _scheduler_running
    _scheduler_running = False
    print("[SCHEDULER] Stopped")


def process_news(news_payload: Dict) -> Dict:
    is_new = add_news(news_payload)
    if not is_new:
        title = news_payload.get("title", "")[:40]
        return {"status": "duplicate", "title": title}
    
    with _buffer_lock:
        buffer_size = len(_news_buffer)
    
    return {"status": "buffered", "buffer_size": buffer_size}


def get_buffer_status() -> Dict:
    global _last_prediction_time
    with _buffer_lock:
        return {
            "buffer_size": len(_news_buffer),
            "seen_urls": len(_seen_urls),
            "last_prediction": datetime.fromtimestamp(_last_prediction_time, timezone.utc).isoformat() if _last_prediction_time else None,
            "next_prediction_in": max(0, PREDICTION_INTERVAL_SEC - (time.time() - _last_prediction_time)),
            "scheduler_running": _scheduler_running,
            "engine": "Deep Learning (Dual-Stream)"
        }

def force_prediction() -> Dict:
    return run_scheduled_prediction()

def reset_buffer():
    global _seen_urls
    with _buffer_lock:
        _news_buffer.clear()
        _seen_urls.clear()
    print("[RESET] Buffer and seen URLs cleared")
