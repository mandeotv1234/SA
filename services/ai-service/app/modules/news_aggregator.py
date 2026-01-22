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

ollama_client = OllamaClient()

LOG = logging.getLogger("ai.aggregator")

# Configuration
MAX_NEWS_BUFFER = int(os.getenv("MAX_NEWS_BUFFER", "100"))
PREDICTION_INTERVAL_SEC = int(os.getenv("PREDICTION_INTERVAL_SEC", "300"))  # 5 minutes

# All trading pairs to predict
ALL_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT"
]

# Thread-safe news buffer
_news_buffer: deque = deque(maxlen=MAX_NEWS_BUFFER)
_seen_urls: set = set()
_buffer_lock = threading.Lock()
_scheduler_running = False
_last_prediction_time: float = 0


def add_news(news_payload: Dict) -> bool:
    """Add news to buffer. Returns True if this is new news."""
    # Handle both flat and nested structures
    url = news_payload.get("url")
    if not url:
        raw = news_payload.get("raw", {})
        while isinstance(raw, dict) and raw.get("raw"):
            raw = raw["raw"]
        url = raw.get("url") if isinstance(raw, dict) else None
    
    if not url:
        return False
    
    with _buffer_lock:
        if url in _seen_urls:
            return False
        
        _seen_urls.add(url)
        
        # Get data from flat structure first, fallback to nested
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
    Run prediction on all buffered news.
    Called by scheduler every 5 minutes.
    Predicts for ALL trading pairs.
    """
    global _last_prediction_time
    
    with _buffer_lock:
        if not _news_buffer:
            print("[PREDICTION] No news in buffer, skipping...")
            return {"status": "no_news"}
        
        # Get all news but DON'T clear - keep for context
        news_list = list(_news_buffer)
        # Clear old news (older than 1 hour)
        cutoff = time.time() - 3600
        while _news_buffer and _news_buffer[0].get("timestamp", 0) < cutoff:
            _news_buffer.popleft()
    
    _last_prediction_time = time.time()
    
    print(f"\n{'='*60}")
    print(f"[SCHEDULED PREDICTION] {datetime.now().strftime('%H:%M:%S')}")
    print(f"[INFO] Analyzing {len(news_list)} articles for {len(ALL_SYMBOLS)} symbols")
    print(f"{'='*60}")
    
    # Generate prediction using Ollama for ALL symbols
    print(f"[OLLAMA] Generating prediction for {len(ALL_SYMBOLS)} symbols...")
    prediction = ollama_client.generate_market_prediction(
        news_summaries=news_list,
        symbols=ALL_SYMBOLS
    )
    
    if prediction.get("error"):
        print(f"[ERROR] Prediction failed: {prediction.get('error')}")
        return prediction
    
    # Add metadata
    prediction["type"] = "aggregated_prediction"
    prediction["analyzed_articles"] = len(news_list)
    prediction["symbols_analyzed"] = ALL_SYMBOLS
    prediction["scheduled"] = True
    
    # Log results
    preds = prediction.get("predictions", [])
    print(f"\n[RESULTS] Market Sentiment: {prediction.get('market_sentiment', 'N/A')}")
    print(f"[SUMMARY] {prediction.get('analysis_summary', 'N/A')[:100]}")
    print(f"\n[PREDICTIONS]")
    for p in preds:
        direction = p.get('direction', '?')
        change = p.get('change_percent', 0)
        symbol = p.get('symbol', '?')
        reason = p.get('reason', '')[:60]
        icon = '🚀' if direction == 'UP' else '📉' if direction == 'DOWN' else '➖'
        print(f"  {icon} {symbol}: {direction} ({change:+.1f}%) - {reason}")
    
    # Key factors and risks
    if prediction.get('key_factors'):
        print(f"\n[KEY FACTORS] {', '.join(prediction['key_factors'][:3])}")
    if prediction.get('risks'):
        print(f"[RISKS] {', '.join(prediction['risks'][:2])}")
    
    print(f"{'='*60}\n")
    
    # Publish to Kafka
    try:
        produce_ai_insight(prediction)
        print(f"[KAFKA] Published aggregated_prediction")
    except Exception as e:
        print(f"[KAFKA ERROR] {e}")
    
    return prediction


def _scheduler_loop():
    """Background scheduler that runs prediction every PREDICTION_INTERVAL_SEC."""
    global _scheduler_running
    
    print(f"[SCHEDULER] Started - prediction every {PREDICTION_INTERVAL_SEC}s ({PREDICTION_INTERVAL_SEC//60} mins)")
    print(f"[SCHEDULER] First run in 30 seconds...")
    
    # Wait 30s for initial data collection
    time.sleep(30)
    
    while _scheduler_running:
        try:
            with _buffer_lock:
                buffer_size = len(_news_buffer)
            
            if buffer_size > 0:
                print(f"[SCHEDULER] Running prediction with {buffer_size} articles...")
                run_scheduled_prediction()
            else:
                print(f"[SCHEDULER] No articles in buffer, skipping...")
                
        except Exception as e:
            print(f"[SCHEDULER ERROR] {e}")
            import traceback
            traceback.print_exc()
        
        # Wait for next interval
        time.sleep(PREDICTION_INTERVAL_SEC)


def start_scheduler():
    """Start the background prediction scheduler."""
    global _scheduler_running
    
    if _scheduler_running:
        print("[SCHEDULER] Already running")
        return
    
    _scheduler_running = True
    thread = threading.Thread(target=_scheduler_loop, daemon=True)
    thread.start()
    print(f"[SCHEDULER] Background thread started")


def stop_scheduler():
    """Stop the scheduler."""
    global _scheduler_running
    _scheduler_running = False
    print("[SCHEDULER] Stopped")


def process_news(news_payload: Dict) -> Dict:
    """
    Process incoming news - just add to buffer.
    Prediction runs on schedule, not per-article.
    """
    is_new = add_news(news_payload)
    
    if not is_new:
        title = news_payload.get("title", "")[:40]
        return {"status": "duplicate", "title": title}
    
    with _buffer_lock:
        buffer_size = len(_news_buffer)
    
    return {
        "status": "buffered",
        "buffer_size": buffer_size
    }


def get_buffer_status() -> Dict:
    """Get current buffer status."""
    global _last_prediction_time
    
    with _buffer_lock:
        return {
            "buffer_size": len(_news_buffer),
            "seen_urls": len(_seen_urls),
            "last_prediction": datetime.fromtimestamp(_last_prediction_time, timezone.utc).isoformat() if _last_prediction_time else None,
            "next_prediction_in": max(0, PREDICTION_INTERVAL_SEC - (time.time() - _last_prediction_time)),
            "scheduler_running": _scheduler_running
        }


def force_prediction() -> Dict:
    """Force run prediction immediately."""
    return run_scheduled_prediction()


def reset_buffer():
    """Reset buffer and seen URLs."""
    global _seen_urls
    with _buffer_lock:
        _news_buffer.clear()
        _seen_urls.clear()
    print("[RESET] Buffer and seen URLs cleared")
