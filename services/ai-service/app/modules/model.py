
import torch
import torch.nn as nn
import torch.nn.functional as F

class DualStreamNetwork(nn.Module):
    def __init__(self, input_dim=5, news_dim=768, hidden_dim=64, num_layers=2, dropout=0.2):
        """
        Dual-Stream Network for Crypto Prediction.
        
        Args:
            input_dim: Number of price features (Open, High, Low, Close, Volume).
            news_dim: Dimension of news embedding (e.g., 768 for BERT).
            hidden_dim: Hidden dimension for LSTM and Fusion layers.
            num_layers: Number of LSTM layers.
        """
        super(DualStreamNetwork, self).__init__()
        
        # --- Stream 1: Time-series (Price) ---
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout
        )
        
        # --- Stream 2: News Attention ---
        # We want to identify *which* news in the sequence matters most.
        # News input: [Batch, Seq_Len, News_Dim]
        self.news_attention = nn.Sequential(
            nn.Linear(news_dim, hidden_dim),
            nn.Tanh(),
            nn.Linear(hidden_dim, 1) # Score for each step
        )
        
        # --- Fusion Layer ---
        # Concatenate LSTM output + Weighted News Vector
        fusion_dim = hidden_dim + news_dim
        self.fusion_fc = nn.Sequential(
            nn.Linear(fusion_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, 1) # Output: Logits (use Sigmoid for prob)
        )
        
    def forward(self, x_price, x_news):
        """
        Forward pass.
        
        Args:
            x_price: [Batch, Seq_Len, 5]
            x_news: [Batch, Seq_Len, 768] (Aligned news embeddings)
            
        Returns:
            probability: Prediction (0 to 1)
            attention_weights: Weights for news vectors [Batch, Seq_Len, 1] for explainability.
        """
        
        # 1. Process Price Stream
        # LSTM Output: [Batch, Seq_Len, Hidden_Dim]
        # We use the final hidden state or the output at the last step.
        lstm_out, _ = self.lstm(x_price)
        
        # Take the output of the last time step for price context
        price_context = lstm_out[:, -1, :] # [Batch, Hidden_Dim]
        
        # 2. Process News Stream with Attention
        # Calculate attention scores based on news content
        # Improvement: Can also attend to news conditioned on Price Context?
        attn_scores = self.news_attention(x_news) # [Batch, Seq_Len, 1]
        attn_weights = F.softmax(attn_scores, dim=1) # Normalize weights
        
        # Weighted sum of news embeddings
        # [Batch, Seq_Len, 768] * [Batch, Seq_Len, 1] -> Sum over Seq_Len
        news_context = torch.sum(x_news * attn_weights, dim=1) # [Batch, 768]
        
        # 3. Fusion
        combined = torch.cat((price_context, news_context), dim=1) # [Batch, Hidden + News_Dim]
        logits = self.fusion_fc(combined)
        probability = torch.sigmoid(logits)
        
        return probability, attn_weights
