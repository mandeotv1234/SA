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

                # if kline nested
                k = j.get('kline') or j.get('k') or j.get('kline')
                if isinstance(k, dict):
                    # prefer closeTime, then openTime
                    t = k.get('closeTime') or k.get('close_time') or k.get('openTime') or k.get('open_time') or k.get('t') or k.get('T')
                    close = k.get('close') or k.get('c')
                else:
                    # top-level fields
                    t = j.get('time') or j.get('ts') or j.get('open_time') or j.get('t')
                    close = j.get('close') or j.get('c') or j.get('price')

                # normalize numeric types and timestamps (ms -> s)
                try:
                    if t is not None:
                        t = int(t)
                        # if milliseconds, convert to seconds
                        if t > 1_000_000_000_000:
                            t = int(t / 1000)
                except Exception:
                    t = None
                try:
                    if close is not None:
                        close = float(close)
                except Exception:
                    close = None

                if sym and t and close is not None:
                    try:
                        _cache[sym].append((int(t), float(close)))
                    except Exception:
                        # skip malformed
                        pass
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
    """Return up to `limit` (time, close) tuples for given symbol, oldest->newest."""
    deq = _cache.get(symbol)
    if not deq:
        return []
    res = list(deq)
    if limit and len(res) > limit:
        return res[-limit:]
    return res
