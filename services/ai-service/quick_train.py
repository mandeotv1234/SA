"""
Quick Training Script - Optimized for Low Memory
Trains the model with smaller batches to avoid OOM.
"""

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging
import os
import sys
import gc

# Add app directory to path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(current_dir, 'app'))

from app.modules.model import AdvancedDualStreamNetwork, MultiHorizonLoss

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("QuickTrainer")


class SimpleCryptoDataset(Dataset):
    """Lightweight dataset without FinBERT vectorization for quick training."""
    
    def __init__(self, candles_df, lookback=30):
        self.lookback = lookback
        
        # Use only price data (no news embedding for quick training)
        # Normalize OHLCV
        candles_df = candles_df.copy()
        
        # Add simple technical indicators
        candles_df['returns'] = candles_df['close'].pct_change().fillna(0)
        candles_df['sma_20'] = candles_df['close'].rolling(20, min_periods=1).mean()
        candles_df['sma_50'] = candles_df['close'].rolling(50, min_periods=1).mean()
        candles_df['rsi'] = self._calculate_rsi(candles_df['close'])
        candles_df['volatility'] = candles_df['returns'].rolling(20, min_periods=1).std().fillna(0)
        
        # Volume normalized
        candles_df['vol_norm'] = candles_df['volume'] / candles_df['volume'].rolling(20, min_periods=1).mean()
        candles_df['vol_norm'] = candles_df['vol_norm'].fillna(1)
        
        # Price relative to SMA
        candles_df['price_sma_ratio'] = candles_df['close'] / candles_df['sma_20']
        candles_df['price_sma_ratio'] = candles_df['price_sma_ratio'].fillna(1)
        
        # Bollinger band position
        bb_std = candles_df['close'].rolling(20, min_periods=1).std()
        candles_df['bb_pos'] = (candles_df['close'] - candles_df['sma_20']) / (2 * bb_std + 1e-8)
        candles_df['bb_pos'] = candles_df['bb_pos'].fillna(0).clip(-2, 2)
        
        # Target: 1h future return (4 candles for 15min)
        shift = 4
        candles_df['future_return'] = candles_df['close'].shift(-shift) / candles_df['close'] - 1
        candles_df['direction'] = (candles_df['future_return'] > 0).astype(float)
        
        # Drop NaN
        candles_df = candles_df.dropna().reset_index(drop=True)
        
        # Feature columns
        feature_cols = ['returns', 'rsi', 'volatility', 'vol_norm', 'price_sma_ratio', 'bb_pos']
        
        # Create sequences
        self.X_price = []
        self.X_news = []  # Dummy zeros
        self.targets = []
        
        for i in range(lookback, len(candles_df) - shift):
            price_seq = candles_df[feature_cols].iloc[i-lookback:i].values
            self.X_price.append(price_seq)
            
            # Dummy news embedding (zeros) - model will learn from price only
            self.X_news.append(np.zeros((lookback, 768)))
            
            self.targets.append({
                'direction': candles_df['direction'].iloc[i],
                'return': candles_df['future_return'].iloc[i]
            })
        
        self.X_price = torch.tensor(np.array(self.X_price), dtype=torch.float32)
        self.X_news = torch.tensor(np.array(self.X_news), dtype=torch.float32)
        
        logger.info(f"Dataset created with {len(self.X_price)} samples")
    
    def _calculate_rsi(self, prices, period=14):
        delta = prices.diff()
        gain = delta.where(delta > 0, 0).rolling(period, min_periods=1).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(period, min_periods=1).mean()
        rs = gain / (loss + 1e-8)
        rsi = 100 - (100 / (1 + rs))
        return rsi.fillna(50) / 100  # Normalize to 0-1
    
    def __len__(self):
        return len(self.X_price)
    
    def __getitem__(self, idx):
        return {
            'price': self.X_price[idx],
            'news': self.X_news[idx],
            'direction': torch.tensor([self.targets[idx]['direction']], dtype=torch.float32),
            'return': torch.tensor([self.targets[idx]['return']], dtype=torch.float32)
        }


