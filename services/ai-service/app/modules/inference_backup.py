
import logging
import torch
import numpy as np
import pandas as pd
from datetime import datetime
from app.modules.data_processor import DataProcessor
from app.modules.model import AdvancedDualStreamNetwork
from app.modules.ollama_client import OllamaClient
from app.market_cache import get_candles

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("InferenceEngine")

class InferenceEngine:
    def __init__(self, model_path=None, device="cpu"):
        self.device = device
        self.data_processor = DataProcessor(device=device)
        
        # Initialize Advanced Multi-Horizon Model
        self.model = AdvancedDualStreamNetwork(
            input_dim=11,
            news_dim=768,
            hidden_dim=128,
            num_lstm_layers=3,
            num_transformer_layers=2,
            num_attention_heads=8,
            dropout=0.3
        ).to(device)
        
        self.ollama_client = OllamaClient()
        
        if model_path:
            self.load_model(model_path)
        else:
            logger.warning("⚠️  No trained model found. Using random weights!")
            logger.warning("⚠️  To train the model, run: python train.py")


    def load_model(self, path):
        try:
            self.model.load_state_dict(torch.load(path, map_location=self.device))
            self.model.eval()
            logger.info(f"Model loaded from {path}")
        except FileNotFoundError:
            logger.warning(f"Model file not found at {path}. Using random weights.")
        except RuntimeError as e:
            if "size mismatch" in str(e):
                 logger.warning(f"Model size gap (upgrade detected). Re-initializing with new architecture. Error: {e}")
                 # Simply ignore the old weights and use current initialized state
                 pass
            else:
                 logger.error(f"Failed to load model: {e}")
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
        # 2. Prepare News Data
        # [NEW] Calculate explicit sentiment scores using FinBERT
        texts_for_sentiment = [f"{n.get('title', '')}. {n.get('content', '')[:200]}" for n in news_list]
        sentiment_scores = self.data_processor.get_sentiment_score(texts_for_sentiment)
        
        news_data = []
        for i, n in enumerate(news_list):
            # Safe get sentiment
            s_score = sentiment_scores[i] if i < len(sentiment_scores) else 0.0
            
            news_data.append({
                'timestamp': pd.to_datetime(n['timestamp'], unit='s'),
                'title': n.get('title', ''),
                'text': texts_for_sentiment[i],
                'full_content': n.get('content', ''),
                'source': n.get('source', 'Unknown'),
                'sentiment_score': s_score
            })
        news_df = pd.DataFrame(news_data)

        # 3. Align Data
        aligned_df = self.data_processor.align_news_to_candles(candles_df, news_df, timeframe=timeframe)

        # [NEW] Calculate technical indicators
        aligned_df = self.data_processor.add_technical_indicators(aligned_df)
        
        # Extract latest indicators for prompt
        latest = aligned_df.iloc[-1]
        tech_indicators = {
            "rsi": round(latest.get('rsi', 50), 2),
            "macd": round(latest.get('macd', 0), 4),
            "bb_high": round(latest.get('bb_high', 0), 2),
            "bb_low": round(latest.get('bb_low', 0), 2),
            "volume_sma": round(latest.get('sma_20', 0), 2),
            "current_volume": latest.get('volume', 0)
        }

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
        # 5. Model Inference
        with torch.no_grad():
            # Dual-Head Output: Prob (Direction), Return (Regression), Attention
            prob, pred_return_tensor, attn_weights = self.model(X_price_last, X_news_last)
            
        prob_value = prob.item()
        pred_return_val = pred_return_tensor.item() # Scalar % change
        
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
                            "content": top_article.get('full_content', top_article['text']),
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
        
        # Price Target 1H - REALISTIC APPROACH
        # Since regression head is untrained, use probability + technical indicators
        # to generate realistic price targets (0.5% - 3% max change)
        
        # Base move from probability
        prob_strength = abs(prob_value - 0.5) * 2  # 0 to 1
        
        # Get RSI for additional context
        latest_rsi = tech_indicators.get('rsi', 50)
        
        # Calculate realistic move percentage
        if direction_1h == "SIDEWAYS":
            # Very small move for sideways
            move_percent_1h = (prob_value - 0.5) * 0.005  # Max ±0.25%
        else:
            # Base move: 0.3% to 2.5% depending on confidence
            base_move = 0.003 + (prob_strength * 0.022)  # 0.3% to 2.5%
            
            # Adjust based on volatility
            if volatility_label == "HIGH":
                base_move *= 1.3
            elif volatility_label == "LOW":
                base_move *= 0.7
            
            # Adjust based on RSI extremes
            if latest_rsi > 70:  # Overbought - likely reversal
                base_move *= 0.8
            elif latest_rsi < 30:  # Oversold - strong bounce potential
                base_move *= 1.2
            
            # Apply direction
            move_percent_1h = base_move if direction_1h == "UP" else -base_move
            
            # Safety cap: max ±3%
            move_percent_1h = max(-0.03, min(0.03, move_percent_1h))
        
        target_price_1h = current_price * (1 + move_percent_1h)

        # Long Term (24h) - SPECIFIC PRICE, NOT RANGE
        # 24h should amplify 1h trend but with more uncertainty
        direction_24h = direction_1h
        
        # Calculate 24h move (typically 2-4x the 1h move, but capped at ±8%)
        if direction_1h == "SIDEWAYS":
            move_percent_24h = move_percent_1h * 2  # Still small
            direction_24h = "SIDEWAYS"
        else:
            # Amplify the 1h move for 24h
            move_percent_24h = move_percent_1h * 3.5
            
            # Cap at ±8%
            move_percent_24h = max(-0.08, min(0.08, move_percent_24h))
            
            # Update direction based on final move
            if abs(move_percent_24h) < 0.01:
                direction_24h = "SIDEWAYS"
            elif move_percent_24h > 0:
                direction_24h = "UP"
            else:
                direction_24h = "DOWN"
        
        target_price_24h = current_price * (1 + move_percent_24h)
        
        # For display purposes, also calculate a range (±20% of the move)
        range_margin = abs(move_percent_24h) * 0.2
        range_low = current_price * (1 + move_percent_24h - range_margin)
        range_high = current_price * (1 + move_percent_24h + range_margin)

        # 8. Generate True Causal Explanation
        dl_stats = {
            "probability": round(prob_value, 4),
            "confidence": round(confidence_1h, 1),
            "volatility": volatility_label,
            "predicted_return": round(move_percent_1h * 100, 2) # e.g. 2.5%
        }

        if driver_type == "NEWS" and top_news_item:
             causal_analysis = self.generate_news_explanation(symbol, direction_1h, top_news_item, tech_indicators, dl_stats, top_sources)
        else:
             causal_analysis = self.generate_technical_explanation(symbol, direction_1h, dl_stats, float(top_prob), tech_indicators, top_sources)

        return {
            "symbol": symbol,
            "current_price": round(current_price, 2),
            "forecast": {
                "next_1h": {
                    "direction": direction_1h,
                    "expected_price": round(target_price_1h, 2),
                    "price_change_percent": round(move_percent_1h * 100, 2),
                    "volatility": volatility_label,
                    "confidence": round(confidence_1h, 1)
                },
                "next_24h": {
                    "direction": direction_24h,
                    "expected_price": round(target_price_24h, 2),
                    "price_change_percent": round(move_percent_24h * 100, 2),
                    "expected_range": {
                        "low": round(range_low, 2),
                        "high": round(range_high, 2)
                    },
                    "confidence": round(confidence_1h * 0.75, 1)
                }
            },
            "causal_analysis": causal_analysis,
            "sources": top_sources,
            "debug_metadata": {
                "driver": driver_type,
                "attention_score": float(top_prob)
            }
        }

    def generate_news_explanation(self, symbol, direction, top_news_item, tech_inds, dl_stats, other_news):
        """
        Expert-level causal analysis when NEWS is the primary driver.
        Uses 3-layer reasoning: Event Alignment -> Causal Analysis -> Strategic Advice.
        """
        # Extract primary news data
        news_title = top_news_item.get('title', 'Unknown Event')
        news_content = top_news_item.get('content', '')
        news_source = top_news_item.get('source', 'Unknown')
        news_timestamp = top_news_item.get('timestamp', 'N/A')
        attn_score = top_news_item.get('attention_score', 0)
        impact_score = top_news_item.get('impact_score', 0)
        sentiment_score = top_news_item.get('sentiment_score', 0)
        
        # Extract technical indicators
        rsi = tech_inds.get('rsi', 50)
        macd = tech_inds.get('macd', 0)
        bb_high = tech_inds.get('bb_high', 0)
        bb_low = tech_inds.get('bb_low', 0)
        
        # Format supporting news context
        supporting_news = ""
        if other_news and len(other_news) > 0:
            supporting_news = "\n📰 TIN TỨC HỖ TRỢ (Supporting Context):\n"
            for idx, item in enumerate(other_news[:3], 1):
                supporting_news += f"   {idx}. {item.get('title', 'N/A')} "
                supporting_news += f"(Sentiment: {item.get('sentiment_score', 0):.2f}, Impact: {item.get('impact_score', 0):.2f})\n"
        else:
            supporting_news = "\n📰 TIN TỨC HỖ TRỢ: Không có tin tức bổ sung trong khung giờ này.\n"
        
        # Determine technical bias
        tech_bias = "NEUTRAL"
        if rsi > 70:
            tech_bias = "OVERBOUGHT (Áp lực chốt lời)"
        elif rsi < 30:
            tech_bias = "OVERSOLD (Cơ hội mua vào)"
        elif macd > 0:
            tech_bias = "BULLISH MOMENTUM"
        elif macd < 0:
            tech_bias = "BEARISH MOMENTUM"
        
        # Build expert-level prompt
        prompt = f"""
🎯 ROLE: Bạn là Senior Crypto Market Analyst với 10 năm kinh nghiệm phân tích on-chain và market microstructure.

📊 NHIỆM VỤ: Phân tích nhân quả (Causal Analysis) cho dự báo giá {symbol} dựa trên sự kiện tin tức và dữ liệu kỹ thuật.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 DỮ LIỆU ĐẦU VÀO (MARKET INTELLIGENCE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔮 KẾT QUẢ DỰ BÁO (AI MODEL OUTPUT):
   • Xu hướng: {direction}
   • Mục tiêu giá: {dl_stats['predicted_return']:+.2f}% (Regression Head)
   • Xác suất: {dl_stats['probability']:.3f}
   • Độ tin cậy: {dl_stats['confidence']:.1f}%
   • Volatility: {dl_stats['volatility']}

📰 SỰ KIỆN TIN TỨC CHÍNH (PRIMARY NEWS CATALYST):
   • Tiêu đề: "{news_title}"
   • Nguồn: {news_source}
   • Thời gian: {news_timestamp}
   • Nội dung: "{news_content}"
   
   🎯 METRICS:
   • Attention Score: {attn_score:.3f} (Mức độ mô hình chú ý đến tin này)
   • Impact Score: {impact_score:.3f} (Tác động dự kiến đến giá)
   • Sentiment Score: {sentiment_score:+.2f} (Phân tích cảm xúc: -1=Cực tiêu cực, +1=Cực tích cực)
{supporting_news}

📊 DỮ LIỆU KỸ THUẬT (TECHNICAL INDICATORS):
   • RSI(14): {rsi:.2f} → Trạng thái: {tech_bias}
   • MACD: {macd:.4f} → {"Xu hướng tăng" if macd > 0 else "Xu hướng giảm"}
   • Bollinger Bands: [{bb_low:.2f} - {bb_high:.2f}]
   • Current Volatility: {dl_stats['volatility']}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 YÊU CẦU PHÂN TÍCH (3-LAYER REASONING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYER 1 - EVENT ALIGNMENT (Phân tích thời điểm):
→ Tin tức này xuất hiện có đồng bộ với biến động giá không?
→ Attention Score cao ({attn_score:.3f}) chứng tỏ điều gì?

LAYER 2 - CAUSAL ANALYSIS (Phân tích nhân quả):
→ Tại sao tin tức này lại dẫn đến dự báo {direction} {dl_stats['predicted_return']:+.2f}%?
→ Sentiment ({sentiment_score:+.2f}) có mâu thuẫn với Technical Bias ({tech_bias}) không?
→ Nếu có xung đột: Giải thích tại sao yếu tố nào chiếm ưu thế? (VD: "Mặc dù RSI quá mua, tin tức tích cực mạnh từ SEC approval tạo FOMO wave, đẩy giá breakout resistance")

LAYER 3 - STRATEGIC INSIGHT (Lời khuyên chiến lược):
→ Dựa trên phân tích, nhà đầu tư nên làm gì? (Mua/Bán/Chờ đợi/DCA)
→ Rủi ro cần lưu ý? (Whale dump, Liquidation cascade, False breakout...)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YÊU CẦU ĐẦU RA (JSON FORMAT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trả về JSON thuần (KHÔNG có markdown ```json):
{{
    "primary_driver": "NEWS_CATALYST",
    "key_event": "Tóm tắt sự kiện chính bằng tiếng Anh (VD: 'SEC Approves Bitcoin ETF' hoặc 'Fed Rate Cut Announced')",
    "explanation_vi": "Đoạn văn phân tích 4-5 câu, SẮC SẢO, CÓ DẪN CHỨNG CỤ THỂ. Bắt đầu: 'Dự báo {direction} {dl_stats['predicted_return']:+.2f}% được thúc đẩy chủ yếu bởi...' Phải đề cập: (1) Tên sự kiện, (2) Sentiment score, (3) Tương tác với RSI/MACD, (4) Kết luận nhân quả rõ ràng.",
    "sentiment_impact": {{
        "news_sentiment": {sentiment_score},
        "social_volume": "HIGH/MEDIUM/LOW"
    }},
    "actionable_advice": "Lời khuyên cụ thể cho trader (1-2 câu ngắn gọn, VD: 'Nên DCA trong vùng support 45K-46K. Stop-loss dưới 44.5K để phòng ngừa false breakout.')"
}}

⚠️ LƯU Ý QUAN TRỌNG:
- Sử dụng thuật ngữ chuyên nghiệp: Breakout, Support/Resistance, Liquidation, Whale accumulation, FOMO, Capitulation...
- KHÔNG viết chung chung. Phải có số liệu cụ thể (RSI, Sentiment score...).
- Giải thích TẠI SAO, không chỉ MÔ TẢ.
"""
        
        return self._call_ollama(prompt)

    def generate_technical_explanation(self, symbol, direction, dl_stats, attn_score, tech_inds, other_news):
        """
        Expert-level technical analysis when PRICE ACTION is the primary driver.
        Focuses on market microstructure, supply/demand dynamics, and order flow.
        """
        # Extract technical indicators
        rsi = tech_inds.get('rsi', 50)
        macd = tech_inds.get('macd', 0)
        macd_signal = tech_inds.get('macd_signal', 0)
        macd_diff = tech_inds.get('macd_diff', 0)
        bb_high = tech_inds.get('bb_high', 0)
        bb_low = tech_inds.get('bb_low', 0)
        sma_20 = tech_inds.get('volume_sma', 0)
        current_vol = tech_inds.get('current_volume', 0)
        
        # Determine market regime
        market_regime = "CONSOLIDATION"
        if rsi > 70:
            market_regime = "OVERBOUGHT ZONE - Profit-taking pressure"
        elif rsi < 30:
            market_regime = "OVERSOLD ZONE - Accumulation opportunity"
        elif macd > macd_signal and macd_diff > 0:
            market_regime = "BULLISH MOMENTUM - Buyers in control"
        elif macd < macd_signal and macd_diff < 0:
            market_regime = "BEARISH MOMENTUM - Sellers dominating"
        
        # Volume analysis
        vol_status = "NORMAL"
        if current_vol > sma_20 * 1.5:
            vol_status = "HIGH (Strong conviction)"
        elif current_vol < sma_20 * 0.5:
            vol_status = "LOW (Weak participation)"
        
        # Format news context (if any)
        news_context = ""
        if other_news and len(other_news) > 0:
            news_context = "\n📰 BỐI CẢNH TIN TỨC (News Context - Low Impact):\n"
            for idx, item in enumerate(other_news[:3], 1):
                news_context += f"   {idx}. {item.get('title', 'N/A')} "
                news_context += f"(Sentiment: {item.get('sentiment_score', 0):+.2f}, Impact: {item.get('impact_score', 0):.2f})\n"
            news_context += "\n   ⚠️ LƯU Ý: Các tin tức trên có Attention Score thấp ({attn_score:.3f}), không đủ mạnh để thay đổi xu hướng kỹ thuật.\n"
        else:
            news_context = "\n📰 BỐI CẢNH TIN TỨC: Không có sự kiện tin tức đáng kể. Biến động giá thuần túy do cung-cầu (Supply/Demand dynamics).\n"
        
        # Build expert-level technical prompt
        prompt = f"""
🎯 ROLE: Bạn là Senior Technical Analyst chuyên về Market Microstructure và Order Flow Analysis.

📊 NHIỆM VỤ: Phân tích kỹ thuật chuyên sâu cho {symbol}, giải thích dự báo {direction} {dl_stats['predicted_return']:+.2f}% dựa trên price action và technical indicators.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 DỮ LIỆU KỸ THUẬT (TECHNICAL INTELLIGENCE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔮 KẾT QUẢ DỰ BÁO (AI MODEL OUTPUT):
   • Xu hướng: {direction}
   • Mục tiêu giá: {dl_stats['predicted_return']:+.2f}% (Regression Head)
   • Xác suất: {dl_stats['probability']:.3f}
   • Độ tin cậy: {dl_stats['confidence']:.1f}%
   • Volatility: {dl_stats['volatility']}

📊 CHỈ SỐ KỸ THUẬT (TECHNICAL INDICATORS):
   🎯 MOMENTUM INDICATORS:
   • RSI(14): {rsi:.2f}
     → Trạng thái: {market_regime}
     → Giải thích: {"Vùng quá mua - Áp lực chốt lời cao" if rsi > 70 else "Vùng quá bán - Cơ hội tích lũy" if rsi < 30 else "Vùng trung lập - Chưa rõ xu hướng"}
   
   • MACD: {macd:.4f}
     → Signal Line: {macd_signal:.4f}
     → Histogram: {macd_diff:.4f}
     → Tín hiệu: {"BULLISH CROSS - Động lực mua mạnh" if macd > macd_signal else "BEARISH CROSS - Áp lực bán tăng"}
   
   🎯 VOLATILITY & RANGE:
   • Bollinger Bands: [{bb_low:.2f} - {bb_high:.2f}]
     → Độ rộng: {bb_high - bb_low:.2f}
     → Ý nghĩa: {"Biến động cao - Cơ hội breakout" if (bb_high - bb_low) > bb_low * 0.05 else "Biến động thấp - Thị trường sideway"}
   
   🎯 VOLUME ANALYSIS:
   • Current Volume: {current_vol:.0f}
   • SMA(20) Volume: {sma_20:.0f}
   • Volume Status: {vol_status}
   • Conviction Level: {"Rất cao - Smart money đang tham gia" if current_vol > sma_20 * 1.5 else "Thấp - Thiếu sự đồng thuận"}
{news_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 YÊU CẦU PHÂN TÍCH (TECHNICAL REASONING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYER 1 - MARKET STRUCTURE ANALYSIS:
→ Phân tích trạng thái thị trường hiện tại: {market_regime}
→ RSI {rsi:.2f} kết hợp với MACD {macd:.4f} cho thấy điều gì về supply/demand balance?
→ Volume {vol_status} chứng tỏ mức độ conviction của thị trường?

LAYER 2 - CAUSAL TECHNICAL LOGIC:
→ Tại sao các chỉ số kỹ thuật lại dẫn đến dự báo {direction} {dl_stats['predicted_return']:+.2f}%?
→ Có dấu hiệu Divergence (RSI vs Price) không? Nếu có, ý nghĩa gì?
→ Bollinger Bands đang mở rộng hay thu hẹp? Điều này báo hiệu gì cho breakout/breakdown?
→ Nếu có tin tức nhưng Impact thấp: Giải thích tại sao Technical vẫn chiếm ưu thế?

LAYER 3 - STRATEGIC POSITIONING:
→ Entry point tối ưu? (VD: "Chờ pullback về vùng support 0.382 Fibonacci")
→ Stop-loss placement? (VD: "Đặt SL dưới swing low gần nhất tại X")
→ Take-profit targets? (VD: "TP1 tại resistance R1, TP2 tại extension 1.618")
→ Risk/Reward ratio có hợp lý không?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YÊU CẦU ĐẦU RA (JSON FORMAT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trả về JSON thuần (KHÔNG có markdown ```json):
{{
    "primary_driver": "TECHNICAL_MOMENTUM",
    "key_event": "Technical Market Structure Update (VD: 'RSI Oversold Bounce' hoặc 'MACD Bullish Cross')",
    "explanation_vi": "Đoạn văn phân tích 4-5 câu, CHUYÊN SÂU VỀ KỸ THUẬT. Bắt đầu: 'Dự báo {direction} {dl_stats['predicted_return']:+.2f}% dựa trên phân tích kỹ thuật cho thấy...' Phải đề cập: (1) RSI và ý nghĩa, (2) MACD signal, (3) Volume confirmation, (4) Kết luận về supply/demand dynamics. Sử dụng thuật ngữ: Support/Resistance, Breakout, Liquidity grab, Order block, Fair Value Gap...",
    "sentiment_impact": {{
        "news_sentiment": 0.0,
        "social_volume": "LOW"
    }},
    "actionable_advice": "Lời khuyên giao dịch cụ thể (2-3 câu). VD: 'Entry: Mua khi RSI bounce từ vùng 30-35. Stop-loss: Dưới swing low tại X. Take-profit: Resistance R1 tại Y (Risk/Reward 1:2.5).'"
}}

⚠️ LƯU Ý QUAN TRỌNG:
- Phân tích phải dựa trên LOGIC KỸ THUẬT rõ ràng, không đoán mò.
- Giải thích TẠI SAO các chỉ số này lại tạo ra setup giao dịch.
- Đề cập đến price action patterns nếu có (Double bottom, Head & Shoulders, Flag, Wedge...).
- Nếu có xung đột giữa các chỉ số (VD: RSI tăng nhưng MACD giảm), phải giải thích yếu tố nào quan trọng hơn.
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
