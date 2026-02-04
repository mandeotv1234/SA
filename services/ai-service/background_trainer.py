"""
Background Model Training Service.

This service runs in the background and:
1. Periodically collects data from Kafka
2. Trains the model automatically
3. Updates the inference engine with new weights
"""

import os
import logging
import threading
import time
from datetime import datetime
import torch

from kafka_data_collector import collect_all_data
from train import CryptoDataset, Trainer
from app.modules.model import AdvancedDualStreamNetwork
from app.modules.data_processor import DataProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BackgroundTrainer")


class BackgroundModelTrainer:
    """Background service for automatic model training."""
    
    def __init__(self, 
                 kafka_brokers='kafka:9092',
                 training_interval_hours=24*7,  # Train every week
                 device='cpu'):
        self.kafka_brokers = kafka_brokers
        self.training_interval = training_interval_hours * 3600  # Convert to seconds
        self.device = device
        self.is_training = False
        self.last_training_time = None
        
        logger.info(f"BackgroundModelTrainer initialized")
        logger.info(f"Training interval: {training_interval_hours} hours")
        logger.info(f"Device: {device}")
    
    def should_train(self):
        """Check if it's time to train."""
        if self.is_training:
            return False
        
        if self.last_training_time is None:
            return True
        
        elapsed = time.time() - self.last_training_time
        return elapsed >= self.training_interval
    
    def train_model(self):
        """Execute model training."""
        try:
            self.is_training = True
            logger.info("="*60)
            logger.info("STARTING BACKGROUND MODEL TRAINING")
            logger.info("="*60)
            
            # Step 1: Collect data from Kafka
            logger.info("\n[1/3] Collecting training data from Kafka...")
            candles_df, news_df = collect_all_data(
                kafka_brokers=self.kafka_brokers,
                symbol='BTCUSDT',
                days=180  # 6 months
            )
            
            if len(candles_df) < 1000:
                logger.warning(f"Not enough candle data ({len(candles_df)}). Skipping training.")
                return
            
            if len(news_df) < 100:
                logger.warning(f"Not enough news data ({len(news_df)}). Skipping training.")
                return
            
            # Step 2: Prepare dataset
            logger.info("\n[2/3] Preparing dataset...")
            data_processor = DataProcessor(device=self.device)
            dataset = CryptoDataset(data_processor, candles_df, news_df, lookback=60)
            
            if len(dataset) < 100:
                logger.warning(f"Dataset too small ({len(dataset)}). Skipping training.")
                return
            
            # Split train/val
            train_size = int(0.8 * len(dataset))
            val_size = len(dataset) - train_size
            train_dataset, val_dataset = torch.utils.data.random_split(
                dataset, [train_size, val_size]
            )
            
            from torch.utils.data import DataLoader
            train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True, num_workers=2)
            val_loader = DataLoader(val_dataset, batch_size=32, shuffle=False, num_workers=2)
            
            logger.info(f"Train samples: {len(train_dataset)}, Val samples: {len(val_dataset)}")
            
            # Step 3: Train model
            logger.info("\n[3/3] Training model...")
            model = AdvancedDualStreamNetwork(
                input_dim=11,
                news_dim=768,
                hidden_dim=128,
                num_lstm_layers=3,
                num_transformer_layers=2,
                num_attention_heads=8,
                dropout=0.3
            )
            
            trainer = Trainer(
                model=model,
                train_loader=train_loader,
                val_loader=val_loader,
                device=self.device,
                lr=1e-4
            )
            
            # Train for fewer epochs in background (20 instead of 100)
            trainer.train(num_epochs=20, save_dir='./checkpoints')
            
            logger.info("="*60)
            logger.info("✓ BACKGROUND TRAINING COMPLETED!")
            logger.info("="*60)
            
            self.last_training_time = time.time()
            
        except Exception as e:
            logger.error(f"Error during background training: {e}", exc_info=True)
        finally:
            self.is_training = False
    
    def run_once(self):
        """Run training once (for manual trigger)."""
        if self.is_training:
            logger.warning("Training already in progress!")
            return
        
        thread = threading.Thread(target=self.train_model, daemon=True)
        thread.start()
    
    def start(self):
        """Start background training service."""
        logger.info("Starting background training service...")
        
        def training_loop():
            while True:
                try:
                    if self.should_train():
                        logger.info("Triggering scheduled training...")
                        self.train_model()
                    
                    # Check every hour
                    time.sleep(3600)
                    
                except Exception as e:
                    logger.error(f"Error in training loop: {e}", exc_info=True)
                    time.sleep(3600)
        
        thread = threading.Thread(target=training_loop, daemon=True)
        thread.start()
        logger.info("✓ Background training service started")


# Global instance
_trainer_instance = None


def get_background_trainer():
    """Get or create background trainer instance."""
    global _trainer_instance
    if _trainer_instance is None:
        kafka_brokers = os.getenv('KAFKA_BROKERS', 'kafka:9092')
        device = os.getenv('DEVICE', 'cpu')
        
        _trainer_instance = BackgroundModelTrainer(
            kafka_brokers=kafka_brokers,
            device=device
        )
    return _trainer_instance


def start_background_training():
    """Start background training service."""
    trainer = get_background_trainer()
    trainer.start()


if __name__ == '__main__':
    # For testing
    trainer = get_background_trainer()
    trainer.run_once()  # Train once
    
    # Keep alive
    while True:
        time.sleep(60)