def train_model():
    """Quick training on price data."""
    DEVICE = 'cpu'
    BATCH_SIZE = 16  # Small batch size for low memory
    NUM_EPOCHS = 20
    LEARNING_RATE = 1e-4
    LOOKBACK = 30
    
    logger.info("=" * 60)
    logger.info("QUICK TRAINING - Price-Only Model")
    logger.info("=" * 60)
    
    # Load candles
    candles_path = './training_data/historical_candles.csv'
    if not os.path.exists(candles_path):
        logger.error(f"Candles not found: {candles_path}")
        logger.error("Run: python collect_training_data.py first")
        return
    
    candles_df = pd.read_csv(candles_path)
    candles_df['timestamp'] = pd.to_datetime(candles_df['timestamp'])
    logger.info(f"Loaded {len(candles_df)} candles")
    
    # Create dataset
    dataset = SimpleCryptoDataset(candles_df, lookback=LOOKBACK)
    
    # Split
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(dataset, [train_size, val_size])
    
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
    
    logger.info(f"Train: {len(train_dataset)}, Val: {len(val_dataset)}")
    
    # Model (reduced size for quick training)
    model = AdvancedDualStreamNetwork(
        input_dim=6,  # 6 features
        news_dim=768,
        hidden_dim=64,  # Reduced
        num_lstm_layers=2,  # Reduced
        num_transformer_layers=1,  # Reduced
        num_attention_heads=4,  # Reduced
        dropout=0.3
    ).to(DEVICE)
    
    total_params = sum(p.numel() for p in model.parameters())
    logger.info(f"Model params: {total_params:,}")
    
    # Training
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)
    criterion = nn.BCEWithLogitsLoss()
    
    best_val_loss = float('inf')
    os.makedirs('./checkpoints', exist_ok=True)
    
    for epoch in range(NUM_EPOCHS):
        # Train
        model.train()
        train_loss = 0
        train_correct = 0
        train_total = 0
        
        for batch in train_loader:
            x_price = batch['price'].to(DEVICE)
            x_news = batch['news'].to(DEVICE)
            targets = batch['direction'].to(DEVICE)
            
            optimizer.zero_grad()
            pred_1h, pred_24h, vol_probs, attn = model(x_price, x_news)
            
            loss = criterion(pred_1h['direction_logit'], targets)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            
            train_loss += loss.item()
            
            # Accuracy
            preds = (torch.sigmoid(pred_1h['direction_logit']) > 0.5).float()
            train_correct += (preds == targets).sum().item()
            train_total += targets.size(0)
        
        train_loss /= len(train_loader)
        train_acc = train_correct / train_total * 100
        
        # Validate
        model.eval()
        val_loss = 0
        val_correct = 0
        val_total = 0
        
        with torch.no_grad():
            for batch in val_loader:
                x_price = batch['price'].to(DEVICE)
                x_news = batch['news'].to(DEVICE)
                targets = batch['direction'].to(DEVICE)
                
                pred_1h, pred_24h, vol_probs, attn = model(x_price, x_news)
                loss = criterion(pred_1h['direction_logit'], targets)
                val_loss += loss.item()
                
                preds = (torch.sigmoid(pred_1h['direction_logit']) > 0.5).float()
                val_correct += (preds == targets).sum().item()
                val_total += targets.size(0)
        
        val_loss /= len(val_loader)
        val_acc = val_correct / val_total * 100
        
        logger.info(f"Epoch {epoch+1}/{NUM_EPOCHS} | Train Loss: {train_loss:.4f} Acc: {train_acc:.1f}% | Val Loss: {val_loss:.4f} Acc: {val_acc:.1f}%")
        
        # Save best
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), './checkpoints/best_model.pth')
            logger.info(f"  ✓ Saved best model (val_loss: {val_loss:.4f})")
        
        gc.collect()
    
    # Deploy model
    os.makedirs('./app/model_weights', exist_ok=True)
    if os.path.exists('./checkpoints/best_model.pth'):
        import shutil
        shutil.copy('./checkpoints/best_model.pth', './app/model_weights/trained_model.pth')
        logger.info("=" * 60)
        logger.info("✓ TRAINING COMPLETED!")
        logger.info("✓ Model deployed to: ./app/model_weights/trained_model.pth")
        logger.info("=" * 60)


if __name__ == '__main__':
    train_model()
