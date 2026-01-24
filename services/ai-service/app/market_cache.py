from collections import defaultdict, deque
import os
import json
import threading
import time
from confluent_kafka import Consumer

# Simple in-memory market data cache populated from Kafka topic (market_data)
# Keeps recent 1m candles per symbol in a deque for fast lookup by ai-service.

KAFKA_BROKER = os.getenv("KAFKA_BROKERS", "localhost:9092")
MARKET_TOPIC = os.getenv("MARKET_DATA_TOPIC", "market_data")
GROUP_ID = os.getenv("MARKET_CACHE_GROUP", "ai-service-market-cache-v3")
MAX_PER_SYMBOL = int(os.getenv("MARKET_CACHE_MAX", "2000"))

_cache = defaultdict(lambda: deque(maxlen=MAX_PER_SYMBOL))
_running = False


def _start_consumer():
    global _running
    conf = {
        "bootstrap.servers": KAFKA_BROKER,
        "group.id": GROUP_ID,
        "auto.offset.reset": "earliest",
    }
    consumer = Consumer(conf)
    consumer.subscribe([MARKET_TOPIC])
    _running = True
    try:
        while _running:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                # ignore partition EOF
                continue
            try:
                payload = msg.value().decode("utf-8")
                j = json.loads(payload)
                # Support multiple incoming shapes. Common shapes:
                # 1) {"symbol":"BTCUSDT","time":...,"close":...}
                # 2) {"symbol":"BTCUSDT","kline":{"openTime":...,"closeTime":...,"close":...}}
                # 3) Binance stream combined event: {"stream":..., "data": {...}}
                sym = None
                t = None
                close = None

                # unwrap nested 'data' (some producers wrap messages)
                if isinstance(j, dict) and 'data' in j and isinstance(j['data'], dict):
                    j = j['data']

                # primary symbol
                sym = j.get('symbol') or j.get('s')

                # extract full OHLCV
                open_p = None
                high_p = None
                low_p = None
                vol = None
                
                # if kline nested
                k = j.get('kline') or j.get('k') or j.get('kline')
                if isinstance(k, dict):
                    t = k.get('closeTime') or k.get('close_time') or k.get('openTime') or k.get('open_time') or k.get('t') or k.get('T')
                    close = k.get('close') or k.get('c')
                    open_p = k.get('open') or k.get('o')
                    high_p = k.get('high') or k.get('h')
                    low_p = k.get('low') or k.get('l')
                    vol = k.get('volume') or k.get('v')
                else:
                    t = j.get('time') or j.get('ts') or j.get('open_time') or j.get('t')
                    close = j.get('close') or j.get('c') or j.get('price')
                    open_p = j.get('open') or j.get('o') or close # fallback to close
                    high_p = j.get('high') or j.get('h') or close
                    low_p = j.get('low') or j.get('l') or close
                    vol = j.get('volume') or j.get('v') or 0

                # normalize numeric types and timestamps (ms -> s)
                try:
                    if t is not None:
                        t = int(t)
                        if t > 1_000_000_000_000: t = int(t / 1000)
                        
                    close = float(close) if close is not None else 0.0
                    open_p = float(open_p) if open_p is not None else close
                    high_p = float(high_p) if high_p is not None else close
                    low_p = float(low_p) if low_p is not None else close
                    vol = float(vol) if vol is not None else 0.0
                except Exception:
                    continue

                if sym and t:
                    _cache[sym].append({
                        "time": int(t),
                        "open": open_p, 
                        "high": high_p, 
                        "low": low_p, 
                        "close": close, 
                        "volume": vol
                    })

            except Exception:
                continue
    finally:
        try:
            consumer.close()
        except Exception:
            pass


def start_market_cache_thread():
    t = threading.Thread(target=_start_consumer, daemon=True)
    t.start()


def get_candles(symbol: str, limit: int):
    """Return up to `limit` dicts (time, open, high, low, close, volume) for given symbol, oldest->newest."""
    deq = _cache.get(symbol)
    if not deq:
        return []
    res = list(deq)
    if limit and len(res) > limit:
        return res[-limit:]
    return res
