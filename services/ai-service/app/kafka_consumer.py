import os
import json
from confluent_kafka import Consumer, KafkaError
from app.modules.sentiment import analyze_sentiment_text
from app.kafka_producer import produce_news_analyzed
from app.modules.causal import analyze_event_causal
KAFKA_BROKER = os.getenv("KAFKA_BROKERS", "localhost:9092")
GROUP = os.getenv("KAFKA_GROUP", "ai-service-group")
# Support subscribing to the analyzed topic when available (preferred),
# but fall back to raw topic for backward compatibility.
ANALYZED_TOPIC = os.getenv("NEWS_ANALYZED_TOPIC")
RAW_TOPIC = os.getenv("NEWS_RAW_TOPIC")
# Prefer to subscribe to analyzed topic, but if both are present subscribe to both
TOPICS = []
if ANALYZED_TOPIC:
    TOPICS.append(ANALYZED_TOPIC)
if RAW_TOPIC and RAW_TOPIC not in TOPICS:
    TOPICS.append(RAW_TOPIC)
if not TOPICS:
    TOPICS = ["news_analyzed"]

consumer_conf = {
    "bootstrap.servers": KAFKA_BROKER,
    "group.id": GROUP,
    "auto.offset.reset": "earliest"
}
from app.modules.causal import analyze_event_causal
def start_consumer():
    consumer = Consumer(consumer_conf)
    consumer.subscribe(TOPICS)
    print("AI service consumer started, listening to", ",".join(TOPICS))
    try:
        while True:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                else:
                    print("Consumer error:", msg.error())
                    continue
            payload = msg.value().decode("utf-8")
            try:
                j = json.loads(payload)
            except Exception as e:
                print("Invalid json:", e); continue
            # If message already contains sentiment (i.e. is an analyzed message),
            # use it directly. Otherwise compute sentiment and publish news_analyzed
            # so other consumers can also benefit.
            out = None
            if isinstance(j, dict) and (j.get('sentiment_label') is not None or j.get('sentiment_score') is not None):
                out = j
            else:
                # prepare short text for sentiment (title + first 2 paragraphs)
                title = j.get("title") or ""
                content = j.get("content", "") or ""
                paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
                if not paragraphs:
                    paragraphs = [p.strip() for p in content.split('\n') if p.strip()]
                short_text = title
                if paragraphs:
                    short_text = f"{title}\n\n{paragraphs[0]}"
                    if len(paragraphs) > 1:
                        short_text = f"{short_text}\n\n{paragraphs[1]}"

                sentiment = analyze_sentiment_text(short_text)
                label = None
                score = None
                try:
                    if isinstance(sentiment, dict):
                        label = max(sentiment.items(), key=lambda x: x[1])[0]
                        score = float(sentiment.get(label, 0.0))
                    else:
                        label = str(sentiment)
                        score = 0.0
                except Exception:
                    label = None
                    score = None

                out = {
                    "url": j.get("url"),
                    "title": title,
                    # prefer published_at but accept date from crawler
                    "published_at": j.get("published_at") or j.get("date") or None,
                    "sentiment_label": label,
                    "sentiment_score": score,
                    "raw": j
                }
                # produce analyzed for downstream consumers
                try:
                    produce_news_analyzed(out)
                except Exception:
                    pass

            # run lightweight causal analysis per-event and emit ai_insight (best-effort)
            try:
                insight = analyze_event_causal(out)
                # analyze_event_causal returns a dict; print short summary for visibility
                if isinstance(insight, dict):
                    if insight.get('status') == 'insufficient_data':
                        print('Causal analysis insufficient data for', out.get('url'))
                    elif insight.get('status') == 'error':
                        print('Causal analysis error for', out.get('url'), insight.get('reason'))
                    else:
                        # insight may be wrapper {type:..., insight: {...}}
                        print('Produced causal insight for', out.get('url'))
            except Exception as e:
                print('Causal analysis exception for', out.get('url'), str(e))
    except Exception as e:
        print("Consumer stopped:", e)
    finally:
        consumer.close()
