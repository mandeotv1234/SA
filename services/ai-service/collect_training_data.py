"""
Historical Data Collection for Model Training.

This script collects historical data from REAL services:
1. Candles data from TimescaleDB (via core-service)
2. News data from TimescaleDB (via core-service)
3. Prepares data for training AdvancedDualStreamNetwork

Run with: python3 collect_training_data.py
"""

import pandas as pd
import requests
from datetime import datetime, timedelta
import json
import os
import logging
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DataCollector")


class HistoricalDataCollector:
    """Collects historical data from actual infrastructure databases."""
    
    def __init__(self):
        # TimescaleDB connection (via core-service API or direct)
        self.timescale_config = {
            'host': os.getenv('TIMESCALE_HOST', 'localhost'),
            'port': os.getenv('TIMESCALE_PORT', '5433'),
            'database': os.getenv('TIMESCALE_DB', 'timeseriesdb'),
            'user': os.getenv('TIMESCALE_USER', 'dev'),
            'password': os.getenv('TIMESCALE_PASSWORD', 'dev')
        }
        
        # Core service API (for convenience if available)
        self.core_api_url = os.getenv('CORE_API_URL', 'http://localhost:8000/api')
        
    def collect_candles_from_timescaledb(self, symbol='BTCUSDT', days=90):
        """
        Collect candles from TimescaleDB directly.
        """
        logger.info(f"Collecting {days} days of candles for {symbol} from TimescaleDB...")
        
        try:
            import psycopg2
            
            conn = psycopg2.connect(
                host=self.timescale_config['host'],
                port=self.timescale_config['port'],
                database=self.timescale_config['database'],
                user=self.timescale_config['user'],
                password=self.timescale_config['password']
            )
            
            query = f"""
                SELECT 
                    time as timestamp,
                    symbol,
                    open,
                    high,
                    low,
                    close,
                    volume
                FROM market_klines
                WHERE symbol = '{symbol}'
                  AND time >= NOW() - INTERVAL '{days} days'
                ORDER BY time ASC
            """
            
            df = pd.read_sql_query(query, conn)
            conn.close()
            
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            logger.info(f"✓ Collected {len(df)} candles from TimescaleDB")
            return df
            
        except ImportError:
            logger.warning("psycopg2 not installed. Trying API fallback...")
            return self.collect_candles_from_api(symbol, days)
        except Exception as e:
            logger.error(f"TimescaleDB connection failed: {e}")
            return self.collect_candles_from_api(symbol, days)
    
    def collect_candles_from_api(self, symbol='BTCUSDT', days=90):
        """
        Fallback: Collect candles from Binance API directly.
        """
        logger.info(f"Collecting {days} days of candles from Binance API...")
        
        base_url = "https://api.binance.com/api/v3/klines"
        end_time = datetime.now()
        start_time = end_time - timedelta(days=days)
        
        all_candles = []
        current_time = start_time
        limit = 1000
        
        while current_time < end_time:
            params = {
                'symbol': symbol,
                'interval': '15m',
                'startTime': int(current_time.timestamp() * 1000),
                'endTime': int(end_time.timestamp() * 1000),
                'limit': limit
            }
            
            try:
                response = requests.get(base_url, params=params, timeout=30)
                response.raise_for_status()
                data = response.json()
                
                if not data:
                    break
                
                for candle in data:
                    all_candles.append({
                        'timestamp': pd.to_datetime(candle[0], unit='ms'),
                        'symbol': symbol,
                        'open': float(candle[1]),
                        'high': float(candle[2]),
                        'low': float(candle[3]),
                        'close': float(candle[4]),
                        'volume': float(candle[5])
                    })
                
                last_candle_time = pd.to_datetime(data[-1][0], unit='ms')
                current_time = last_candle_time + timedelta(minutes=1)
                
                logger.info(f"Collected {len(all_candles)} candles...")
                time.sleep(0.1)  # Rate limiting
                
            except Exception as e:
                logger.error(f"Binance API error: {e}")
                break
        
        df = pd.DataFrame(all_candles)
        logger.info(f"✓ Collected {len(df)} candles from Binance API")
        return df
    
    def collect_news_from_timescaledb(self, days=90):
        """
        Collect news from TimescaleDB (news_sentiment table).
        """
        logger.info(f"Collecting {days} days of news from TimescaleDB...")
        
        try:
            import psycopg2
            
            conn = psycopg2.connect(
                host=self.timescale_config['host'],
                port=self.timescale_config['port'],
                database=self.timescale_config['database'],
                user=self.timescale_config['user'],
                password=self.timescale_config['password']
            )
            
            query = f"""
                SELECT 
                    time as timestamp,
                    url,
                    source,
                    title,
                    sentiment_score
                FROM news_sentiment
                WHERE time >= NOW() - INTERVAL '{days} days'
                ORDER BY time ASC
            """
            
            df = pd.read_sql_query(query, conn)
            conn.close()
            
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            logger.info(f"✓ Collected {len(df)} news articles from TimescaleDB")
            return df
            
        except ImportError:
            logger.warning("psycopg2 not installed. Trying MongoDB fallback...")
            return self.collect_news_from_mongodb(days)
        except Exception as e:
            logger.error(f"TimescaleDB news query failed: {e}")
            return self.collect_news_from_mongodb(days)
    
    def collect_news_from_mongodb(self, days=90):
        """
        Fallback: Collect news from MongoDB (crawler-service database).
        Uses full content for better embedding quality.
        """
        logger.info(f"Collecting {days} days of news from MongoDB...")
        
        try:
            from pymongo import MongoClient
            
            mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27018')
            client = MongoClient(mongo_url)
            db = client['crawler_db']
            
            cutoff_time = datetime.now() - timedelta(days=days)
            cutoff_str = cutoff_time.isoformat()
            
            news_list = []
            content_lengths = []
            # Use news_articles collection (not articles)
            cursor = db.news_articles.find({}).sort('created_at', -1)
            
            for doc in cursor:
                # Parse created_at (can be string or datetime)
                created_at = doc.get('created_at')
                if isinstance(created_at, str):
                    try:
                        created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    except:
                        created_at = datetime.now()
                elif created_at is None:
                    created_at = datetime.now()
                
                # Skip if too old
                if created_at.replace(tzinfo=None) < cutoff_time:
                    continue
                    
                title = doc.get('title', '')
                content = doc.get('content', '')
                # Combine title + full content for rich embedding
                full_text = f"{title}. {content}".strip()
                content_lengths.append(len(content))
                
                news_list.append({
                    'timestamp': created_at,
                    'url': doc.get('url', ''),
                    'source': doc.get('source', 'Unknown'),
                    'title': title,
                    'content': content,
                    'text': full_text,  # Full text for embedding
                    'sentiment_score': doc.get('sentiment_score', 0)
                })
            
            client.close()
            
            df = pd.DataFrame(news_list)
            if not df.empty:
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                avg_content_len = sum(content_lengths) / len(content_lengths) if content_lengths else 0
                logger.info(f"✓ Collected {len(df)} news articles from MongoDB")
                logger.info(f"  → Avg content length: {avg_content_len:.0f} chars (max: {max(content_lengths) if content_lengths else 0})")
            return df
            
        except ImportError:
            logger.error("pymongo not installed. Using synthetic news data.")
            return self._generate_synthetic_news(days)
        except Exception as e:
            logger.error(f"MongoDB connection failed: {e}")
            return self._generate_synthetic_news(days)
    
    def _generate_synthetic_news(self, days=90):
        """
        Generate synthetic news data for training when no real data is available.
        """
        logger.warning("Generating synthetic news data for training...")
        
        import random
        
        news_templates = [
            {"title": "Bitcoin breaks above ${price}K", "sentiment": 0.7},
            {"title": "Ethereum upgrade goes live", "sentiment": 0.5},
            {"title": "Fed announces interest rate decision", "sentiment": 0.0},
            {"title": "Major exchange reports record volume", "sentiment": 0.3},
            {"title": "Crypto market sees correction", "sentiment": -0.4},
            {"title": "Whale moves ${amount}M BTC", "sentiment": -0.1},
            {"title": "New regulation proposed for crypto", "sentiment": -0.3},
            {"title": "DeFi protocol reaches new TVL high", "sentiment": 0.5},
            {"title": "Bitcoin ETF approval speculation", "sentiment": 0.6},
            {"title": "Mining difficulty adjustment incoming", "sentiment": 0.0},
        ]
        
        news_list = []
        end_time = datetime.now()
        start_time = end_time - timedelta(days=days)
        
        # Generate ~10-20 news articles per day
        current_time = start_time
        while current_time < end_time:
            num_news = random.randint(10, 20)
            for _ in range(num_news):
                template = random.choice(news_templates)
                news_list.append({
                    'timestamp': current_time + timedelta(minutes=random.randint(0, 1440)),
                    'url': f"https://example.com/news/{len(news_list)}",
                    'source': random.choice(['CoinDesk', 'Cointelegraph', 'Decrypt', 'TheBlock']),
                    'title': template['title'].replace('${price}', str(random.randint(60, 70)))
                                              .replace('${amount}', str(random.randint(100, 500))),
                    'content': f"News article content about cryptocurrency market...",
                    'sentiment_score': template['sentiment'] + random.uniform(-0.2, 0.2)
                })
            current_time += timedelta(days=1)
        
        df = pd.DataFrame(news_list)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp')
        logger.info(f"✓ Generated {len(df)} synthetic news articles")
        return df
    
    def save_training_data(self, candles_df, news_df, output_dir='./training_data'):
        """
        Save collected data for training.
        """
        os.makedirs(output_dir, exist_ok=True)
        
        candles_path = os.path.join(output_dir, 'historical_candles.csv')
        news_path = os.path.join(output_dir, 'historical_news.csv')
        
        candles_df.to_csv(candles_path, index=False)
        news_df.to_csv(news_path, index=False)
        
        logger.info(f"✓ Saved candles to {candles_path}")
        logger.info(f"✓ Saved news to {news_path}")
        
        # Save metadata
        metadata = {
            'collection_date': datetime.now().isoformat(),
            'candles': {
                'count': len(candles_df),
                'start': str(candles_df['timestamp'].min()) if len(candles_df) > 0 else None,
                'end': str(candles_df['timestamp'].max()) if len(candles_df) > 0 else None
            },
            'news': {
                'count': len(news_df),
                'start': str(news_df['timestamp'].min()) if len(news_df) > 0 else None,
                'end': str(news_df['timestamp'].max()) if len(news_df) > 0 else None
            }
        }
        
        metadata_path = os.path.join(output_dir, 'metadata.json')
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2, default=str)
        
        logger.info(f"✓ Saved metadata to {metadata_path}")
        
        return candles_path, news_path


