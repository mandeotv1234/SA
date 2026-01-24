
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
        Run deep learning prediction and produce rich structured output.
        """
        # DEBUG TRACE
        print(f"  [DL-TRACE] Starting sophisticated prediction for {symbol}")
        
        # 1. Get Market Data (Candles)
        # Assuming TIMEFRAME env is for short-term (e.g. 1h or 15m)
        import os
        timeframe = os.getenv("TIMEFRAME", "15min")
        
        # Need historical candles for LSTM
        candles = get_candles(symbol.upper(), 100, interval=timeframe) 
        
        # Fallback if insufficient data
        current_price = 0.0
        if candles:
             current_price = float(candles[-1]['close'])

        if not candles or len(candles) < 10: # Relaxed threshold for testing
            logger.warning(f"Not enough candles for {symbol}. Got {len(candles)}")
            # Mock data if really needed or return None. 
            # For now return None to force backfill attention.
            return None

        # Convert list of dicts to DataFrame for processing
        candles_df = pd.DataFrame(candles)
        candles_df['timestamp'] = pd.to_datetime(candles_df['time'], unit='s')
        
        # 2. Prepare News Data
        news_data = []
        for n in news_list:
            news_data.append({
                'timestamp': pd.to_datetime(n['timestamp'], unit='s'),
                'title': n.get('title', ''),
                'text': f"{n.get('title', '')}. {n.get('content', '')[:200]}",
                'source': n.get('source', 'Unknown'),
                'sentiment_score': n.get('sentiment_score', 0)
            })
        news_df = pd.DataFrame(news_data)

        # 3. Align Data
        aligned_df = self.data_processor.align_news_to_candles(candles_df, news_df, timeframe=timeframe)

        # 4. Prepare Tensor Input
        # Log Return Normalization
        aligned_df['close_norm'] = np.log(aligned_df['close'] / aligned_df['close'].shift(1) + 1.0)
        aligned_df.fillna(0, inplace=True)
        # Use simplistic normalization for now compatible with model input
        # Note: Model expects [Batch, Seq, 5] of raw features usually, 
        # but better to feed normalized features if the model was trained on them.
        # Assuming model accepts raw for now (or trained on raw), or we create a normalized view.
        # Let's create a proxy for 'normalized' input using the temp columns.
        
        # Reconstruct normalized DF for input
        model_input_df = aligned_df.copy()
        model_input_df['close'] = model_input_df['close_norm']
        model_input_df['open'] = model_input_df['close_norm'] # Approx
        model_input_df['high'] = model_input_df['close_norm']
        model_input_df['low'] = model_input_df['close_norm']
        model_input_df['volume'] = np.log(model_input_df['volume'] + 1.0)

        X_price, X_news = self.data_processor.prepare_lstm_input(model_input_df, lookback=30)
        
        if X_price is None:
             return None

        # Take the last sample
        X_price_last = X_price[-1].unsqueeze(0).to(self.device)
        X_news_last = X_news[-1].unsqueeze(0).to(self.device)

        # 5. Model Inference
        with torch.no_grad():
            prob, attn_weights = self.model(X_price_last, X_news_last)
            
        prob_value = prob.item()
        
        # 6. Interpret Attention & News
        attn_weights = attn_weights.squeeze().cpu().numpy()
        top_idx = np.argmax(attn_weights)
        top_prob = attn_weights[top_idx] # Attention score
        
        # Identify Top News
        top_news_item = None
        top_sources = []
        
        if not news_df.empty:
            # Map sequence index to dataframe index
            # Seq length = 30. Last index corresponds to aligned_df.iloc[-1]
            # top_idx is relative to the window start.
            window_start_idx = len(aligned_df) - 30
            abs_idx = window_start_idx + top_idx
            
            if abs_idx < len(aligned_df):
                top_candle_time = aligned_df.iloc[abs_idx]['timestamp']
                
                # Find news around this candle
                mask = (news_df['timestamp'] >= top_candle_time) & (news_df['timestamp'] < top_candle_time + pd.Timedelta(minutes=60)) # widen window
                relevant_news = news_df[mask]
                
                # FALLBACK: If no news in attention window, use LATEST news
                # This ensures we always have something to explain if news exists
                if relevant_news.empty and not news_df.empty:
                    # Sort by timestamp desc
                    relevant_news = news_df.sort_values('timestamp', ascending=False).head(3)
                
                # Filter by symbol relevance if possible
                # Simple keyword match in title
                symbol_base = symbol.replace('USDT', '').replace('BTC', 'Bitcoin').replace('ETH', 'Ethereum')
                
                symbol_news = relevant_news[relevant_news['title'].str.contains(symbol_base, case=False, na=False)]
                if not symbol_news.empty:
                    relevant_news = symbol_news

                if not relevant_news.empty:
                    top_article = relevant_news.iloc[0]
                    top_news_item = {
                        "title": top_article['title'],
                        "source": top_article['source'],
                        "sentiment": top_article['sentiment_score']
                    }
                    
                    # Fill sources list
                    for _, row in relevant_news.head(3).iterrows():
                        top_sources.append({
                            "title": row['title'],
                            "source": row['source'],
                            "impact_score": round(abs(row['sentiment_score'] * (top_prob * 10)) + 0.1, 2) # Synthetic impact score
                        })

        # 7. Construct Rich Forecast
        # Short Term (1h)
        direction_1h = "UP" if prob_value > 0.52 else ("DOWN" if prob_value < 0.48 else "SIDEWAYS")
        confidence_1h = abs(prob_value - 0.5) * 2 * 100 # 0-100%
        
        volatility_val = aligned_df['close'].std()
        volatility_label = "HIGH" if volatility_val > (current_price * 0.02) else "MEDIUM"
        if volatility_val < (current_price * 0.005): volatility_label = "LOW"
        
        # Price Target 1H (Simple linear projection based on prob strength)
        move_percent_1h = (prob_value - 0.5) * 0.05 # Max 2.5% move assumption for 1h
        target_price_1h = current_price * (1 + move_percent_1h)

        # Long Term (24h) - Heuristic projection or separate model
        # For now, amplify 1h trend but dampen with mean reversion
        direction_24h = direction_1h # Assume trend persistence
        if confidence_1h < 20: direction_24h = "SIDEWAYS"
        
        range_low = current_price * 0.95
        range_high = current_price * 1.05
        
        if direction_24h == "UP":
            range_low = current_price * 0.98
            range_high = current_price * 1.08
        elif direction_24h == "DOWN":
            range_low = current_price * 0.92
            range_high = current_price * 1.02

        # 8. Generate Causal Explanation (Vietnamese)
        causal_analysis = self.generate_rich_explanation(symbol, direction_1h, top_news_item)

        return {
            "symbol": symbol,
            "current_price": round(current_price, 2),
            "forecast": {
                "next_1h": {
                    "direction": direction_1h,
                    "expected_price": round(target_price_1h, 2),
                    "volatility": volatility_label,
                    "confidence": round(confidence_1h, 1)
                },
                "next_24h": {
                    "direction": direction_24h,
                    "expected_range": {
                        "low": round(range_low, 2),
                        "high": round(range_high, 2)
                    },
                    "confidence": round(confidence_1h * 0.8, 1) # Decay confidence
                }
            },
            "causal_analysis": causal_analysis,
            "sources": top_sources
        }

    def generate_rich_explanation(self, symbol, direction, top_news_item):
        """
        Calls Ollama to generate a structured causal analysis in Vietnamese.
        """
        # Default fallback
        fallback = {
            "primary_driver": "MARKET_SENTIMENT",
            "key_event": "Biến động thị trường thông thường.",
            "explanation_vi": f"Mô hình kỹ thuật AI nhận thấy tín hiệu {direction} dựa trên phân tích chuỗi nến lịch sử. Chưa có tin tức cụ thể tác động mạnh trong khung giờ này.",
            "sentiment_impact": {"news_sentiment": 0, "social_volume": "LOW"}
        }

        if not top_news_item:
            return fallback

        news_text = top_news_item.get('title', '')
        
        prompt = f"""
        Bạn là chuyên gia Crypto AI. Hãy phân tích tác động của tin tức sau đến giá {symbol}.
        Tin tức: "{news_text}"
        Xu hướng dự báo AI: {direction}
        
        Hãy trả về kết quả dưới dạng JSON (không markdown) với cấu trúc sau:
        {{
            "primary_driver": "MACRO_NEWS" hoặc "ECOSYSTEM_NEWS" hoặc "WHALE_ACTIVITY",
            "key_event": "Tóm tắt sự kiện chính trong 1 câu ngắn tiếng Anh",
            "explanation_vi": "Giải thích chi tiết nguyên nhân nhân quả bằng Tiếng Việt (3-4 câu). Tại sao tin này làm giá {direction}? Nhắc đến tâm lý đám đông hoặc cá voi.",
            "sentiment_impact": {{
                "news_sentiment": (số từ -1 đến 1),
                "social_volume": "HIGH" hoặc "MEDIUM" hoặc "LOW"
            }}
        }}
        """
        
        try:
            api_result = self.ollama_client.generate(prompt)
            if api_result:
                response = self.ollama_client.extract_response(api_result)
                if response:
                    import json
                    # Clean response (sometimes Ollama adds Markdown blocks)
                    clean_json = response.replace("```json", "").replace("```", "").strip()
                    return json.loads(clean_json)
        except Exception as e:
            logger.error(f"Ollama generation failed: {e}")
            
        return fallback
