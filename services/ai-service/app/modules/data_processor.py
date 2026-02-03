
import pandas as pd
import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel
from datetime import timedelta
import logging
import ta

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
        
        # For embeddings (vectorization) - base model
        self.model = AutoModel.from_pretrained(model_name).to(self.device)
        self.model.eval()
        
        # For sentiment classification - classification model
        try:
            from transformers import AutoModelForSequenceClassification
            self.sentiment_model = AutoModelForSequenceClassification.from_pretrained(model_name).to(self.device)
            self.sentiment_model.eval()
            self.has_sentiment_model = True
            logger.info(f"FinBERT Sentiment Classifier loaded successfully")
        except Exception as e:
            logger.warning(f"Failed to load sentiment model: {e}. Using fallback.")
            self.has_sentiment_model = False
        
        logger.info(f"DataProcessor initialized with model: {model_name} on {device}")

    def vectorize_news(self, text_list):
        """
        Convert a list of news texts into embedding vectors.
        """
        if not text_list:
            return np.array([])
            
        inputs = self.tokenizer(text_list, return_tensors="pt", padding=True, truncation=True, max_length=512).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        # Use the [CLS] token embedding (first token) as the sentence embedding
        # Shape: [batch_size, hidden_size] (usually 768 for BERT-base)
        embeddings = outputs.last_hidden_state[:, 0, :].cpu().numpy()
        return embeddings

    def get_sentiment_score(self, text_list):
        """
        Calculate scalar sentiment score (-1 to 1) for a list of texts using FinBERT.
        
        FinBERT outputs: [positive, negative, neutral] logits
        We compute: (positive_prob - negative_prob) to get a -1 to +1 score
        
        Returns:
            List of float: Sentiment scores for each text
        """
        if not text_list:
            return []
        
        try:
            if self.has_sentiment_model:
                # Process in batches to avoid OOM
                batch_size = 16
                all_scores = []
                
                for i in range(0, len(text_list), batch_size):
                    batch = text_list[i:i+batch_size]
                    inputs = self.tokenizer(
                        batch, 
                        return_tensors="pt", 
                        padding=True, 
                        truncation=True, 
                        max_length=256  # Longer context for better sentiment
                    ).to(self.device)
                    
                    with torch.no_grad():
                        outputs = self.sentiment_model(**inputs)
                        # FinBERT output: [positive, negative, neutral]
                        probs = torch.softmax(outputs.logits, dim=-1)
                        
                        # Calculate sentiment score: positive_prob - negative_prob
                        # Range: -1 (fully negative) to +1 (fully positive)
                        positive_probs = probs[:, 0].cpu().numpy()  # Index 0 = positive
                        negative_probs = probs[:, 1].cpu().numpy()  # Index 1 = negative
                        # neutral_probs = probs[:, 2].cpu().numpy()  # Index 2 = neutral
                        
                        scores = (positive_probs - negative_probs).tolist()
                        all_scores.extend(scores)
                
                return all_scores
            else:
                # Fallback: Simple keyword-based heuristic with improved detection
                return self._fallback_sentiment(text_list)
                
        except Exception as e:
            logger.error(f"Sentiment analysis failed: {e}")
            return self._fallback_sentiment(text_list)
    
    def _fallback_sentiment(self, text_list):
        """
        Fallback sentiment analysis using keyword matching.
        More comprehensive than simple positive/negative detection.
        """
        positive_keywords = [
            'bullish', 'surge', 'rally', 'soar', 'gain', 'up', 'rise', 'growth',
            'breakthrough', 'approve', 'approval', 'adoption', 'positive', 'buy',
            'accumulation', 'bullrun', 'ath', 'high', 'profit', 'moon', 'green',
            'tăng', 'tích cực', 'đột phá', 'phê duyệt', 'lạc quan', 'tốt'
        ]
        negative_keywords = [
            'bearish', 'crash', 'dump', 'plunge', 'drop', 'fall', 'decline', 'loss',
            'reject', 'ban', 'fraud', 'hack', 'bankruptcy', 'negative', 'sell',
            'liquidation', 'fear', 'panic', 'red', 'blood', 'warning', 'risk',
            'giảm', 'tiêu cực', 'sụp đổ', 'cấm', 'lo ngại', 'rủi ro', 'xấu'
        ]
        
        scores = []
        for text in text_list:
            t_lower = text.lower()
            pos_count = sum(1 for kw in positive_keywords if kw in t_lower)
            neg_count = sum(1 for kw in negative_keywords if kw in t_lower)
            
            total = pos_count + neg_count
            if total == 0:
                scores.append(0.0)  # Neutral
            else:
                # Score: (pos - neg) / total, capped at [-1, 1]
                score = (pos_count - neg_count) / total
                scores.append(max(-1.0, min(1.0, score)))
        
        return scores

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
        # Support both 'text' and 'content' column names
        text_column = 'text' if 'text' in news_df.columns else 'content'
        all_texts = news_df[text_column].tolist()
        
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
        # Prepare features list (11 dimensions)
        # 1. Open, High, Low, Close, Volume (Basic 5)
        # 2. RSI, MACD, Signal, Diff, BB_High, BB_Low (Tech 6)
        
        # Ensure tech columns exist
        if 'rsi' not in aligned_df.columns:
            aligned_df = self.add_technical_indicators(aligned_df)

        # Normalization Strategy (Simple / Robust)
        # Price features: Log Return or MinMax. Here using Log Return for prices is best for LSTM stationarity
        # But to keep it compatible with 'input_dim=11' raw values need scaling.
        # Let's use a robust on-the-fly scaling:
        # RSI: / 100.0
        # MACD: Raw values are small, usually ok, or / close price. Let's keep raw but ensure float.
        # Bollinger: / close price (ratio) to normalize? Or just raw.
        # To be safe and simple: Use raw but safe values.
        
        # NOTE: In a real training pipeline, we would use a fitted StandardScaler.
        # Here, we assume the model learns from these patterns.
        
        feature_cols = ['open', 'high', 'low', 'close', 'volume', 
                        'rsi', 'macd', 'macd_signal', 'macd_diff', 'bb_high', 'bb_low']
        
        # Normalize specific columns to help convergence
        df_norm = aligned_df.copy()
        df_norm['rsi'] = df_norm['rsi'] / 100.0 # Scale 0-1
        df_norm['volume'] = np.log1p(df_norm['volume']) # Log volume
        
        # Values like Price, MACD are absolute. Better to use relative changes for Price.
        # But structure is fixed. Let's proceed with supplying the features.
        
        data_price = df_norm[feature_cols].fillna(0).values
        data_news = np.stack(aligned_df['news_embedding'].values)
        
        if len(aligned_df) < lookback:
            return None, None
            
        for i in range(len(aligned_df) - lookback + 1):
            X_price.append(data_price[i:i+lookback])
            X_news.append(data_news[i:i+lookback])
            
        return torch.tensor(np.array(X_price), dtype=torch.float32), \
               torch.tensor(np.array(X_news), dtype=torch.float32)

    def add_technical_indicators(self, df):
        """
        Add technical indicators to the DataFrame.
        """
        if df.empty:
            return df
            
        try:
            # RSI
            df['rsi'] = ta.momentum.rsi(df['close'], window=14)
            
            # MACD
            macd = ta.trend.MACD(df['close'])
            df['macd'] = macd.macd()
            df['macd_signal'] = macd.macd_signal()
            df['macd_diff'] = macd.macd_diff()
            
            # Bollinger Bands
            bollinger = ta.volatility.BollingerBands(df['close'])
            df['bb_high'] = bollinger.bollinger_hband()
            df['bb_low'] = bollinger.bollinger_lband()
            
            # SMA 20 (for volume comparison or trend)
            df['sma_20'] = ta.trend.sma_indicator(df['close'], window=20)
            
            # Fill NaNs (important for first few rows)
            df = df.fillna(0)
            
        except Exception as e:
            logger.error(f"Failed to calculate technical indicators: {e}")
            
        return df
