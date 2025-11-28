import os
import json
import logging
from confluent_kafka import Producer

LOG = logging.getLogger("ai.kafka")

KAFKA_BROKER = os.getenv("KAFKA_BROKER", os.getenv("KAFKA_BROKERS", "localhost:9092"))
producer = Producer({"bootstrap.servers": KAFKA_BROKER})

NEWS_ANALYZED_TOPIC = os.getenv("NEWS_ANALYZED_TOPIC", "news_analyzed")
AI_INSIGHTS_TOPIC = os.getenv("AI_INSIGHTS_TOPIC", "ai_insights")


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


def produce_ai_insight(data: dict, flush: bool = False):
    try:
        producer.produce(AI_INSIGHTS_TOPIC, json.dumps(data, ensure_ascii=False).encode("utf-8"), callback=_delivery)
        producer.poll(0)
    except Exception:
        LOG.exception("Failed producing ai_insight")
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
