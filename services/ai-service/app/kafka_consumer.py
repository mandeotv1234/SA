"""
Kafka Consumer for AI Service.
- Receives news from crawler
- Buffers news for scheduled prediction
- Runs prediction every 5 minutes for ALL trading pairs
"""
import os
import json
from confluent_kafka import Consumer, KafkaError
from app.modules.sentiment import analyze_sentiment_text
from app.kafka_producer import produce_news_analyzed
from app.modules.news_aggregator import process_news, start_scheduler, get_buffer_status

KAFKA_BROKER = os.getenv("KAFKA_BROKERS", "localhost:9092")
GROUP = os.getenv("KAFKA_GROUP", "ai-service-group")

# Topics configuration
ANALYZED_TOPIC = os.getenv("NEWS_ANALYZED_TOPIC")
RAW_TOPIC = os.getenv("NEWS_RAW_TOPIC")

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


def start_consumer():
    """
    Main consumer loop.
    
    Architecture:
    1. Receive news from Kafka
    2. Add to aggregator buffer (no LLM call)
    3. Scheduler runs prediction every 5 minutes for ALL symbols
    """
    # Start the background scheduler for predictions
    start_scheduler()
    
    consumer = Consumer(consumer_conf)
    consumer.subscribe(TOPICS)
    
    print(f"\n{'='*60}")
    print(f"AI SERVICE CONSUMER STARTED")
    print(f"Topics: {', '.join(TOPICS)}")
    print(f"Mode: SCHEDULED PREDICTION (every 5 minutes)")
    print(f"{'='*60}\n")
    
    try:
        message_count = 0
        while True:
            msg = consumer.poll(1.0)
            
            if msg is None:
                continue
                
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                else:
                    print(f"[CONSUMER ERROR] {msg.error()}")
                    continue
            
            # Parse message
            payload = msg.value().decode("utf-8")
            try:
                j = json.loads(payload)
            except Exception as e:
                print(f"[JSON ERROR] {e}")
                continue
            
            message_count += 1
            title = j.get("title") or ""
            
            # Quick relevance check
            relevance = float(j.get('relevance_score') or 0.5)
            category = j.get('category', 'General')
            
            if relevance < 0.3 and category not in ['Finance', 'Economy', 'Policy', 'Crypto', 'Market']:
                continue  # Silently skip low relevance
            
            # Add sentiment if not present
            if not (j.get('sentiment_label') or j.get('sentiment_score')):
                content = j.get("content", "") or ""
                short_text = f"{title}\n\n{content[:500]}"
                
                crawler_sentiment = j.get("sentiment")
                if crawler_sentiment:
                    label = crawler_sentiment
                    score = 0.9 if label.lower() == 'positive' else (-0.9 if label.lower() == 'negative' else 0.0)
                else:
                    sentiment = analyze_sentiment_text(short_text)
                    try:
                        if isinstance(sentiment, dict):
                            label = max(sentiment.items(), key=lambda x: x[1])[0]
                            score = float(sentiment.get(label, 0.0))
                        else:
                            label = str(sentiment)
                            score = 0.0
                    except Exception:
                        label = "Neutral"
                        score = 0.0
                
                j['sentiment_label'] = label
                j['sentiment_score'] = score
            
            # Extract original raw data without nesting
            # If j already has a 'raw' field, use that as the source
            original_raw = j
            while isinstance(original_raw.get('raw'), dict):
                original_raw = original_raw['raw']
            
            out = {
                "url": j.get("url") or original_raw.get("url"),
                "title": title or original_raw.get("title"),
                "source": original_raw.get("source"),
                "published_at": j.get("published_at") or j.get("date") or original_raw.get("published_at"),
                "sentiment_label": j.get('sentiment_label') or original_raw.get('sentiment'),
                "sentiment_score": j.get('sentiment_score', 0),
                "content": original_raw.get("content", "")[:2000],
                "category": original_raw.get("category", "General"),
                "relevance_score": original_raw.get("relevance_score", 0.5),
                "symbols": original_raw.get("symbols", ["BTCUSDT"])
            }
            
            # Publish to news_analyzed topic (flat structure, no nested raw)
            try:
                produce_news_analyzed(out)
            except Exception:
                pass
            
            # Add to buffer (prediction runs on schedule)
            result = process_news(out)
            
            if result.get("status") == "duplicate":
                # Don't spam logs with duplicates
                pass
            else:
                # New article added
                buffer_size = result.get("buffer_size", 0)
                if buffer_size % 5 == 0:  # Log every 5 articles
                    print(f"[STATUS] Buffer: {buffer_size} articles")
                
    except KeyboardInterrupt:
        print("\n[CONSUMER] Shutting down...")
    except Exception as e:
        print(f"[CONSUMER ERROR] {e}")
    finally:
        consumer.close()
        print("[CONSUMER] Closed")
