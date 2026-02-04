"""
Kafka-based Training Data Collector.

This module consumes historical data from Kafka topics:
- market.prices (from stream-ingester)
- news_raw (from crawler-service)

And prepares them for model training.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from confluent_kafka import Consumer, KafkaError, TopicPartition
import pandas as pd
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("KafkaDataCollector")


class KafkaTrainingDataCollector:
    """Collects training data from Kafka topics."""
    
    def __init__(self, kafka_brokers='kafka:9092'):
        self.kafka_brokers = kafka_brokers
        
        # Consumer configs
        self.market_consumer_config = {
            'bootstrap.servers': kafka_brokers,
            'group.id': 'training-data-collector-market',
            'auto.offset.reset': 'earliest',  # Start from beginning
            'enable.auto.commit': False
        }
        
        self.news_consumer_config = {
            'bootstrap.servers': kafka_brokers,
            'group.id': 'training-data-collector-news',
            'auto.offset.reset': 'earliest',
            'enable.auto.commit': False
        }
        
    def collect_market_data(self, symbol='BTCUSDT', hours=24*180, output_file='training_data/historical_candles.csv'):
        """
        Collect market candles from Kafka topic 'market.prices'.
        
        Args:
            symbol: Trading pair
            hours: Number of hours to collect (default: 180 days)
            output_file: Output CSV file path
        """
        logger.info(f"Collecting {hours} hours of market data for {symbol} from Kafka...")
        
        consumer = Consumer(self.market_consumer_config)
        topic = 'market.prices'
        
        try:
            # Get topic partitions
            metadata = consumer.list_topics(topic, timeout=10)
            if topic not in metadata.topics:
                logger.error(f"Topic {topic} not found!")
                return pd.DataFrame()
            
            partitions = [TopicPartition(topic, p) for p in metadata.topics[topic].partitions]
            consumer.assign(partitions)
            
            # Seek to earliest
            for partition in partitions:
                low, high = consumer.get_watermark_offsets(partition, timeout=10)
                partition.offset = low
                consumer.seek(partition)
            
            logger.info(f"Consuming from {len(partitions)} partitions...")
            
            candles = []
            cutoff_time = datetime.now() - timedelta(hours=hours)
            timeout_counter = 0
            max_timeout = 30  # Stop after 30 consecutive empty polls
            
            while timeout_counter < max_timeout:
                msg = consumer.poll(timeout=1.0)
                
                if msg is None:
                    timeout_counter += 1
                    continue
                
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        logger.info(f"Reached end of partition {msg.partition()}")
                        timeout_counter += 1
                        continue
                    else:
                        logger.error(f"Consumer error: {msg.error()}")
                        break
                
                timeout_counter = 0  # Reset on successful message
                
                try:
                    data = json.loads(msg.value().decode('utf-8'))
                    
                    # Filter by symbol
                    if data.get('symbol') != symbol:
                        continue
                    
                    # Parse timestamp
                    timestamp = pd.to_datetime(data.get('timestamp'), unit='ms')
                    
                    # Skip old data
                    if timestamp < cutoff_time:
                        continue
                    
                    # Extract candle data
                    candle = {
                        'timestamp': timestamp,
                        'open': float(data.get('open', 0)),
                        'high': float(data.get('high', 0)),
                        'low': float(data.get('low', 0)),
                        'close': float(data.get('close', 0)),
                        'volume': float(data.get('volume', 0))
                    }
                    
                    candles.append(candle)
                    
                    if len(candles) % 1000 == 0:
                        logger.info(f"Collected {len(candles)} candles...")
                
                except Exception as e:
                    logger.error(f"Error parsing message: {e}")
                    continue
            
            consumer.close()
            
            # Convert to DataFrame
            df = pd.DataFrame(candles)
            
            if len(df) > 0:
                df = df.sort_values('timestamp').drop_duplicates(subset=['timestamp'])
                
                # Save to file
                os.makedirs(os.path.dirname(output_file), exist_ok=True)
                df.to_csv(output_file, index=False)
                
                logger.info(f"✓ Collected {len(df)} candles from {df['timestamp'].min()} to {df['timestamp'].max()}")
                logger.info(f"✓ Saved to {output_file}")
            else:
                logger.warning("No candles collected!")
            
            return df
            
        except Exception as e:
            logger.error(f"Error collecting market data: {e}")
            return pd.DataFrame()
    
    def collect_news_data(self, hours=24*180, output_file='training_data/historical_news.csv'):
        """
        Collect news from Kafka topic 'news_raw'.
        
        Args:
            hours: Number of hours to collect
            output_file: Output CSV file path
        """
        logger.info(f"Collecting {hours} hours of news from Kafka...")
        
        consumer = Consumer(self.news_consumer_config)
        topic = 'news_raw'
        
        try:
            # Get topic partitions
            metadata = consumer.list_topics(topic, timeout=10)
            if topic not in metadata.topics:
                logger.error(f"Topic {topic} not found!")
                return pd.DataFrame()
            
            partitions = [TopicPartition(topic, p) for p in metadata.topics[topic].partitions]
            consumer.assign(partitions)
            
            # Seek to earliest
            for partition in partitions:
                low, high = consumer.get_watermark_offsets(partition, timeout=10)
                partition.offset = low
                consumer.seek(partition)
            
            logger.info(f"Consuming from {len(partitions)} partitions...")
            
            news_items = []
            cutoff_time = datetime.now() - timedelta(hours=hours)
            timeout_counter = 0
            max_timeout = 30
            
            while timeout_counter < max_timeout:
                msg = consumer.poll(timeout=1.0)
                
                if msg is None:
                    timeout_counter += 1
                    continue
                
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        timeout_counter += 1
                        continue
                    else:
                        logger.error(f"Consumer error: {msg.error()}")
                        break
                
                timeout_counter = 0
                
                try:
                    data = json.loads(msg.value().decode('utf-8'))
                    
                    # Parse timestamp
                    timestamp_str = data.get('timestamp') or data.get('published_at')
                    if not timestamp_str:
                        continue
                    
                    timestamp = pd.to_datetime(timestamp_str)
                    
                    # Skip old data
                    if timestamp < cutoff_time:
                        continue
                    
                    # Extract news data
                    news = {
                        'timestamp': timestamp,
                        'title': data.get('title', ''),
                        'content': data.get('content') or data.get('description', ''),
                        'source': data.get('source', ''),
                        'url': data.get('url', '')
                    }
                    
                    news_items.append(news)
                    
                    if len(news_items) % 100 == 0:
                        logger.info(f"Collected {len(news_items)} news articles...")
                
                except Exception as e:
                    logger.error(f"Error parsing message: {e}")
                    continue
            
            consumer.close()
            
            # Convert to DataFrame
            df = pd.DataFrame(news_items)
            
            if len(df) > 0:
                df = df.sort_values('timestamp').drop_duplicates(subset=['url'])
                
                # Save to file
                os.makedirs(os.path.dirname(output_file), exist_ok=True)
                df.to_csv(output_file, index=False)
                
                logger.info(f"✓ Collected {len(df)} news articles from {df['timestamp'].min()} to {df['timestamp'].max()}")
                logger.info(f"✓ Saved to {output_file}")
            else:
                logger.warning("No news collected!")
            
            return df
            
        except Exception as e:
            logger.error(f"Error collecting news data: {e}")
            return pd.DataFrame()


def collect_all_data(kafka_brokers='kafka:9092', symbol='BTCUSDT', days=180):
    """
    Collect all training data from Kafka.
    
    Args:
        kafka_brokers: Kafka broker address
        symbol: Trading pair
        days: Number of days to collect
    """
    logger.info("="*60)
    logger.info("KAFKA TRAINING DATA COLLECTION")
    logger.info("="*60)
    
    collector = KafkaTrainingDataCollector(kafka_brokers=kafka_brokers)
    
    hours = days * 24
    
    # Collect market data
    logger.info(f"\n[1/2] Collecting market data for {symbol}...")
    candles_df = collector.collect_market_data(symbol=symbol, hours=hours)
    
    # Collect news data
    logger.info(f"\n[2/2] Collecting news data...")
    news_df = collector.collect_news_data(hours=hours)
    
    logger.info("\n" + "="*60)
    logger.info("✓ DATA COLLECTION COMPLETED!")
    logger.info("="*60)
    logger.info(f"Candles: {len(candles_df)} records")
    logger.info(f"News: {len(news_df)} records")
    logger.info("="*60)
    
    return candles_df, news_df


if __name__ == '__main__':
    # Get Kafka brokers from environment
    kafka_brokers = os.getenv('KAFKA_BROKERS', 'kafka:9092')
    symbol = os.getenv('SYMBOL', 'BTCUSDT')
    days = int(os.getenv('TRAINING_DAYS', '180'))
    
    collect_all_data(kafka_brokers=kafka_brokers, symbol=symbol, days=days)
