
import pandas as pd
import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel
from datetime import timedelta
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DataProcessor")

class DataProcessor:
    def __init__(self, model_name="ProsusAI/finbert", device="cpu"):
        """
        Initialize the DataProcessor with a specific Transformer model (FinBERT).
        """
        self.device = device
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModel.from_pretrained(model_name).to(self.device)
        self.model.eval() # Set to evaluation mode
        logger.info(f"DataProcessor initialized with model: {model_name} on {device}")

    def vectorize_news(self, text_list):
        """
        Convert a list of news texts into embedding vectors.
        """
        if not text_list:
            return np.array([])
            
        inputs = self.tokenizer(text_list, return_tensors="pt", padding=True, truncation=True, max_length=128).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        # Use the [CLS] token embedding (first token) as the sentence embedding
        # Shape: [batch_size, hidden_size] (usually 768 for BERT-base)
        embeddings = outputs.last_hidden_state[:, 0, :].cpu().numpy()
        return embeddings

    def align_news_to_candles(self, candles_df, news_df, timeframe="15min"):
        """
        Align sporadic news events to candle timestamps using Decay Aggregation.
        
        Args:
            candles_df: DataFrame with 'timestamp' (datetime) and OHLCV columns.
            news_df: DataFrame with 'timestamp' (datetime) and 'text' columns.
            timeframe: Pandas offset alias (e.g., '15min' for 15 minutes).
            
        Returns:
            aligned_df: DataFrame with OHLCV and 'news_embedding' column.
        """
        if news_df.empty:
            candles_df['news_embedding'] = [np.zeros(768) for _ in range(len(candles_df))]
            return candles_df

        # Ensure timestamps are datetime
        candles_df['timestamp'] = pd.to_datetime(candles_df['timestamp'])
        news_df['timestamp'] = pd.to_datetime(news_df['timestamp'])
        
        # Sort values
        candles_df = candles_df.sort_values('timestamp').reset_index(drop=True)
        news_df = news_df.sort_values('timestamp').reset_index(drop=True)
        
        print(f"  [DP-DEBUG] Aligning {len(news_df)} news to {len(candles_df)} candles... (Optimization Check)")
        
        # --- OPTIMIZATION START ---
        # Vectorize ALL news at once (or in batches inside vectorize_news)
        logger.info(f"Vectorizing {len(news_df)} news articles...")
        all_texts = news_df['text'].tolist()
        
        # Process in batches of 32 to avoid OOM
        all_vectors = []
        batch_size = 32
        for i in range(0, len(all_texts), batch_size):
            batch = all_texts[i : i+batch_size]
            batch_vecs = self.vectorize_news(batch)
            if len(batch_vecs) > 0:
                all_vectors.append(batch_vecs)
        
        if all_vectors:
            news_vectors = np.vstack(all_vectors)
        else:
            news_vectors = np.zeros((len(news_df), 768))

        # Attach vectors to news_df for easy lookup
        # We can't put numpy array in a pandas cell efficiently usually, 
        # but we can use index mapping.
        # Let's simple use a list of arrays column
        news_df['vector'] = list(news_vectors)
        logger.info("Vectorization complete.")
        # --- OPTIMIZATION END ---
        
        aligned_embeddings = []
        
        # Iterate through candles
        for i, row in candles_df.iterrows():
            candle_start = row['timestamp']
            candle_end = candle_start + pd.to_timedelta(timeframe)
            
            # Find news in this candle's window
            mask = (news_df['timestamp'] >= candle_start) & (news_df['timestamp'] < candle_end)
            current_news = news_df[mask]
            
            if current_news.empty:
                aligned_embeddings.append(np.zeros(768))
            else:
                # Retrieve pre-calculated vectors
                vectors = np.stack(current_news['vector'].values)
                aggregated_vector = np.mean(vectors, axis=0) # Simple Average
                aligned_embeddings.append(aggregated_vector)
                
        candles_df['news_embedding'] = aligned_embeddings
        return candles_df

    def prepare_lstm_input(self, aligned_df, lookback=60):
        """
        Create sequences for LSTM input.
        
        Args:
            aligned_df: DataFrame with OHLCV and 'news_embedding'.
            lookback: Number of past candles to include in one sample.
            
        Returns:
            X_price: Tensor [batch, lookback, 5]
            X_news: Tensor [batch, lookback, 768]
        """
        X_price = []
        X_news = []
        
        # Normalize OHLCV (simple min-max or log return is better in prod)
        # Here we just convert to float. Feature engineering needed in real prod.
        price_cols = ['open', 'high', 'low', 'close', 'volume']
        data_price = aligned_df[price_cols].values
        data_news = np.stack(aligned_df['news_embedding'].values)
        
        if len(aligned_df) < lookback:
            return None, None
            
        for i in range(len(aligned_df) - lookback + 1):
            X_price.append(data_price[i:i+lookback])
            X_news.append(data_news[i:i+lookback])
            
        return torch.tensor(np.array(X_price), dtype=torch.float32), \
               torch.tensor(np.array(X_news), dtype=torch.float32)
