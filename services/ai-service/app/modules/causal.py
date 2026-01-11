import os
import time
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import shap
from app.kafka_producer import produce_ai_insight
import os
import requests
from datetime import datetime, timezone
import logging
try:
    from google import generativeai as genai
    HAS_GENAI = True
except Exception:
    HAS_GENAI = False

LOG = logging.getLogger("ai.causal")

def fetch_features_and_target():
    # Placeholder: in production, query TimescaleDB to get aligned features and target
    np.random.seed(0)
    X = pd.DataFrame({
        "sentiment_pos": np.random.rand(100),
        "market_momentum": np.random.rand(100),
        "volume": np.random.rand(100)
    })
    y = X["market_momentum"]*0.6 + X["sentiment_pos"]*0.3 + 0.1*np.random.randn(100)
    return X, y

def causal_explain(X, y):
    model = RandomForestRegressor(n_estimators=50)
    model.fit(X, y)
    explainer = shap.Explainer(model.predict, X)
    shap_values = explainer(X)
    mean_abs_shap = np.abs(shap_values.values).mean(axis=0)
    contribution = mean_abs_shap / mean_abs_shap.sum()
    res = {feat: float(round(100*float(contribution[i]),2)) for i, feat in enumerate(X.columns)}
    return {"model": "RandomForest", "contribution_percent": res}

def run_causal_now():
    X, y = fetch_features_and_target()
    res = causal_explain(X, y)
    insight = {
        "timestamp": int(time.time()),
        "explanation": res,
        "summary": "Auto causal run"
    }
    # publish as a summary type so consumers can distinguish scheduled summaries
    try:
        produce_ai_insight({"type": "causal_summary", "insight": insight})
    except Exception:
        # best-effort: swallow
        pass
    return insight

from apscheduler.schedulers.background import BackgroundScheduler

def schedule_causal_job():
    interval_minutes = int(os.getenv("CAUSAL_INTERVAL_MIN", "60"))
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_causal_now, 'interval', minutes=interval_minutes, id="causal_job", replace_existing=True)
    scheduler.start()
    print(f"Causal job scheduled every {interval_minutes} minutes")