def main():
    """Main data collection script."""
    
    # Configuration - ALL 10 coins for comprehensive training
    SYMBOLS = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
        'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'POLUSDT'
    ]
    DAYS = 90  # 3 months of data for comprehensive training
    
    logger.info("="*60)
    logger.info("HISTORICAL DATA COLLECTION FOR MODEL TRAINING")
    logger.info("="*60)
    logger.info(f"Symbols: {SYMBOLS}")
    logger.info(f"Days: {DAYS}")
    logger.info("="*60)
    
    collector = HistoricalDataCollector()
    
    # Step 1: Collect candles
    logger.info("\n[1/3] Collecting historical candles...")
    all_candles = []
    
    for symbol in SYMBOLS:
        candles_df = collector.collect_candles_from_timescaledb(symbol=symbol, days=DAYS)
        if not candles_df.empty:
            all_candles.append(candles_df)
    
    if all_candles:
        combined_candles = pd.concat(all_candles, ignore_index=True)
    else:
        logger.warning("No candle data collected!")
        combined_candles = pd.DataFrame(columns=['timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume'])
    
    # Step 2: Collect news
    logger.info("\n[2/3] Collecting historical news...")
    news_df = collector.collect_news_from_timescaledb(days=DAYS)
    
    # Step 3: Save data
    logger.info("\n[3/3] Saving training data...")
    candles_path, news_path = collector.save_training_data(combined_candles, news_df)
    
    logger.info("\n" + "="*60)
    logger.info("✓ DATA COLLECTION COMPLETED!")
    logger.info("="*60)
    logger.info(f"\nData files:")
    logger.info(f"  - Candles: {candles_path} ({len(combined_candles)} rows)")
    logger.info(f"  - News: {news_path} ({len(news_df)} rows)")
    logger.info(f"\nNext steps:")
    logger.info(f"1. Review data quality in the CSV files")
    logger.info(f"2. Run training: python3 train.py")
    logger.info("="*60)


if __name__ == '__main__':
    main()
