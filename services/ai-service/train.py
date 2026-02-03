"""
Training Pipeline for Advanced Multi-Horizon Crypto Prediction Model.

This script trains the AdvancedDualStreamNetwork on historical data.
"""

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging
from tqdm import tqdm
import os
import sys

# Add app directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(current_dir, 'app'))

from app.modules.model import AdvancedDualStreamNetwork, MultiHorizonLoss
from app.modules.data_processor import DataProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Trainer")


class CryptoDataset(Dataset):
    """
    Dataset for multi-horizon crypto prediction with coin embedding support.
    """
    
    # Coin to index mapping (must match model.py)
    COIN_TO_IDX = {
        'BTCUSDT': 0, 'ETHUSDT': 1, 'BNBUSDT': 2, 'SOLUSDT': 3, 'XRPUSDT': 4,
        'DOGEUSDT': 5, 'ADAUSDT': 6, 'AVAXUSDT': 7, 'DOTUSDT': 8, 'POLUSDT': 9,
    }
    
    def __init__(self, data_processor, candles_df, news_df, lookback=60):
        """
        Args:
            data_processor: DataProcessor instance
            candles_df: DataFrame with OHLCV data (must have 'symbol' column)
            news_df: DataFrame with news data
            lookback: Sequence length
        """
        self.data_processor = data_processor
        self.lookback = lookback
        
        # Extract coin indices before processing
        if 'symbol' in candles_df.columns:
            self.coin_symbols = candles_df['symbol'].values.copy()
        else:
            self.coin_symbols = np.array(['UNKNOWN'] * len(candles_df))
        
        # Add technical indicators
        candles_df = data_processor.add_technical_indicators(candles_df)
        
        # Align news to candles
        aligned_df = data_processor.align_news_to_candles(candles_df, news_df)
        
        # Prepare sequences
        self.X_price, self.X_news = data_processor.prepare_lstm_input(aligned_df, lookback=lookback)
        
        # Prepare targets
        self.targets_1h = self._prepare_targets(aligned_df, horizon='1h')
        self.targets_24h = self._prepare_targets(aligned_df, horizon='24h')
        self.volatility_targets = self._prepare_volatility_targets(aligned_df)
        
        # Prepare coin indices for each sample
        # After lookback window, crop coin_symbols to match X_price length
        self.coin_indices = self._prepare_coin_indices(len(self.X_price))
        
        # Trim to valid samples
        valid_len = min(
            len(self.X_price), 
            len(self.targets_1h['return']),
            len(self.targets_24h['return']),
            len(self.coin_indices)
        )
        
        self.X_price = self.X_price[:valid_len]
        self.X_news = self.X_news[:valid_len]
        self.coin_indices = self.coin_indices[:valid_len]
        for key in self.targets_1h:
            self.targets_1h[key] = self.targets_1h[key][:valid_len]
        for key in self.targets_24h:
            self.targets_24h[key] = self.targets_24h[key][:valid_len]
        self.volatility_targets = self.volatility_targets[:valid_len]
        
        logger.info(f"Dataset created with {valid_len} samples")
        logger.info(f"Coins in dataset: {np.unique(self.coin_symbols[:valid_len])}")
        
    def _prepare_targets(self, df, horizon='1h'):
        """Calculate target labels for given horizon."""
        if horizon == '1h':
            shift = 4  # 4 candles ahead for 15min timeframe = 1 hour
        else:  # 24h
            shift = 96  # 96 candles = 24 hours
        
        # Future price
        df['future_close'] = df['close'].shift(-shift)
        
        # Return percentage
        df['return'] = (df['future_close'] - df['close']) / df['close']
        
        # Direction (1 if up, 0 if down)
        df['direction'] = (df['return'] > 0).astype(float)
        
        # Confidence (based on magnitude of move)
        df['confidence'] = df['return'].abs().clip(0, 0.1) / 0.1  # Normalize to 0-1
        
        # Drop NaN rows
        df = df.dropna(subset=['return', 'direction'])
        
        return {
            'direction': torch.tensor(df['direction'].values, dtype=torch.float32).unsqueeze(1),
            'return': torch.tensor(df['return'].values, dtype=torch.float32).unsqueeze(1),
            'confidence': torch.tensor(df['confidence'].values, dtype=torch.float32).unsqueeze(1)
        }
    
    def _prepare_volatility_targets(self, df):
        """Calculate volatility class targets."""
        # Rolling std of returns
        df['volatility'] = df['close'].pct_change().rolling(20).std()
        
        # Classify into LOW (0), MEDIUM (1), HIGH (2)
        vol_low = df['volatility'].quantile(0.33)
        vol_high = df['volatility'].quantile(0.67)
        
        def classify_vol(v):
            if pd.isna(v):
                return 1  # Default to MEDIUM
            if v < vol_low:
                return 0  # LOW
            elif v > vol_high:
                return 2  # HIGH
            else:
                return 1  # MEDIUM
        
        df['vol_class'] = df['volatility'].apply(classify_vol)
        
        return torch.tensor(df['vol_class'].values, dtype=torch.long)
    
    def _prepare_coin_indices(self, target_len):
        """Convert coin symbols to indices for embedding lookup."""
        # Adjust for lookback - coin symbols start from lookback position
        start_idx = self.lookback
        end_idx = min(start_idx + target_len, len(self.coin_symbols))
        
        symbols = self.coin_symbols[start_idx:end_idx]
        
        # Convert symbols to indices
        indices = []
        for sym in symbols:
            idx = self.COIN_TO_IDX.get(sym, 10)  # 10 = UNKNOWN
            indices.append(idx)
        
        return torch.tensor(indices, dtype=torch.long)
    
    def __len__(self):
        return len(self.X_price)
    
    def __getitem__(self, idx):
        return {
            'price': self.X_price[idx],
            'news': self.X_news[idx],
            'coin_idx': self.coin_indices[idx],  # Added coin index
            'target_1h': {k: v[idx] for k, v in self.targets_1h.items()},
            'target_24h': {k: v[idx] for k, v in self.targets_24h.items()},
            'volatility': self.volatility_targets[idx]
        }


