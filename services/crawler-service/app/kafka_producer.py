import os
import json
import logging
from confluent_kafka import Producer

LOG = logging.getLogger("crawler.kafka")

KAFKA_BROKER = os.getenv("KAFKA_BROKERS", "localhost:9092")
TOPIC = os.getenv("NEWS_RAW_TOPIC", "news_raw")

# Allow passing additional producer config via env (comma-separated key=val)
producer_config = {
    "bootstrap.servers": KAFKA_BROKER,
    # default acks to all for durability
    "acks": os.getenv("KAFKA_ACKS", "all")
}
_extra = os.getenv("KAFKA_PRODUCER_CONFIG")
if _extra:
    for pair in _extra.split(','):
        if '=' in pair:
            k, v = pair.split('=', 1)
            producer_config[k.strip()] = v.strip()

producer = Producer(producer_config)

def _delivery(err, msg):
    if err:
        LOG.error("Delivery failed: %s", err)
    else:
        LOG.debug("Delivered message to %s [%s]@%s", msg.topic(), msg.partition(), msg.offset())


def produce_news(data: dict, flush: bool = False):
    """Produce a news JSON to Kafka topic.

    data should be JSON-serializable (dict with source, url, title, content, published_at)
    """
    try:
        payload = json.dumps(data, ensure_ascii=False)
        producer.produce(TOPIC, payload.encode("utf-8"), callback=_delivery)
        # poll to serve delivery callbacks
        producer.poll(0)
    except Exception as e:
        LOG.exception("Failed to produce message: %s", e)
        raise
    if flush:
        try:
            producer.flush(10)
        except Exception:
            LOG.exception("flush failed")


def close_producer(timeout: int = 10):
    try:
        LOG.info("Flushing Kafka producer before shutdown")
        producer.flush(timeout)
    except Exception:
        LOG.exception("Error flushing producer")
