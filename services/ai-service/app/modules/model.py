
import torch
import torch.nn as nn
import torch.nn.functional as F
import math

class PositionalEncoding(nn.Module):
    """Positional encoding for Transformer."""
    def __init__(self, d_model, max_len=100):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)
        self.register_buffer('pe', pe)

    def forward(self, x):
        return x + self.pe[:, :x.size(1), :]


class MultiHeadAttention(nn.Module):
    """Multi-head attention for news embeddings."""
    def __init__(self, embed_dim, num_heads=8, dropout=0.1):
        super().__init__()
        self.attention = nn.MultiheadAttention(embed_dim, num_heads, dropout=dropout, batch_first=True)
        self.norm = nn.LayerNorm(embed_dim)
        
    def forward(self, x):
        attn_out, attn_weights = self.attention(x, x, x)
        return self.norm(attn_out + x), attn_weights


class AdvancedDualStreamNetwork(nn.Module):
    """
    Advanced Dual-Stream Multi-Horizon Prediction Network with Coin Embedding.
    
    Architecture:
    - Coin Embedding: Learnable embedding for each cryptocurrency
    - Price Stream: Bi-LSTM + Transformer Encoder
    - News Stream: Multi-Head Attention + Temporal Weighting
    - Fusion: Cross-Attention + Dense Layers + Coin Context
    - Multi-Horizon Heads: Separate heads for 1h and 24h predictions
    """
    
    # Coin mapping for embedding lookup
    COIN_TO_IDX = {
        'BTCUSDT': 0, 'ETHUSDT': 1, 'BNBUSDT': 2, 'SOLUSDT': 3, 'XRPUSDT': 4,
        'DOGEUSDT': 5, 'ADAUSDT': 6, 'AVAXUSDT': 7, 'DOTUSDT': 8, 'POLUSDT': 9,
        'UNKNOWN': 10  # Fallback for unknown coins
    }
    
    def __init__(self, 
                 input_dim=11, 
                 news_dim=768, 
                 hidden_dim=128,
                 num_lstm_layers=3,
                 num_transformer_layers=2,
                 num_attention_heads=8,
                 dropout=0.3,
                 num_coins=11,  # 10 coins + 1 unknown
                 coin_embed_dim=16):  # Coin embedding dimension
        super().__init__()
        
        self.hidden_dim = hidden_dim
        self.coin_embed_dim = coin_embed_dim
        
        # ============ COIN EMBEDDING ============
        # Learnable embedding for each coin - captures coin-specific characteristics
        self.coin_embedding = nn.Embedding(num_coins, coin_embed_dim)
        
        # Project coin embedding to hidden_dim for fusion
        self.coin_proj = nn.Linear(coin_embed_dim, hidden_dim)
        
        # ============ PRICE STREAM ============
        # Bi-directional LSTM for temporal patterns
        self.price_lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_lstm_layers,
            batch_first=True,
            dropout=dropout,
            bidirectional=True
        )
        
        # Project bidirectional output back to hidden_dim
        self.price_proj = nn.Linear(hidden_dim * 2, hidden_dim)
        
        # Transformer encoder for long-range dependencies
        self.price_pos_enc = PositionalEncoding(hidden_dim)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=hidden_dim,
            nhead=num_attention_heads,
            dim_feedforward=hidden_dim * 4,
            dropout=dropout,
            batch_first=True
        )
        self.price_transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_transformer_layers)
        
        # ============ NEWS STREAM ============
        # Multi-head self-attention for news
        self.news_attention = MultiHeadAttention(news_dim, num_heads=num_attention_heads, dropout=dropout)
        
        # Temporal importance scoring
        self.news_temporal_score = nn.Sequential(
            nn.Linear(news_dim, hidden_dim),
            nn.Tanh(),
            nn.Linear(hidden_dim, 1)
        )
        
        # Project news to same dimension as price
        self.news_proj = nn.Linear(news_dim, hidden_dim)
        
        # ============ CROSS-MODAL FUSION ============
        # Cross-attention: Price attends to News
        self.cross_attention = nn.MultiheadAttention(
            embed_dim=hidden_dim,
            num_heads=num_attention_heads,
            dropout=dropout,
            batch_first=True
        )
        
        # Fusion layers - Now includes coin context
        fusion_dim = hidden_dim * 3  # Price + News + Coin contexts
        self.fusion_layers = nn.Sequential(
            nn.Linear(fusion_dim, hidden_dim * 2),
            nn.LayerNorm(hidden_dim * 2),
            nn.GELU(),  # GELU activation for smoother gradients
            nn.Dropout(dropout),
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout)
        )
        
        # ============ MULTI-HORIZON PREDICTION HEADS ============
        # Shared feature extractor
        self.shared_features = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout)
        )
        
        # 1-Hour Prediction Head
        self.head_1h = nn.ModuleDict({
            'direction': nn.Linear(hidden_dim, 1),  # Classification
            'return': nn.Linear(hidden_dim, 1),     # Regression
            'confidence': nn.Linear(hidden_dim, 1)  # Confidence score
        })
        
        # 24-Hour Prediction Head
        self.head_24h = nn.ModuleDict({
            'direction': nn.Linear(hidden_dim, 1),
            'return': nn.Linear(hidden_dim, 1),
            'confidence': nn.Linear(hidden_dim, 1)
        })
        
        # Volatility prediction (shared)
        self.volatility_head = nn.Linear(hidden_dim, 3)  # LOW, MEDIUM, HIGH
        
    def forward(self, x_price, x_news, coin_idx=None):
        """
        Forward pass.
        
        Args:
            x_price: [Batch, Seq_Len, Input_Dim] - Price features
            x_news: [Batch, Seq_Len, News_Dim] - News embeddings
            coin_idx: [Batch] - Coin indices for embedding lookup (optional)
            
        Returns:
            predictions_1h: Dict with 'direction', 'return', 'confidence'
            predictions_24h: Dict with 'direction', 'return', 'confidence'
            volatility: [Batch, 3] - Volatility class probabilities
            attention_weights: Dict with 'news_temporal', 'cross_modal'
        """
        batch_size = x_price.size(0)
        device = x_price.device
        
        # ============ PROCESS PRICE STREAM ============
        # Bi-LSTM
        lstm_out, _ = self.price_lstm(x_price)  # [B, Seq, Hidden*2]
        price_features = self.price_proj(lstm_out)  # [B, Seq, Hidden]
        
        # Transformer
        price_features = self.price_pos_enc(price_features)
        price_features = self.price_transformer(price_features)  # [B, Seq, Hidden]
        
        # Global price context (last timestep)
        price_context = price_features[:, -1, :]  # [B, Hidden]
        
        # ============ PROCESS NEWS STREAM ============
        # Self-attention on news
        news_features, _ = self.news_attention(x_news)  # [B, Seq, News_Dim]
        
        # Temporal importance scoring
        news_scores = self.news_temporal_score(news_features)  # [B, Seq, 1]
        news_weights = F.softmax(news_scores, dim=1)
        
        # Weighted news context
        news_context_raw = torch.sum(news_features * news_weights, dim=1)  # [B, News_Dim]
        news_context = self.news_proj(news_context_raw)  # [B, Hidden]
        
        # ============ COIN EMBEDDING ============
        if coin_idx is None:
            # Default to unknown coin if not provided
            coin_idx = torch.full((batch_size,), 10, dtype=torch.long, device=device)
        coin_embed = self.coin_embedding(coin_idx)  # [B, coin_embed_dim]
        coin_context = self.coin_proj(coin_embed)  # [B, Hidden]
        
        # ============ CROSS-MODAL FUSION ============
        # Price attends to News
        news_features_proj = self.news_proj(news_features)  # [B, Seq, Hidden]
        cross_attn_out, cross_attn_weights = self.cross_attention(
            price_features,  # Query
            news_features_proj,  # Key
            news_features_proj   # Value
        )
        cross_context = cross_attn_out[:, -1, :]  # [B, Hidden]
        
        # Fuse all contexts: Price + News + Coin
        fused_input = torch.cat([price_context, cross_context, coin_context], dim=1)  # [B, Hidden*3]
        fused_features = self.fusion_layers(fused_input)  # [B, Hidden]
        
        # Shared features
        shared = self.shared_features(fused_features)  # [B, Hidden]
        
        # ============ MULTI-HORIZON PREDICTIONS ============
        # 1-Hour Predictions
        pred_1h = {
            'direction_logit': self.head_1h['direction'](shared),
            'direction': torch.sigmoid(self.head_1h['direction'](shared)),
            'return': self.head_1h['return'](shared),
            'confidence': torch.sigmoid(self.head_1h['confidence'](shared))
        }
        
        # 24-Hour Predictions
        pred_24h = {
            'direction_logit': self.head_24h['direction'](shared),
            'direction': torch.sigmoid(self.head_24h['direction'](shared)),
            'return': self.head_24h['return'](shared),
            'confidence': torch.sigmoid(self.head_24h['confidence'](shared))
        }
        
        # Volatility
        volatility_logits = self.volatility_head(shared)
        volatility_probs = F.softmax(volatility_logits, dim=1)
        
        # Attention weights for explainability
        attention_weights = {
            'news_temporal': news_weights.squeeze(-1),  # [B, Seq]
            'cross_modal': cross_attn_weights  # [B, Seq, Seq]
        }
        
        return pred_1h, pred_24h, volatility_probs, attention_weights


