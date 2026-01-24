import os
import json
import logging
from confluent_kafka import Producer
from confluent_kafka.admin import AdminClient, NewTopic

LOG = logging.getLogger("ai.kafka")

KAFKA_BROKER = os.getenv("KAFKA_BROKER", os.getenv("KAFKA_BROKERS", "localhost:9092"))
producer = Producer({"bootstrap.servers": KAFKA_BROKER})

NEWS_ANALYZED_TOPIC = os.getenv("NEWS_ANALYZED_TOPIC", "news_analyzed")
AI_INSIGHTS_TOPIC = os.getenv("AI_INSIGHTS_TOPIC", "ai_insights")

def create_startup_topics():
    """Explicitly create topics on startup to avoid consumer errors."""
    admin_client = AdminClient({'bootstrap.servers': KAFKA_BROKER})
    # Create topics with 1 partition and replication factor 1
    new_topics = [
        NewTopic(NEWS_ANALYZED_TOPIC, num_partitions=1, replication_factor=1),
        NewTopic(AI_INSIGHTS_TOPIC, num_partitions=1, replication_factor=1),
        NewTopic("investment.analysis.request", num_partitions=1, replication_factor=1),
        NewTopic("investment.analysis.result", num_partitions=1, replication_factor=1)
    ]
    
    fs = admin_client.create_topics(new_topics)

    for topic, f in fs.items():
        try:
            f.result()
            LOG.info("Topic {} created".format(topic))
        except Exception as e:
            LOG.info("Topic {} creation failed (might already exist): {}".format(topic, e))


def _delivery(err, msg):
    if err:
        LOG.error("Delivery failed: %s", err)
    else:
        LOG.debug("Delivered to %s [%s]@%s", msg.topic(), msg.partition(), msg.offset())


def produce_news_analyzed(data: dict, flush: bool = False):
    try:
        producer.produce(NEWS_ANALYZED_TOPIC, json.dumps(data, ensure_ascii=False).encode("utf-8"), callback=_delivery)
        producer.poll(0)
    except Exception:
        LOG.exception("Failed producing news_analyzed")
        raise
    if flush:
        try:
            producer.flush(10)
        except Exception:
            LOG.exception("Producer flush failed")


import numpy as np

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(CustomJSONEncoder, self).default(obj)

def produce_ai_insight(data: dict, flush: bool = False):
    try:
        # Use custom encoder to handle numpy types (float32, etc.)
        payload = json.dumps(data, ensure_ascii=False, cls=CustomJSONEncoder).encode("utf-8")
        producer.produce(AI_INSIGHTS_TOPIC, payload, callback=_delivery)
        producer.poll(0)
        
        # Log summary of what was published
        meta = data.get('meta', {})
        predictions_count = len(data.get('predictions', []))
        print(f"[KAFKA-PUBLISH] Sent prediction to '{AI_INSIGHTS_TOPIC}': {predictions_count} symbols, sentiment={meta.get('market_sentiment_label', 'N/A')}")
        
    except Exception:
        LOG.exception("Failed producing ai_insight")
        raise
    if flush:
        try:
            producer.flush(10)
        except Exception:
            LOG.exception("Producer flush failed")


INVESTMENT_ANALYSIS_RESULT_TOPIC = "investment.analysis.result"

def produce_investment_result(data: dict, flush: bool = False):
    try:
        payload = json.dumps(data, ensure_ascii=False, cls=CustomJSONEncoder).encode("utf-8")
        producer.produce(INVESTMENT_ANALYSIS_RESULT_TOPIC, payload, callback=_delivery)
        producer.poll(0)
    except Exception:
        LOG.exception("Failed producing investment_result")
        raise
    if flush:
        try:
            producer.flush(10)
        except Exception:
            LOG.exception("Producer flush failed")


def close_producer(timeout: int = 10):
    try:
        LOG.info("Flushing producer before shutdown")
        producer.flush(timeout)
    except Exception:
        LOG.exception("Error flushing producer")