class Trainer:
    """
    Trainer for AdvancedDualStreamNetwork.
    """
    def __init__(self, 
                 model, 
                 train_loader, 
                 val_loader,
                 device='cuda',
                 lr=1e-4,
                 weight_decay=1e-5):
        self.model = model.to(device)
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.device = device
        
        self.criterion = MultiHorizonLoss()
        self.optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
        self.scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, mode='min', factor=0.5, patience=5, verbose=True
        )
        
        self.best_val_loss = float('inf')
        
    def train_epoch(self):
        """Train for one epoch."""
        self.model.train()
        total_loss = 0
        loss_components = {}
        
        pbar = tqdm(self.train_loader, desc="Training")
        for batch in pbar:
            # Move to device
            x_price = batch['price'].to(self.device)
            x_news = batch['news'].to(self.device)
            coin_idx = batch['coin_idx'].to(self.device)  # Coin embedding index
            target_1h = {k: v.to(self.device) for k, v in batch['target_1h'].items()}
            target_24h = {k: v.to(self.device) for k, v in batch['target_24h'].items()}
            volatility = batch['volatility'].to(self.device)
            
            # Forward pass with coin embedding
            pred_1h, pred_24h, vol_probs, _ = self.model(x_price, x_news, coin_idx)
            
            # Calculate loss
            loss, components = self.criterion(
                pred_1h, pred_24h, vol_probs,
                target_1h, target_24h, volatility
            )
            
            # Backward pass
            self.optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()
            
            # Track metrics
            total_loss += loss.item()
            for k, v in components.items():
                loss_components[k] = loss_components.get(k, 0) + v
            
            pbar.set_postfix({'loss': f"{loss.item():.4f}"})
        
        avg_loss = total_loss / len(self.train_loader)
        avg_components = {k: v / len(self.train_loader) for k, v in loss_components.items()}
        
        return avg_loss, avg_components
    
    def validate(self):
        """Validate the model."""
        self.model.eval()
        total_loss = 0
        loss_components = {}
        
        with torch.no_grad():
            for batch in tqdm(self.val_loader, desc="Validation"):
                x_price = batch['price'].to(self.device)
                x_news = batch['news'].to(self.device)
                coin_idx = batch['coin_idx'].to(self.device)
                target_1h = {k: v.to(self.device) for k, v in batch['target_1h'].items()}
                target_24h = {k: v.to(self.device) for k, v in batch['target_24h'].items()}
                volatility = batch['volatility'].to(self.device)
                
                pred_1h, pred_24h, vol_probs, _ = self.model(x_price, x_news, coin_idx)
                
                loss, components = self.criterion(
                    pred_1h, pred_24h, vol_probs,
                    target_1h, target_24h, volatility
                )
                
                total_loss += loss.item()
                for k, v in components.items():
                    loss_components[k] = loss_components.get(k, 0) + v
        
        avg_loss = total_loss / len(self.val_loader)
        avg_components = {k: v / len(self.val_loader) for k, v in loss_components.items()}
        
        return avg_loss, avg_components
    
    def train(self, num_epochs, save_dir='./checkpoints'):
        """Train the model."""
        os.makedirs(save_dir, exist_ok=True)
        
        for epoch in range(num_epochs):
            logger.info(f"\n{'='*50}")
            logger.info(f"Epoch {epoch + 1}/{num_epochs}")
            logger.info(f"{'='*50}")
            
            # Train
            train_loss, train_components = self.train_epoch()
            logger.info(f"Train Loss: {train_loss:.4f}")
            logger.info(f"Components: {train_components}")
            
            # Validate
            val_loss, val_components = self.validate()
            logger.info(f"Val Loss: {val_loss:.4f}")
            logger.info(f"Components: {val_components}")
            
            # Learning rate scheduling
            self.scheduler.step(val_loss)
            
            # Save best model
            if val_loss < self.best_val_loss:
                self.best_val_loss = val_loss
                checkpoint_path = os.path.join(save_dir, 'best_model.pth')
                torch.save({
                    'epoch': epoch,
                    'model_state_dict': self.model.state_dict(),
                    'optimizer_state_dict': self.optimizer.state_dict(),
                    'val_loss': val_loss,
                }, checkpoint_path)
                logger.info(f"✓ Saved best model to {checkpoint_path}")
            
            # Save checkpoint every 10 epochs
            if (epoch + 1) % 10 == 0:
                checkpoint_path = os.path.join(save_dir, f'checkpoint_epoch_{epoch+1}.pth')
                torch.save({
                    'epoch': epoch,
                    'model_state_dict': self.model.state_dict(),
                    'optimizer_state_dict': self.optimizer.state_dict(),
                    'val_loss': val_loss,
                }, checkpoint_path)
                logger.info(f"✓ Saved checkpoint to {checkpoint_path}")