class MultiHorizonLoss(nn.Module):
    """
    Combined loss for multi-horizon prediction.
    
    Improvements:
    - Uses Huber Loss for return prediction (robust to outliers)
    - Balanced weights to prevent any single loss from dominating
    - Focus on direction accuracy as primary metric
    """
    def __init__(self, 
                 alpha_direction=1.0,    # Primary: direction accuracy
                 alpha_return=0.1,       # Reduced from 2.0 - returns have large variance
                 alpha_confidence=0.3,
                 alpha_volatility=0.5):
        super().__init__()
        self.alpha_direction = alpha_direction
        self.alpha_return = alpha_return
        self.alpha_confidence = alpha_confidence
        self.alpha_volatility = alpha_volatility
        
        self.bce_loss = nn.BCEWithLogitsLoss()
        # Huber Loss = Smooth L1 Loss - less sensitive to outliers than MSE
        self.huber_loss = nn.HuberLoss(delta=0.01)  # delta=0.01 for small returns
        self.mse_loss = nn.MSELoss()
        self.ce_loss = nn.CrossEntropyLoss()
        
    def forward(self, pred_1h, pred_24h, volatility_probs, 
                target_1h, target_24h, target_volatility):
        """
        Calculate combined loss.
        
        Args:
            pred_1h/24h: Dict with 'direction_logit', 'return', 'confidence'
            volatility_probs: [B, 3]
            target_1h/24h: Dict with 'direction', 'return', 'confidence'
            target_volatility: [B] - Class indices
        """
        # Clip target returns to reasonable range [-0.2, 0.2] for stability
        target_1h_return_clipped = torch.clamp(target_1h['return'], -0.2, 0.2)
        target_24h_return_clipped = torch.clamp(target_24h['return'], -0.2, 0.2)
        
        # 1-Hour losses
        loss_1h_dir = self.bce_loss(pred_1h['direction_logit'], target_1h['direction'])
        loss_1h_ret = self.huber_loss(pred_1h['return'], target_1h_return_clipped)
        loss_1h_conf = self.mse_loss(pred_1h['confidence'], target_1h['confidence'])
        
        # 24-Hour losses
        loss_24h_dir = self.bce_loss(pred_24h['direction_logit'], target_24h['direction'])
        loss_24h_ret = self.huber_loss(pred_24h['return'], target_24h_return_clipped)
        loss_24h_conf = self.mse_loss(pred_24h['confidence'], target_24h['confidence'])
        
        # Volatility loss
        loss_vol = self.ce_loss(volatility_probs, target_volatility)
        
        # Combined loss - now balanced and reasonable scale
        total_loss = (
            self.alpha_direction * (loss_1h_dir + loss_24h_dir) +
            self.alpha_return * (loss_1h_ret + loss_24h_ret) +
            self.alpha_confidence * (loss_1h_conf + loss_24h_conf) +
            self.alpha_volatility * loss_vol
        )
        
        return total_loss, {
            '1h_direction': loss_1h_dir.item(),
            '1h_return': loss_1h_ret.item(),
            '24h_direction': loss_24h_dir.item(),
            '24h_return': loss_24h_ret.item(),
            'volatility': loss_vol.item()
        }
