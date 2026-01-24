
import logging
import torch
import numpy as np
import pandas as pd
from datetime import datetime
from app.modules.data_processor import DataProcessor
from app.modules.model import DualStreamNetwork
from app.modules.ollama_client import OllamaClient
from app.market_cache import get_candles

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("InferenceEngine")

class InferenceEngine:
    def __init__(self, model_path=None, device="cpu"):
        self.device = device
        self.data_processor = DataProcessor(device=device)
        self.model = DualStreamNetwork().to(device)
        self.ollama_client = OllamaClient()
        
        if model_path:
            self.load_model(model_path)
        else:
            logger.warning("No model path provided. Running with initialized weights (random prediction).")

    def load_model(self, path):
        try:
            self.model.load_state_dict(torch.load(path, map_location=self.device))
            self.model.eval()
            logger.info(f"Model loaded from {path}")
        except FileNotFoundError:
            logger.warning(f"Model file not found at {path}. Using random weights.")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")

    def predict_for_symbol(self, symbol, news_list):
        """
        Run deep learning prediction for a single symbol.
        """
        # DEBUG TRACE
        print(f"  [DL-TRACE] Starting prediction for {symbol} with {len(news_list)} news items")
        
        # 1. Get Market Data (Candles)
        # We need historical candles for LSTM lookback (e.g., 60 candles)
        candles = get_candles(symbol.upper(), 100) # Get 100 to be safe
        # 1. Get Market Data (Candles)
        candles = get_candles(symbol.upper(), 100)
        if not candles or len(candles) < 60:
            logger.warning(f"Not enough candles for {symbol}. Need 60, got {len(candles)}")
            return None

        # Convert list of dicts to DataFrame
        candles_df = pd.DataFrame(candles)
        candles_df['timestamp'] = pd.to_datetime(candles_df['time'], unit='s')
        
        # Calculate Log Returns for normalization
        # ret = ln(close_t / close_t-1)
        # We perform this ON THE DATAFRAME before data processor splitting
        # However, DataProcessor expects raw columns. 
        # Let's assume DataProcessor will handle scaling or we do it here.
        # Since DataProcessor is generic, let's add a 'log_return' column and use it as a feature?
        # For strict adherence to current Model Input (5 features), we should replace OHLCV with normalized versions.
        # Simple approach for now: Use Z-score normalization on the fly based on the window.
        
        # 2. Prepare News Data
        news_data = []
        for n in news_list:
            news_data.append({
                'timestamp': pd.to_datetime(n['timestamp'], unit='s'),
                'text': f"{n.get('title', '')}. {n.get('content', '')[:100]}",
                'sentiment_score': n.get('sentiment_score', 0) # Keep sentiment for heuristic
            })
        news_df = pd.DataFrame(news_data)

        # 3. Align Data
        import os
        timeframe = os.getenv("TIMEFRAME", "15min")
        aligned_df = self.data_processor.align_news_to_candles(candles_df, news_df, timeframe=timeframe)

        # 4. Prepare Tensor Input
        # Note: DataProcessor.prepare_lstm_input currently takes raw OHLCV. 
        # We need to normalize it THERE or HERE. 
        # Let's normalize HERE to modify the dataframe before passing it.
        # Log Return for Close Price
        eps = 1e-8
        aligned_df['close'] = np.log(aligned_df['close'] / aligned_df['close'].shift(1) + 1.0)
        aligned_df['open'] = np.log(aligned_df['open'] / aligned_df['open'].shift(1) + 1.0)
        aligned_df['high'] = np.log(aligned_df['high'] / aligned_df['high'].shift(1) + 1.0)
        aligned_df['low'] = np.log(aligned_df['low'] / aligned_df['low'].shift(1) + 1.0)
        # Volume normalization (Log)
        aligned_df['volume'] = np.log(aligned_df['volume'] + 1.0)
        
        # Fill NaN from shift
        aligned_df.fillna(0, inplace=True)

        X_price, X_news = self.data_processor.prepare_lstm_input(aligned_df, lookback=60)
        
        if X_price is None:
             return None

        # Take the last sample
        X_price_last = X_price[-1].unsqueeze(0).to(self.device)
        X_news_last = X_news[-1].unsqueeze(0).to(self.device)

        # 5. Model Inference
        with torch.no_grad():
            prob, attn_weights = self.model(X_price_last, X_news_last)
            
        prob_value = prob.item()
        
        # HEURISTIC OVERRIDE (Temporary until training)
        # If model is untrained (weights ~ random), it outputs ~0.5.
        # We use explicit sentiment from Top News to steer the prediction.
        
        # 6. Explainability
        attn_weights = attn_weights.squeeze().cpu().numpy()
        top_idx = np.argmax(attn_weights)
        top_prob = attn_weights[top_idx]
        
        abs_idx = (len(aligned_df) - 60) + top_idx
        top_candle_time = aligned_df.iloc[abs_idx]['timestamp']
        
        # Debug Log
        print(f"  [DL-DEBUG] {symbol} Raw Prob: {prob_value:.4f} | Top Attention: Index {top_idx} (Score: {top_prob:.4f}) at {top_candle_time}")
        
        top_news = None
        heuristic_boost = 0.0
        
        if not news_df.empty:
            mask = (news_df['timestamp'] >= top_candle_time) & (news_df['timestamp'] < top_candle_time + pd.Timedelta(minutes=15))
            relevant_news = news_df[mask]
            
            if not relevant_news.empty:
                # Get the article with highest relevance/sentiment magnitude
                # Here simply the first one matched or using 'vector' alignment logic equivalent
                top_article = relevant_news.iloc[0]
                top_news = top_article['text']
                
                # Apply Heuristic
                # If sentiment score is present and strong
                sent_score = top_article.get('sentiment_score', 0)
                if abs(sent_score) > 0.2:
                    heuristic_boost = sent_score * 0.3 # Max 0.3 boost
                    print(f"  [DL-HEURISTIC] Boosting prob by {heuristic_boost:.2f} due to sentiment {sent_score:.2f}")

        # Apply boost
        final_prob = np.clip(prob_value + heuristic_boost, 0.0, 1.0)
        
        direction = "UP" if final_prob > 0.5 else "DOWN"
        confidence = abs(final_prob - 0.5) * 2 
        
        # 7. Generate Explanation via Ollama
        reason = self.generate_explanation(symbol, direction, final_prob, top_news)
        
        return {
            "symbol": symbol,
            "direction": direction,
            "change_percent": (prob_value - 0.5) * 5, # Mock predicted change
            "confidence": float(confidence),
            "reason": reason,
            "causal_factor": "News Analysis" if top_news else "Technical Pattern",
            "top_news": top_news
        }

    def generate_explanation(self, symbol, direction, prob, top_news):
        if not top_news:
            return f"Technical analysis indicates {direction} trend with {(prob*100):.1f}% probability."
            
        prompt = f"""
        Bạn là chuyên gia phân tích thị trường Crypto Quant.
        Dựa trên tin tức quan trọng sau đây: "{top_news}"
        
        Hệ thống AI đã dự báo: {symbol} có xu hướng {direction} (Độ tin cậy: {(prob*100):.1f}%).
        
        Hãy giải thích ngắn gọn (2-3 câu) nguyên nhân CỤ THỂ tại sao tin tức trên lại ảnh hưởng đến giá {symbol} theo chiều hướng đó? 
        Hãy đề cập đến các yếu tố vĩ mô hoặc tâm lý thị trường nếu có.
        Trả lời bằng Tiếng Việt chuyên ngành.
        """
        
        response = self.ollama_client.generate(prompt)
        if response:
            return self.ollama_client.extract_response(response).strip()
        return "Analysis based on market sentiment."
