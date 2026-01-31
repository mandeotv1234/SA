
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
        # 6. Interpret Attention & News
        attn_weights = attn_weights.squeeze().cpu().numpy()
        top_idx = np.argmax(attn_weights)
        top_prob = attn_weights[top_idx] # Attention score
        
        # Decide Driver: News vs Technical
        driver_type = "TECHNICAL"
        top_news_item = None
        top_sources = []
        
        if not news_df.empty:
            # Map sequence index to dataframe index
            # Seq length = 30. Last index corresponds to aligned_df.iloc[-1]
            window_start_idx = len(aligned_df) - 30
            abs_idx = window_start_idx + top_idx
            
            if abs_idx < len(aligned_df):
                top_candle_time = aligned_df.iloc[abs_idx]['timestamp']
                
                # Find news around this candle
                mask = (news_df['timestamp'] >= top_candle_time) & (news_df['timestamp'] < top_candle_time + pd.Timedelta(minutes=60)) 
                relevant_news = news_df[mask]
                
                if not relevant_news.empty:
                    # Check if attention is strong enough (heuristic threshold)
                    if top_prob > 0.15:
                        driver_type = "NEWS"
                        
                        symbol_base = symbol.replace('USDT', '').replace('BTC', 'Bitcoin').replace('ETH', 'Ethereum')
                        symbol_news = relevant_news[relevant_news['title'].str.contains(symbol_base, case=False, na=False)]
                        
                        top_article = symbol_news.iloc[0] if not symbol_news.empty else relevant_news.iloc[0]
                        
                        top_news_item = {
                            "title": top_article['title'],
                            "source": top_article['source'],
                            "sentiment": top_article['sentiment_score'],
                            "attention_score": float(top_prob)
                        }
                        
                        # Fill sources list
                        for _, row in relevant_news.head(3).iterrows():
                            top_sources.append({
                                "title": row['title'],
                                "source": row['source'],
                                "impact_score": round(abs(row['sentiment_score'] * (top_prob * 10)) + 0.1, 2) 
                            })

        # 7. Construct Rich Forecast
        # Short Term (1h)
        direction_1h = "UP" if prob_value > 0.52 else ("DOWN" if prob_value < 0.48 else "SIDEWAYS")
        
        # Improved confidence calculation
        # For UP/DOWN: scale from 0-100% based on distance from 0.5
        # For SIDEWAYS: use inverse - higher when closer to 0.5
        if direction_1h == "SIDEWAYS":
            # For SIDEWAYS, confidence is HIGH when prob is close to 0.5
            # Map 0.48-0.52 range to 60-85% confidence
            distance_from_center = abs(prob_value - 0.5)
            max_sideways_distance = 0.02  # 0.48 or 0.52
            sideways_strength = 1 - (distance_from_center / max_sideways_distance)
            confidence_1h = 60 + (sideways_strength * 25)  # 60-85%
        else:
            # For UP/DOWN, confidence increases with distance from 0.5
            raw_confidence = abs(prob_value - 0.5) * 2 * 100  # 0-100%
            # Apply a boost to make it more meaningful (min 40%, max 95%)
            confidence_1h = min(95, max(40, 40 + raw_confidence * 1.1))
        
        volatility_val = aligned_df['close'].std()
        volatility_label = "HIGH" if volatility_val > (current_price * 0.02) else "MEDIUM"
        if volatility_val < (current_price * 0.005): volatility_label = "LOW"
        
        # Price Target 1H 
        move_percent_1h = (prob_value - 0.5) * 0.05 
        target_price_1h = current_price * (1 + move_percent_1h)

        # Long Term (24h) 
        direction_24h = direction_1h 
        if confidence_1h < 50: direction_24h = "SIDEWAYS"
        
        range_low = current_price * 0.95
        range_high = current_price * 1.05
        
        if direction_24h == "UP":
            range_low = current_price * 0.98
            range_high = current_price * 1.08
        elif direction_24h == "DOWN":
            range_low = current_price * 0.92
            range_high = current_price * 1.02

        # 8. Generate True Causal Explanation
        if driver_type == "NEWS" and top_news_item:
             causal_analysis = self.generate_news_explanation(symbol, direction_1h, top_news_item)
        else:
             causal_analysis = self.generate_technical_explanation(symbol, direction_1h, volatility_label, top_prob)

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
                    "confidence": round(confidence_1h * 0.8, 1) 
                }
            },
            "causal_analysis": causal_analysis,
            "sources": top_sources,
            "debug_metadata": {
                "driver": driver_type,
                "attention_score": float(top_prob)
            }
        }

    def generate_news_explanation(self, symbol, direction, top_news_item):
        """
        Calls Ollama to generate a structured causal analysis based on NEWS.
        """
        news_text = top_news_item.get('title', '')
        attn_score = top_news_item.get('attention_score', 0)
        
        prompt = f"""
        Bạn là chuyên gia Crypto AI. Hãy phân tích tác động của tin tức sau đến giá {symbol}.
        Tin tức: "{news_text}" (Độ chú ý của mô hình: {attn_score:.2f})
        Xu hướng dự báo AI: {direction}
        
        Hãy trả về kết quả dưới dạng JSON (không markdown) với cấu trúc sau:
        {{
            "primary_driver": "NEWS_EVENT",
            "key_event": "Tóm tắt tin tức trong 1 câu ngắn tiếng Anh",
            "explanation_vi": "Giải thích tại sao tin này dẫn đến xu hướng {direction}. Đề cập đến mức độ quan tâm của thị trường.",
            "sentiment_impact": {{
                "news_sentiment": (số từ -1 đến 1),
                "social_volume": "HIGH"
            }}
        }}
        """
        return self._call_ollama(prompt)

    def generate_technical_explanation(self, symbol, direction, volatility, attn_score):
        """
        Generates explanation based on Technical Analysis (No News Driver).
        """
        prompt = f"""
        Bạn là chuyên gia Phân tích Kỹ thuật Crypto. Hiện tại KHÔNG CÓ tin tức quan trọng nào ảnh hưởng đến giá {symbol}.
        Mô hình Deep Learning dự báo xu hướng: {direction}.
        Biến động thị trường: {volatility}.
        
        Hãy trả về kết quả dưới dạng JSON (không markdown) với cấu trúc sau:
        {{
            "primary_driver": "TECHNICAL_MOMENTUM",
            "key_event": "Technical Market Structure Update",
            "explanation_vi": "Giải thích xu hướng {direction} dựa trên dòng tiền, hành động giá (Price Action) và tâm lý thị trường kỹ thuật. KHÔNG ĐƯỢC BỊA TIN TỨC.",
            "sentiment_impact": {{
                "news_sentiment": 0,
                "social_volume": "LOW"
            }}
        }}
        """
        return self._call_ollama(prompt)

    def _call_ollama(self, prompt):
        try:
            api_result = self.ollama_client.generate(prompt)
            if api_result:
                response = self.ollama_client.extract_response(api_result)
                if response:
                    import json
                    clean_json = response.replace("```json", "").replace("```", "").strip()
                    return json.loads(clean_json)
        except Exception as e:
            logger.error(f"Ollama generation failed: {e}")
            
        return {
            "primary_driver": "UNKNOWN",
            "key_event": "Market Analysis",
            "explanation_vi": "Hệ thống đang cập nhật dữ liệu.",
            "sentiment_impact": {"news_sentiment": 0, "social_volume": "LOW"}
        }
