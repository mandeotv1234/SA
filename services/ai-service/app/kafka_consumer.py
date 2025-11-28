import os
import json
from confluent_kafka import Consumer, KafkaError
from app.modules.sentiment import analyze_sentiment_text
from app.kafka_producer import produce_news_analyzed

KAFKA_BROKER = os.getenv("KAFKA_BROKERS", "localhost:9092")
GROUP = os.getenv("KAFKA_GROUP", "ai-service-group")
TOPIC = os.getenv("NEWS_RAW_TOPIC", "news_raw")

consumer_conf = {
    "bootstrap.servers": KAFKA_BROKER,
    "group.id": GROUP,
    "auto.offset.reset": "earliest"
}

def start_consumer():
    consumer = Consumer(consumer_conf)
    consumer.subscribe([TOPIC])
    print("AI service consumer started, listening to", TOPIC)
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
            # prepare short text for sentiment (title + first 2 paragraphs)
            title = j.get("title") or ""
            content = j.get("content", "") or ""
            # split paragraphs by double-newline or by lines
            paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
            if not paragraphs:
                paragraphs = [p.strip() for p in content.split('\n') if p.strip()]
            short_text = title
            if paragraphs:
                short_text = f"{title}\n\n{paragraphs[0]}"
                if len(paragraphs) > 1:
                    short_text = f"{short_text}\n\n{paragraphs[1]}"

            sentiment = analyze_sentiment_text(short_text)
            # sentiment is a dict {positive, negative, neutral}
            # pick label and score
            label = None
            score = None
            try:
                if isinstance(sentiment, dict):
                    # pick max
                    label = max(sentiment.items(), key=lambda x: x[1])[0]
                    score = float(sentiment.get(label, 0.0))
                else:
                    # fallback if sentiment is already a tuple
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
            produce_news_analyzed(out)
    except Exception as e:
        print("Consumer stopped:", e)
    finally:
        consumer.close()