def main():
    """Main training script."""
    # Configuration - Optimized hyperparameters
    DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
    BATCH_SIZE = 64       # Larger batch for more stable gradients
    NUM_EPOCHS = 15       # More epochs for convergence
    LEARNING_RATE = 3e-5  # Lower LR for stable training
    WEIGHT_DECAY = 1e-4   # Regularization
    LOOKBACK = 60
    DATA_DIR = './training_data'
    
    logger.info(f"Using device: {DEVICE}")
    logger.info(f"Hyperparameters: batch_size={BATCH_SIZE}, epochs={NUM_EPOCHS}, lr={LEARNING_RATE}")
    
    # Initialize data processor
    data_processor = DataProcessor(device=DEVICE)
    
    # Load historical data from collected files
    candles_path = os.path.join(DATA_DIR, 'historical_candles.csv')
    news_path = os.path.join(DATA_DIR, 'historical_news.csv')
    
    if not os.path.exists(candles_path) or not os.path.exists(news_path):
        logger.error("="*60)
        logger.error("❌ TRAINING DATA NOT FOUND!")
        logger.error("="*60)
        logger.error(f"Expected files:")
        logger.error(f"  - {candles_path}")
        logger.error(f"  - {news_path}")
        logger.error(f"\nPlease run data collection first:")
        logger.error(f"  python collect_training_data.py")
        logger.error("="*60)
        return
    
    logger.info(f"Loading data from:")
    logger.info(f"  - Candles: {candles_path}")
    logger.info(f"  - News: {news_path}")
    
    # Load data
    candles_df = pd.read_csv(candles_path)
    news_df = pd.read_csv(news_path)
    
    # Convert timestamp columns
    candles_df['timestamp'] = pd.to_datetime(candles_df['timestamp'])
    news_df['timestamp'] = pd.to_datetime(news_df['timestamp'])
    
    logger.info(f"✓ Loaded {len(candles_df)} candles")
    logger.info(f"✓ Loaded {len(news_df)} news articles")
    
    # Create datasets
    logger.info("Creating datasets...")
    dataset = CryptoDataset(data_processor, candles_df, news_df, lookback=LOOKBACK)
    
    # Split train/val (80/20)
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(dataset, [train_size, val_size])
    
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=4)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=4)
    
    logger.info(f"Train samples: {len(train_dataset)}, Val samples: {len(val_dataset)}")
    
    # Initialize model
    logger.info("Initializing model...")
    model = AdvancedDualStreamNetwork(
        input_dim=11,
        news_dim=768,
        hidden_dim=128,
        num_lstm_layers=3,
        num_transformer_layers=2,
        num_attention_heads=8,
        dropout=0.3
    )
    
    total_params = sum(p.numel() for p in model.parameters())
    logger.info(f"Total parameters: {total_params:,}")
    
    # Initialize trainer
    trainer = Trainer(
        model=model,
        train_loader=train_loader,
        val_loader=val_loader,
        device=DEVICE,
        lr=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY
    )
    
    # Train
    logger.info("Starting training...")
    trainer.train(num_epochs=NUM_EPOCHS)
    
    logger.info("✓ Training completed!")



if __name__ == '__main__':
    main()