def analyze_event_causal(news_payload: dict):
    """
    Lightweight causal-like event analysis for a single news item.
    - Fetch recent klines from core-service (default symbol or env-specified)
    - Compute average price before and after the event and return percent change
    - Package a small insight object and return it (and also produce it via Kafka if desired)

    This is intentionally simple: a short-window pre/post return which is useful for UI panes.
    """
    try:
        CORE_URL = os.getenv('CORE_API_URL', 'http://core-service:3000')
        default_symbol = os.getenv('CAUSAL_DEFAULT_SYMBOL', 'BTCUSDT')
        # window minutes pre/post
        pre_mins = int(os.getenv('CAUSAL_PRE_MINS', '10'))
        post_mins = int(os.getenv('CAUSAL_POST_MINS', '10'))

        # determine event time
        published = news_payload.get('published_at') or news_payload.get('date') or None
        if published:
            try:
                event_ts = datetime.fromisoformat(published.replace('Z', '+00:00'))
            except Exception:
                # fallback to now
                event_ts = datetime.now(timezone.utc)
        else:
            event_ts = datetime.now(timezone.utc)

        # pick symbol: allow override from payload top-level 'symbol' or nested raw
        sym = default_symbol
        # top-level symbol if present
        if news_payload.get('symbol'):
            sym = news_payload.get('symbol')
        raw = news_payload.get('raw') or {}
        if isinstance(raw, dict):
            sym_guess = raw.get('symbol') or raw.get('ticker') or raw.get('source_symbol')
            if sym_guess:
                sym = sym_guess

        # Use Kafka-backed market cache (populated by stream-service -> Kafka) instead
        # of calling core API. This keeps the ai-service decoupled and offline-friendly.
        try:
            from app.market_cache import get_candles
            HAVE_MARKET_CACHE = True
        except Exception:
            HAVE_MARKET_CACHE = False

        MAX_WINDOW_MINS = int(os.getenv('CAUSAL_MAX_WINDOW_MINS', '120'))
        tried_windows = []
        last_err = None

        # Market candles are read from the local Kafka-backed market cache only.
        # We intentionally remove any external finance API fallbacks to keep ai-service
        # self-contained and not dependent on external REST calls for production runs.
        def try_get_points(symbol, total_candles):
            pts = []
            if HAVE_MARKET_CACHE:
                try:
                    pts = get_candles(symbol, total_candles)
                except Exception as e:
                    last_err = f"market_cache_error: {e}"
            # do not call external finance APIs here (Binance) — rely on market_cache only
            return pts

        # try progressively larger windows until limit
        points = []
        cur_pre = pre_mins
        cur_post = post_mins
        while (cur_pre + cur_post) <= MAX_WINDOW_MINS:
            total_candles = (cur_pre + cur_post + 10)
            tried_windows.append({'pre': cur_pre, 'post': cur_post, 'candles': total_candles})
            points = try_get_points(sym, total_candles)
            if points and len(points) >= (cur_pre + cur_post):
                # got enough candles
                pre_mins = cur_pre
                post_mins = cur_post
                break
            # expand windows (double)
            if (cur_pre + cur_post) == 0:
                cur_pre = 1
                cur_post = 1
            else:
                cur_pre = min(MAX_WINDOW_MINS, max(1, cur_pre * 2))
                cur_post = min(MAX_WINDOW_MINS, max(1, cur_post * 2))

        if not points or len(points) < (pre_mins + post_mins):
            return {
                "timestamp": int(datetime.now(timezone.utc).timestamp()),
                "status": "insufficient_data",
                "url": news_payload.get('url'),
                "tried_windows": tried_windows,
                "last_error": last_err
            }
        # At this point `points` is already a list of (time, close) tuples returned
        # by try_get_points above (or by fetch_binance). Ensure it is in the form
        # expected (oldest -> newest). If returned items are dict-like, convert.
        normalized = []
        for item in points:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                normalized.append((int(item[0]), float(item[1])))
            elif isinstance(item, dict):
                if item.get('time') and item.get('close'):
                    normalized.append((int(item.get('time')), float(item.get('close'))))
        points = normalized

        # find nearest index to event_ts
        event_sec = int(event_ts.timestamp())
        times = [p[0] for p in points]
        # find insertion index
        import bisect
        idx = bisect.bisect_left(times, event_sec)

        # slice pre and post windows
        pre_start = max(0, idx - pre_mins)
        pre_end = max(0, idx)
        post_start = min(len(points), idx)
        post_end = min(len(points), idx + post_mins)

        pre_vals = [p[1] for p in points[pre_start:pre_end]]
        post_vals = [p[1] for p in points[post_start:post_end]]

        # PREDICTION MODE:
        # If the news is relatively recent (e.g. within last 24 hours = 1440 mins),
        # we treat it as a prediction event. The user wants to see "Dự đoán" for valid news.
        # We will provide the existing post-data to the AI so it can comment on the initial reaction.
        is_prediction = len(post_vals) < 1440
        
        if pre_vals and not post_vals:
            # No post data at all (brand new)
            pre_avg = sum(pre_vals) / len(pre_vals)
            post_avg = pre_avg 
            ret = 0.0
        elif not pre_vals:
             # not enough resolution around event
            return {"timestamp": int(datetime.now(timezone.utc).timestamp()), "status": "insufficient_data", "url": news_payload.get('url'), "used_candles": {"pre": len(pre_vals), "post": len(post_vals)}}
        else:
            # We have both pre and post
            pre_avg = sum(pre_vals) / len(pre_vals)
            post_avg = sum(post_vals) / len(post_vals)
            ret = (post_avg - pre_avg) / pre_avg if pre_avg != 0 else 0.0

        # crude confidence: more candles -> higher confidence
        conf = min(0.99, min(1.0, (len(pre_vals) + len(post_vals)) / float(total_candles)) * 0.8)

        insight = {
            "timestamp": int(datetime.now(timezone.utc).timestamp()),
            "event_time": event_ts.isoformat(),
            "url": news_payload.get('url'),
            "title": news_payload.get('title'),
            "symbol": sym,
            "pre_avg": float(pre_avg),
            "post_avg": float(post_avg),
            "return_pct": float(ret),
            "window_mins": {"pre": pre_mins, "post": post_mins},
            "confidence": float(conf),
            "raw_news": news_payload,
            "used_candles": {"pre": len(pre_vals), "post": len(post_vals)},
            "is_prediction": is_prediction
        }

        # optionally generate a short natural-language rationale via Ollama (Llama 3.2 via Ngrok)
        rationale = None
        prediction_direction = None
        predicted_change_pct = None
        try:
            if is_prediction:
                prompt = (
                    "Bạn là một chuyên gia phân tích tài chính AI. Nhiệm vụ của bạn là DỰ ĐOÁN xu hướng giá trong 24 giờ tới.\n\n"
                    "Dữ liệu đầu vào:\n"
                    f"- Tin tức: {news_payload.get('title') or ''}\n"
                    f"- URL: {news_payload.get('url')}\n"
                    f"- Cặp tiền: {sym}\n"
                    f"- Giá hiện tại: {pre_avg:.2f} USD\n"
                    f"- Phản ứng ban đầu ({len(post_vals)} phút): {ret*100:.4f}%\n"
                    f"- Cảm xúc tin tức: {news_payload.get('sentiment_label') or 'Neutral'}\n\n"
                    "YÊU CẦU: Trả về JSON với định dạng CHÍNH XÁC sau:\n"
                    "```json\n"
                    "{\n"
                    '  "direction": "UP" hoặc "DOWN" hoặc "NEUTRAL",\n'
                    '  "predicted_change_pct": số phần trăm dự đoán (ví dụ: 2.5 cho tăng 2.5%, -1.5 cho giảm 1.5%),\n'
                    '  "rationale": "Giải thích ngắn gọn nguyên nhân và hậu quả (tiếng Việt, 1-2 câu)"\n'
                    "}\n"
                    "```\n\n"
                    "CHỈ TRẢ VỀ JSON, KHÔNG CÓ TEXT KHÁC."
                )
            else:
                prompt = (
                    "Bạn là một chuyên gia phân tích tài chính. Dựa trên dữ liệu lịch sử sau, hãy giải thích biến động giá:\n"
                    f"Tiêu đề: {news_payload.get('title') or ''}\n"
                    f"URL: {news_payload.get('url') or ''}\n"
                    f"Symbol: {sym}\n"
                    f"Pre average: {pre_avg:.6f}, Post average: {post_avg:.6f}, Return: {ret:.6f}\n"
                    "Trả về JSON: {\"direction\": \"UP/DOWN/NEUTRAL\", \"actual_change_pct\": X, \"rationale\": \"...\"}"
                )

            ollama_url = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
            model = os.getenv("OLLAMA_MODEL", "llama3.2")
            api_endpoint = f"{ollama_url}/api/generate"
            
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "format": "json"
            }
            
            # Log attempt (helpful for debugging)
            print(f"Calling Ollama at {api_endpoint} with model {model}...")
            
            start_t = time.time()
            response = requests.post(api_endpoint, json=payload, timeout=60)
            
            if response.status_code == 200:
                data = response.json()
                raw_response = data.get("response", "")
                print(f"Ollama generation succeeded in {time.time()-start_t:.2f}s")
                
                # Parse JSON response
                try:
                    import json as json_lib
                    parsed = json_lib.loads(raw_response)
                    prediction_direction = parsed.get("direction", "NEUTRAL").upper()
                    predicted_change_pct = float(parsed.get("predicted_change_pct", 0) or 0)
                    rationale = parsed.get("rationale", "")
                    
                    # Normalize direction
                    if prediction_direction not in ["UP", "DOWN", "NEUTRAL"]:
                        if "tăng" in prediction_direction.lower():
                            prediction_direction = "UP"
                        elif "giảm" in prediction_direction.lower():
                            prediction_direction = "DOWN"
                        else:
                            prediction_direction = "NEUTRAL"
                    
                    # Set return_pct based on predicted direction for UI color
                    if prediction_direction == "UP":
                        insight['return_pct'] = abs(predicted_change_pct) / 100.0
                    elif prediction_direction == "DOWN":
                        insight['return_pct'] = -abs(predicted_change_pct) / 100.0
                    else:
                        insight['return_pct'] = 0.0
                        
                except Exception as parse_err:
                    print(f"Failed to parse Ollama JSON response: {parse_err}")
                    rationale = raw_response  # Use raw text as fallback
                    
            else:
                print(f"Ollama failed with status {response.status_code}: {response.text}")
                rationale = None

        except Exception as e:
            print(f"Ollama prediction error: {e}")
            rationale = None

        # attach rationale and produce insight message
        full_msg = {"type": "causal_event", "insight": insight}
        if rationale:
            full_msg['insight']['rationale'] = rationale
        if prediction_direction:
            full_msg['insight']['prediction_direction'] = prediction_direction
        if predicted_change_pct is not None:
            full_msg['insight']['predicted_change_pct'] = predicted_change_pct
        # produce insight to Kafka (best-effort)
        try:
            produce_ai_insight(full_msg)
            # visible log - helpful while debugging in container logs
            if rationale:
                print(f"Published causal_event for {news_payload.get('url')} with rationale (len={len(str(rationale))})")
            else:
                print(f"Published causal_event for {news_payload.get('url')} without rationale")
        except Exception as e:
            print(f"Failed to publish causal_event for {news_payload.get('url')}: {e}")

        # return insight (including rationale if present)
        return full_msg
    except Exception as e:
        return {"timestamp": int(datetime.now(timezone.utc).timestamp()), "status": "error", "reason": str(e)}
