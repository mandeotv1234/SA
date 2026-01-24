import os
from fastapi import FastAPI
from threading import Thread
from app.kafka_consumer import start_consumer
from app.modules.causal import schedule_causal_job, run_causal_now
from app.modules.causal import analyze_event_causal
from app.modules.sentiment import analyze_sentiment_text
from app.kafka_producer import close_producer, create_startup_topics
from app.market_cache import start_market_cache_thread

app = FastAPI(title="AI Service")


@app.on_event("startup")
def startup_event():
    # Ensure Kafka topics exist
    try:
        create_startup_topics()
    except Exception as e:
        print(f"Failed to create startup topics: {e}")

    t = Thread(target=start_consumer, daemon=True)
    t.start()
    # start market cache consumer to populate recent klines from Kafka
    start_market_cache_thread()
    schedule_causal_job()


@app.on_event('shutdown')
def shutdown_event():
    try:
        close_producer()
    except Exception:
        pass


@app.get('/health')
def health():
    return {"alive": True}


@app.get('/predictions/latest')
def get_latest_prediction():
    """Get the latest Deep Learning prediction result."""
    from app.modules.news_aggregator import get_last_result
    return get_last_result()


@app.get('/debug/market_cache/{symbol}')
def debug_market_cache(symbol: str):
    """Return recent cached candles for a symbol (oldest->newest). Dev-only endpoint."""
    try:
        from app.market_cache import get_candles
        candles = get_candles(symbol.upper(), 200)
        return {"symbol": symbol.upper(), "count": len(candles), "candles": candles}
    except Exception as e:
        return {"error": str(e)}


@app.post('/sentiment/')
def sentiment_endpoint(text: str):
    return analyze_sentiment_text(text)


@app.post('/causal/run-now')
def causal_now():
    res = run_causal_now()
    return {"status": "ok", "result": res}


@app.post('/causal/for-news')
def causal_for_news(payload: dict):
    """Run causal analysis for a provided news payload (best-effort).

    Example payload shape:
    {
      "url": "...",
      "title": "...",
      "published_at": "2025-11-28T08:00:00Z",
      "raw": { ... }
    }
    """
    try:
        res = analyze_event_causal(payload)
        return {"status": "ok", "insight": res}
    except Exception as e:
        return {"status": "error", "reason": str(e)}


@app.get('/debug/buffer-status')
def get_buffer_status():
    """Get current news buffer status."""
    from app.modules.news_aggregator import get_buffer_status
    return get_buffer_status()


@app.post('/debug/reset-buffer')
def reset_news_buffer():
    """Reset the news buffer and seen URLs. Use this to clear duplicate detection."""
    from app.modules.news_aggregator import reset_buffer
    reset_buffer()
    return {"status": "ok", "message": "News buffer and seen URLs cleared"}


@app.post('/internal/analyze-investment')
def api_analyze_investment(payload: dict):
    """
    Internal API for Investment Service to get specific advice.
    Payload: { symbol, amount, buy_price, target_sell_time, current_time }
    """
    from app.modules.investment_advisor import analyze_investment
    return analyze_investment(payload)
