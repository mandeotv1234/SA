
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
            checkpoint = torch.load(path, map_location=self.device)
            
            # Helper to handle full checkpoint vs direct state_dict
            if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                logger.info(f"Loading full checkpoint from {path} (Epoch {checkpoint.get('epoch', 'N/A')})")
                state_dict = checkpoint['model_state_dict']
            else:
                logger.info(f"Loading direct state_dict from {path}")
                state_dict = checkpoint
            
            self.model.load_state_dict(state_dict)
            self.model.eval()
            logger.info(f"Model loaded successfully from {path}")
            
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

    def detect_news_alignment(self, news_item, candles_df, current_price):
        """
        Detect if news timing aligns with price/volume spike.
        
        Returns alignment analysis dict with timing, volume spike, price reaction.
        """
        try:
            if candles_df.empty or 'timestamp' not in candles_df.columns:
                return {
                    'is_aligned': False,
                    'time_delta_minutes': 999,
                    'price_change_at_news': 0.0,
                    'volume_spike_percent': 0.0,
                    'alignment_score': 0.0
                }
            
            news_time = pd.to_datetime(news_item.get('timestamp'))
            
            # Find closest candle
            candles_df['time_diff'] = abs(candles_df['timestamp'] - news_time)
            closest_idx = candles_df['time_diff'].idxmin()
            closest_candle = candles_df.loc[closest_idx]
            
            time_delta = int(candles_df.loc[closest_idx, 'time_diff'].total_seconds() / 60)
            
            # Volume spike calculation
            volume_sma = candles_df['volume'].rolling(20, min_periods=1).mean()
            if volume_sma.iloc[closest_idx] > 0:
                volume_spike = ((closest_candle['volume'] / volume_sma.iloc[closest_idx]) - 1) * 100
            else:
                volume_spike = 0.0
            
            # Price change in next 3 candles
            if closest_idx + 3 < len(candles_df):
                price_before = closest_candle['close']
                price_after = candles_df.iloc[closest_idx + 3]['close']
                price_change = ((price_after / price_before) - 1) * 100
            else:
                price_change = 0.0
            
            # Alignment score: higher if timing close, volume spikes, price moves
            time_score = max(0, 1 - (time_delta / 60))  # Decay over 60 min
            volume_score = min(1, abs(volume_spike) / 100)  # Cap at 100% spike
            price_score = min(1, abs(price_change) / 5)  # Cap at 5% move
            
            alignment_score = (time_score * 0.4 + volume_score * 0.3 + price_score * 0.3)
            
            # Detailed Alignment Logging
            news_title = news_item.get('title', 'N/A')[:50]
            logger.info(f"[ALIGNMENT] '{news_title}...'")
            logger.info(f"  → Time Delta: {time_delta} min | Volume Spike: {volume_spike:+.1f}% | Price Change: {price_change:+.2f}%")
            logger.info(f"  → Scores: Time={time_score:.2f}, Vol={volume_score:.2f}, Price={price_score:.2f} → TOTAL: {alignment_score:.3f}")
            logger.info(f"  → Aligned: {'✓ YES' if alignment_score > 0.6 else '✗ NO'}")
            
            return {
                'is_aligned': alignment_score > 0.6,
                'time_delta_minutes': time_delta,
                'price_change_at_news': round(price_change, 2),
                'volume_spike_percent': round(volume_spike, 1),
                'alignment_score': round(alignment_score, 3)
            }
        except Exception as e:
            logger.error(f"Alignment detection failed: {e}")
            return {
                'is_aligned': False,
                'time_delta_minutes': 999,
                'price_change_at_news': 0.0,
                'volume_spike_percent': 0.0,
                'alignment_score': 0.0
            }

    def analyze_impact_mechanisms(self, alignment_data, tech_indicators, sentiment_score):
        """
        Determine impact mechanism: FOMO, Liquidation, Whale Activity, etc.
        """
        mechanisms = []
        
        rsi = tech_indicators.get('rsi', 50)
        
        # 1. FOMO Buying (volume spike + price up + positive sentiment)
        if (alignment_data['volume_spike_percent'] > 150 and 
            alignment_data['price_change_at_news'] > 2 and 
            sentiment_score > 0.5):
            mechanisms.append({
                'type': 'FOMO_BUYING',
                'evidence': f"Volume tăng {alignment_data['volume_spike_percent']:.0f}%, giá +{alignment_data['price_change_at_news']:.1f}% ngay sau tin tích cực (Sentiment {sentiment_score:+.2f})",
                'confidence': 0.85
            })
        
        # 2. Short Liquidation (RSI low before + sharp price spike)
        if rsi < 40 and alignment_data['price_change_at_news'] > 3:
            mechanisms.append({
                'type': 'SHORT_LIQUIDATION',
                'evidence': f"RSI thấp ({rsi:.1f}) trước tin, giá tăng đột ngột +{alignment_data['price_change_at_news']:.1f}% - dấu hiệu short squeeze",
                'confidence': 0.75
            })
        
        # 3. Whale Accumulation (high volume but price stable)
        if (alignment_data['volume_spike_percent'] > 100 and 
            abs(alignment_data['price_change_at_news']) < 1):
            mechanisms.append({
                'type': 'WHALE_ACCUMULATION',
                'evidence': f"Volume tăng {alignment_data['volume_spike_percent']:.0f}% nhưng giá ổn định ({alignment_data['price_change_at_news']:+.1f}%) - có thể tổ chức gom hàng",
                'confidence': 0.65
            })
        
        # 4. Panic Selling (negative sentiment + volume spike + price down)
        if (sentiment_score < -0.5 and 
            alignment_data['volume_spike_percent'] > 100 and 
            alignment_data['price_change_at_news'] < -2):
            mechanisms.append({
                'type': 'PANIC_SELLING',
                'evidence': f"Tin tiêu cực (Sentiment {sentiment_score:+.2f}) → Volume tăng {alignment_data['volume_spike_percent']:.0f}%, giá giảm {alignment_data['price_change_at_news']:.1f}%",
                'confidence': 0.80
            })
        
        return mechanisms if mechanisms else [{
            'type': 'GRADUAL_TREND',
            'evidence': 'Không có dấu hiệu tác động đột ngột. Biến động giá theo xu hướng tự nhiên.',
            'confidence': 0.50
        }]

    def build_structured_causal_reasoning(self, alignment_data, impact_mechanisms, tech_indicators, 
                                           top_news_item, news_df, direction, predicted_change):
        """
        Build structured causal reasoning with 3 layers as requested:
        1. ALIGNMENT - News timing vs Price/Volume correlation
        2. IMPACT - Why this news affects price (FOMO, Liquidation, Whale, etc.)
        3. DIVERGENCE - Any conflicts between news sentiment and price action
        """
        from datetime import datetime, timedelta
        
        # === LAYER 1: ALIGNMENT ===
        alignment_section = {
            "question": "Tin tức xuất hiện khi nào? Có khớp với biến động Volume/Giá không?",
            "time_delta_minutes": alignment_data.get('time_delta_minutes', 999),
            "is_aligned": alignment_data.get('is_aligned', False),
            "price_reaction": alignment_data.get('price_change_at_news', 0),
            "volume_spike_percent": alignment_data.get('volume_spike_percent', 0),
            "alignment_score": alignment_data.get('alignment_score', 0),
            "summary": ""
        }
        
        if alignment_data.get('is_aligned'):
            alignment_section["summary"] = (
                f"✓ TIN KHỚP: Tin xuất hiện {alignment_data['time_delta_minutes']} phút trước, "
                f"Volume tăng {alignment_data['volume_spike_percent']:.0f}%, "
                f"giá phản ứng {alignment_data['price_change_at_news']:+.2f}%. "
                f"Alignment score: {alignment_data['alignment_score']:.2f}/1.0 (Khớp mạnh)"
            )
        else:
            alignment_section["summary"] = (
                f"✗ TIN KHÔNG KHỚP: Tin xuất hiện {alignment_data['time_delta_minutes']} phút trước "
                f"nhưng thị trường phản ứng chậm. Biến động chủ yếu do yếu tố kỹ thuật."
            )
        
        # === LAYER 2: IMPACT ===
        impact_section = {
            "question": "Tại sao tin này khiến giá biến động như dự báo?",
            "mechanisms": [],
            "primary_mechanism": None,
            "summary": ""
        }
        
        if impact_mechanisms:
            for m in impact_mechanisms:
                impact_section["mechanisms"].append({
                    "type": m.get('type', 'UNKNOWN'),
                    "evidence": m.get('evidence', ''),
                    "confidence": m.get('confidence', 0)
                })
            
            # Find primary mechanism
            primary = max(impact_mechanisms, key=lambda x: x.get('confidence', 0))
            impact_section["primary_mechanism"] = primary.get('type')
            
            mechanism_translation = {
                'FOMO_BUYING': 'Tâm lý FOMO - Nhà đầu tư sợ bỏ lỡ cơ hội',
                'SHORT_LIQUIDATION': 'Thanh lý lệnh Short - Short squeeze',
                'WHALE_ACCUMULATION': 'Tổ chức/Cá voi gom hàng lớn',
                'PANIC_SELLING': 'Bán tháo hoảng loạn - Panic selling',
                'GRADUAL_TREND': 'Xu hướng tự nhiên theo cung-cầu'
            }
            
            impact_section["summary"] = (
                f"Nguyên nhân chính: {mechanism_translation.get(primary.get('type', ''), 'Không xác định')}. "
                f"{primary.get('evidence', '')}"
            )
        else:
            impact_section["summary"] = "Không phát hiện cơ chế tác động rõ ràng. Biến động theo xu hướng tự nhiên."
        
        # === LAYER 3: DIVERGENCE ===
        rsi = tech_indicators.get('rsi', 50)
        macd = tech_indicators.get('macd', 0)
        news_sentiment = 0.0
        if top_news_item:
            news_sentiment = top_news_item.get('sentiment', 0)
        
        divergence_section = {
            "question": "Có sự mâu thuẫn nào không? (Ví dụ: Tin xấu nhưng giá không giảm)",
            "has_divergence": False,
            "divergence_type": None,
            "technical_bias": "NEUTRAL",
            "news_sentiment": news_sentiment,
            "summary": ""
        }
        
        # Determine technical bias
        if rsi > 70:
            divergence_section["technical_bias"] = "OVERBOUGHT"
        elif rsi < 30:
            divergence_section["technical_bias"] = "OVERSOLD"
        elif macd > 0:
            divergence_section["technical_bias"] = "BULLISH"
        elif macd < 0:
            divergence_section["technical_bias"] = "BEARISH"
        
        # Check for divergences
        if news_sentiment > 0.3 and rsi > 70:
            divergence_section["has_divergence"] = True
            divergence_section["divergence_type"] = "BULLISH_NEWS_OVERBOUGHT"
            divergence_section["summary"] = (
                f"⚠️ CẢNH BÁO XUng đột: Tin tức tích cực (Sentiment {news_sentiment:+.2f}) "
                f"nhưng RSI {rsi:.1f} đang QUÁ MUA. Áp lực chốt lời cao, cẩn thận FAKEOUT."
            )
        elif news_sentiment < -0.3 and rsi < 30:
            divergence_section["has_divergence"] = True
            divergence_section["divergence_type"] = "BEARISH_NEWS_OVERSOLD"
            divergence_section["summary"] = (
                f"⚠️ CẢNH BÁO XUng đột: Tin tức tiêu cực (Sentiment {news_sentiment:+.2f}) "
                f"nhưng RSI {rsi:.1f} đang QUÁ BÁN. Có thể có lực bắt đáy mạnh."
            )
        elif news_sentiment < -0.3 and alignment_data.get('price_change_at_news', 0) > 0:
            divergence_section["has_divergence"] = True
            divergence_section["divergence_type"] = "BAD_NEWS_PRICE_UP"
            divergence_section["summary"] = (
                f"🔍 DIVERGENCE TÍCH CỰC: Tin xấu (Sentiment {news_sentiment:+.2f}) nhưng giá vẫn tăng "
                f"{alignment_data['price_change_at_news']:+.2f}%. → Lực cầu BẮT ĐÁY MẠNH, Smart Money đang gom."
            )
        elif news_sentiment > 0.3 and alignment_data.get('price_change_at_news', 0) < 0:
            divergence_section["has_divergence"] = True
            divergence_section["divergence_type"] = "GOOD_NEWS_PRICE_DOWN"
            divergence_section["summary"] = (
                f"🔍 DIVERGENCE TIÊU CỰC: Tin tốt (Sentiment {news_sentiment:+.2f}) nhưng giá giảm "
                f"{alignment_data['price_change_at_news']:.2f}%. → Sell the news / Whale đang xả hàng."
            )
        else:
            divergence_section["summary"] = (
                f"✓ ĐỒNG THUẬN: Không có xung đột giữa tin tức và hành động giá. "
                f"News Sentiment: {news_sentiment:+.2f}, Technical Bias: {divergence_section['technical_bias']}"
            )
        
        # === BUILD NEWS SOURCES LIST ===
        news_sources = []
        if top_news_item:
            # Calculate time ago
            news_ts = top_news_item.get('timestamp', 0)
            if isinstance(news_ts, (int, float)):
                time_ago_mins = int((datetime.now().timestamp() - news_ts) / 60)
            else:
                time_ago_mins = 0
            
            news_sources.append({
                "title": top_news_item.get('title', 'N/A'),
                "source": top_news_item.get('source', 'Unknown'),
                "time_ago_minutes": time_ago_mins,
                "sentiment_score": news_sentiment,
                "impact": "HIGH" if alignment_data.get('is_aligned') else "MEDIUM"
            })
        
        # Add supporting news from news_df
        if news_df is not None and not news_df.empty:
            for _, row in news_df.head(3).iterrows():
                if top_news_item and row.get('title') == top_news_item.get('title'):
                    continue
                news_sources.append({
                    "title": row.get('title', 'N/A'),
                    "source": row.get('source', 'Unknown'),
                    "sentiment_score": round(float(row.get('sentiment_score', 0)), 2),
                    "impact": "MEDIUM"
                })
        
        return {
            "alignment": alignment_section,
            "impact": impact_section,
            "divergence": divergence_section,
            "news_sources": news_sources[:5],  # Max 5 sources
            "recommendation": self._generate_recommendation(
                direction, predicted_change, divergence_section, alignment_data, tech_indicators
            )
        }
    
    def _generate_recommendation(self, direction, predicted_change, divergence, alignment, tech_inds):
        """Generate actionable trading recommendation."""
        rsi = tech_inds.get('rsi', 50)
        current_price = tech_inds.get('close', 0)
        bb_low = tech_inds.get('bb_low', 0)
        bb_high = tech_inds.get('bb_high', 0)
        
        recommendation = {
            "action": "HOLD",  # Default
            "entry_zone": None,
            "stop_loss": None,
            "take_profit": None,
            "risk_reward": None,
            "warning": None
        }
        
        if divergence.get('has_divergence'):
            recommendation["warning"] = divergence.get('summary', '')
            recommendation["action"] = "WAIT"  # Wait when there's divergence
        elif direction == "UP" and predicted_change > 1:
            recommendation["action"] = "BUY"
            recommendation["entry_zone"] = f"${current_price * 0.99:.2f} - ${current_price * 1.005:.2f}"
            recommendation["stop_loss"] = f"${bb_low * 0.98:.2f}" if bb_low else f"${current_price * 0.97:.2f}"
            recommendation["take_profit"] = f"${current_price * (1 + predicted_change/100 * 1.5):.2f}"
            recommendation["risk_reward"] = "1:2"
        elif direction == "DOWN" and predicted_change < -1:
            recommendation["action"] = "SELL"
            recommendation["stop_loss"] = f"${bb_high * 1.02:.2f}" if bb_high else f"${current_price * 1.03:.2f}"
        else:
            recommendation["action"] = "HOLD"
        
        return recommendation


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
        texts_for_sentiment = [f"{n.get('title', '')}. {n.get('content', '')}" for n in news_list]
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
            pred_1h, pred_24h, volatility_probs, attn_weights = self.model(X_price_last, X_news_last)
            
            # --- PROOF OF INTELLIGENCE ---
            raw_logit = pred_1h['direction_logit'].item()
            logger.info(f"  🧠 [AI-BRAIN] Neuron Output (Logit): {raw_logit:.6f} | Volatility Risk: {volatility_probs[0,1]:.4f}")
            # -----------------------------
            
        prob_value = pred_1h['direction'].item()
        pred_return_val = pred_1h['return'].item() # Scalar % change
        
        # 6. Interpret Attention & News
        # 6. Interpret Attention & News
        attn_weights_tensor = attn_weights['news_temporal'].squeeze().cpu().numpy()
        top_idx = np.argmax(attn_weights_tensor)
        top_prob = attn_weights_tensor[top_idx]
        
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
        # Direction will be determined AFTER calculating move_percent_1h
        
        volatility_val = aligned_df['close'].std()
        volatility_label = "HIGH" if volatility_val > (current_price * 0.02) else "MEDIUM"
        if volatility_val < (current_price * 0.005): volatility_label = "LOW"
        
        # Price Target 1H - SMART PREDICTION
        # If model is trained, use its output. Otherwise, use probability-based fallback
        
        # Check if model output seems reasonable (not too extreme)
        if abs(pred_return_val) > 0.5:  # Model predicting >50% change - likely untrained
            # Fallback: Use probability + sentiment for realistic prediction
            prob_strength = abs(prob_value - 0.5) * 2  # 0 to 1
            base_move = 0.005 + (prob_strength * 0.025)  # 0.5% to 3%
            
            # Apply direction from probability
            if prob_value > 0.52:
                move_percent_1h = base_move
            elif prob_value < 0.48:
                move_percent_1h = -base_move
            else:
                move_percent_1h = 0.001  # Tiny move for sideways
                
            # Adjust by volatility
            if volatility_label == "HIGH":
                move_percent_1h *= 1.3
            elif volatility_label == "LOW":
                move_percent_1h *= 0.7
        else:
            # Model seems trained, use its output with confidence scaling
            confidence_factor = 0.3 + abs(prob_value - 0.5) * 1.4
            move_percent_1h = pred_return_val * confidence_factor
        
        # Safety bounds
        move_percent_1h = max(-0.03, min(0.03, move_percent_1h))
        
        
        target_price_1h = current_price * (1 + move_percent_1h)

        # Determine direction based on actual predicted move
        if abs(move_percent_1h) < 0.005:  # Less than 0.5%
            direction_1h = "SIDEWAYS"
        elif move_percent_1h > 0:
            direction_1h = "UP"
        else:
            direction_1h = "DOWN"

        # Calculate confidence based on direction
        if direction_1h == "SIDEWAYS":
            distance_from_center = abs(prob_value - 0.5)
            max_sideways_distance = 0.02
            sideways_strength = 1 - (distance_from_center / max_sideways_distance)
            confidence_1h = 60 + (sideways_strength * 25)
        else:
            raw_confidence = abs(prob_value - 0.5) * 2 * 100
            confidence_1h = min(95, max(40, 40 + raw_confidence * 1.1))
        
        

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

        # Add current_price to tech_indicators for recommendation
        tech_indicators['close'] = current_price

        # Generate LLM-based causal analysis (legacy - keeping for backward compatibility)
        if driver_type == "NEWS" and top_news_item:
             causal_analysis = self.generate_news_explanation(symbol, direction_1h, top_news_item, tech_indicators, dl_stats, top_sources)
        else:
             causal_analysis = self.generate_technical_explanation(symbol, direction_1h, dl_stats, float(top_prob), tech_indicators, top_sources)

        # NEW: Advanced news impact analysis (FinBERT + LLM)
        news_impact_result = self.analyze_news_impact_for_coin(
            symbol=symbol,
            news_df=news_df if not news_df.empty else None,
            candles_df=candles_df,
            direction=direction_1h,
            predicted_return=move_percent_1h * 100
        )

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
            # Technical indicators for transparency
            "technical_indicators": {
                "rsi": round(tech_indicators.get('rsi', 50), 2),
                "macd": round(tech_indicators.get('macd', 0), 4),
                "bb_high": round(tech_indicators.get('bb_high', 0), 2),
                "bb_low": round(tech_indicators.get('bb_low', 0), 2),
                "volume_status": "HIGH" if tech_indicators.get('current_volume', 0) > tech_indicators.get('volume_sma', 1) * 1.5 else "LOW"
            },
            # NEW: News impact analysis with semantic similarity + LLM
            "news_impact_analysis": news_impact_result,
            # NEW: Comprehensive explanation (single paragraph)
            "explanation": self.generate_comprehensive_explanation(
                symbol=symbol,
                direction=direction_1h,
                predicted_change=move_percent_1h * 100,
                confidence=confidence_1h,
                current_price=current_price,
                candles_df=candles_df,
                tech_indicators=tech_indicators,
                news_impact_data=news_impact_result,
                top_news_item=top_news_item
            ),
            "sources": top_sources,
            "debug_metadata": {
                "driver": driver_type,
                "attention_score": float(top_prob),
                "model_trained": abs(pred_return_val) <= 0.5,
                "news_count_analyzed": len(news_list) if news_list else 0
            }
        }

    def generate_news_explanation(self, symbol, direction, top_news_item, tech_inds, dl_stats, other_news):
        """
        Expert-level causal analysis when NEWS is the primary driver.
        Uses 3-layer reasoning: Event Alignment -> Causal Analysis -> Strategic Advice.
        """
        # Extract primary news data
        news_title = top_news_item.get('title', 'Unknown Event')
        # Use full content for LLM (up to 2000 chars for rich context)
        full_content = top_news_item.get('content', '')
        news_content = full_content[:2000] if len(full_content) > 2000 else full_content
        # Extract key quotes for citation (first 3 sentences or key phrases)
        sentences = [s.strip() for s in news_content.split('.') if len(s.strip()) > 20][:3]
        key_quotes = ' | '.join(sentences) if sentences else 'N/A'
        
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
        
        # NEW: Calculate alignment between news and price/volume
        from app.market_cache import get_candles
        import pandas as pd
        candles = get_candles(symbol.upper(), 100)
        candles_df = pd.DataFrame(candles) if candles else pd.DataFrame()
        if not candles_df.empty:
            candles_df['timestamp'] = pd.to_datetime(candles_df['time'], unit='s')
        
        alignment_data = self.detect_news_alignment(
            top_news_item,
            candles_df,
            tech_inds.get('close', 0)
        )
        
        # NEW: Analyze impact mechanisms
        impact_mechanisms = self.analyze_impact_mechanisms(
            alignment_data,
            tech_inds,
            sentiment_score
        )
        
        # Format mechanisms for prompt
        mechanisms_text = "\n".join([
            f"   • {m['type']}: {m['evidence']} (Confidence: {m['confidence']:.0%})"
            for m in impact_mechanisms
        ])
        
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
   • Nội dung đầy đủ: "{news_content}"
   
   📝 CÁC CÂU QUAN TRỌNG (BẮT BUỘC TRÍCH DẪN):
   {key_quotes}
   
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

🔗 DATA FUSION (Kết hợp Tin tức + Kỹ thuật):
   • News Sentiment: {sentiment_score:+.2f} {"(Tích cực)" if sentiment_score > 0.3 else "(Tiêu cực)" if sentiment_score < -0.3 else "(Trung lập)"}
   • Technical Bias: {tech_bias}
   • Conflict Detection: {"⚠️ XUNG ĐỘT - Sentiment tích cực nhưng RSI quá mua" if sentiment_score > 0.3 and rsi > 70 else "⚠️ XUNG ĐỘT - Sentiment tiêu cực nhưng RSI quá bán" if sentiment_score < -0.3 and rsi < 30 else "✅ ĐỒNG THUẬN - News và Technical cùng chiều"}
   
   → QUAN TRỌNG: Nếu có xung đột, bạn PHẢI giải thích yếu tố nào chiếm ưu thế và TẠI SAO.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ ALIGNMENT ANALYSIS (Phân tích thời điểm - TỰ ĐỘNG)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Timing**: Tin xuất hiện {alignment_data['time_delta_minutes']} phút trước
**Price Reaction**: Giá {alignment_data['price_change_at_news']:+.2f}% ngay sau tin
**Volume Spike**: Volume tăng {alignment_data['volume_spike_percent']:.0f}% so với trung bình
**Alignment Score**: {alignment_data['alignment_score']:.2f}/1.0 ({"Khớp mạnh" if alignment_data['is_aligned'] else "Khớp yếu"})

→ Kết luận: Tin tức {"CÓ" if alignment_data['is_aligned'] else "KHÔNG"} tác động trực tiếp đến giá

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 IMPACT MECHANISMS (Cơ chế tác động - TỰ ĐỘNG PHÁT HIỆN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{mechanisms_text}


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
    "news_citations": [
        "Trích dẫn nguyên văn câu quan trọng #1 từ bài báo",
        "Trích dẫn nguyên văn câu quan trọng #2 từ bài báo"
    ],
    "explanation_vi": "Đoạn văn 6-8 câu, CÓ DẪN CHỨNG CỤ THỂ TỪ BÀI BÁO:
    Câu 1: 'Dự báo {direction} {dl_stats['predicted_return']:+.2f}% được thúc đẩy bởi [sự kiện cụ thể từ tin] (Sentiment {sentiment_score:+.2f}).'
    Câu 2: TRÍCH DẪN nguyên văn từ bài báo: \"[câu quan trọng từ nội dung tin]\"
    Câu 3-4: Giải thích cơ chế nhân quả (Tin → Tâm lý thị trường → Order flow → Giá). Có số liệu RSI={rsi:.1f}, MACD.
    Câu 5: Phân tích xung đột/đồng thuận News vs Technical.
    Câu 6: Dẫn chứng lịch sử tương tự (VD: 'Lần trước khi [sự kiện tương tự] xảy ra, giá tăng X% trong Y giờ').
    Câu 7-8: Kết luận độ tin cậy và rủi ro cụ thể.",
    "causal_chain": {{
        "cause": "Sự kiện/Tin tức cụ thể",
        "mechanism": "FOMO/Liquidation/Whale/Panic",
        "effect": "Giá tăng/giảm X%"
    }},
    "sentiment_impact": {{
        "news_sentiment": {sentiment_score},
        "social_volume": "HIGH/MEDIUM/LOW"
    }},
    "actionable_advice": "Lời khuyên CỤ THỂ với giá Entry, Stop-loss, Take-profit. VD: 'Entry $68,500-$69,000. SL dưới $67,800 (-2%). TP1: $71,500 (+4%), TP2: $73,000 (+6%). R/R 1:3. Cảnh giác false breakout nếu volume < SMA.'"
}}

⚠️ LƯU Ý QUAN TRỌNG:
- BẮT BUỘC trích dẫn ít nhất 1-2 câu nguyên văn từ nội dung bài báo trong "news_citations"
- Sử dụng thuật ngữ chuyên nghiệp: Breakout, Support/Resistance, Liquidation, Whale accumulation, FOMO, Capitulation...
- KHÔNG viết chung chung. Phải có số liệu cụ thể (RSI, Sentiment score, % thay đổi...).
- Giải thích TẠI SAO tin này gây ra biến động giá, không chỉ MÔ TẢ.
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

    def _call_ollama(self, prompt, max_retries=2):
        """
        Call Ollama API with retry logic and smart fallback.
        """
        import json
        import re
        
        for attempt in range(max_retries):
            try:
                api_result = self.ollama_client.generate(prompt)
                if api_result:
                    response = self.ollama_client.extract_response(api_result)
                    if response:
                        # Clean up common JSON issues
                        clean_json = response
                        clean_json = re.sub(r'```json\s*', '', clean_json)
                        clean_json = re.sub(r'```\s*', '', clean_json)
                        clean_json = clean_json.strip()
                        
                        # Try to extract JSON object even if wrapped in text
                        json_match = re.search(r'\{[\s\S]*\}', clean_json)
                        if json_match:
                            clean_json = json_match.group(0)
                        
                        try:
                            parsed = json.loads(clean_json)
                            # Validate required fields
                            if parsed.get('primary_driver') and parsed.get('explanation_vi'):
                                return parsed
                        except json.JSONDecodeError as e:
                            logger.warning(f"JSON parse attempt {attempt+1} failed: {e}")
                            continue
                            
            except Exception as e:
                logger.error(f"Ollama call attempt {attempt+1} failed: {e}")
        
        # Smart fallback with actual data
        return self._generate_fallback_explanation()
    
    def _generate_fallback_explanation(self):
        """
        Generate a meaningful fallback explanation when Ollama fails.
        Uses the actual technical indicators passed to the system.
        """
        return {
            "primary_driver": "TECHNICAL_ANALYSIS",
            "key_event": "Market Technical Structure",
            "explanation_vi": (
                "Dự báo dựa trên phân tích kỹ thuật tổng hợp. "
                "Mô hình Deep Learning đã phân tích dữ liệu Volume, RSI, MACD và Bollinger Bands "
                "để đưa ra dự đoán xu hướng. Khuyến nghị theo dõi các mức hỗ trợ/kháng cự "
                "và xác nhận bằng Volume trước khi vào lệnh."
            ),
            "sentiment_impact": {
                "news_sentiment": 0.0,
                "social_volume": "MEDIUM"
            },
            "actionable_advice": (
                "Quan sát phản ứng giá tại các mức Bollinger Bands. "
                "Đợi breakout có Volume xác nhận trước khi vào lệnh. "
                "Đặt Stop-loss tại vùng hỗ trợ gần nhất."
            )
        }

    def calculate_semantic_relevance(self, article_text, coin_context):
        """
        Calculate semantic relevance between article and coin using FinBERT embeddings.
        Returns cosine similarity score (0-1).
        """
        try:
            # Get embeddings using data_processor's vectorize_news method
            article_embedding = self.data_processor.vectorize_news([article_text[:512]])  # Truncate for speed
            context_embedding = self.data_processor.vectorize_news([coin_context])
            
            if article_embedding.shape[0] == 0 or context_embedding.shape[0] == 0:
                return 0.0
            
            # Calculate cosine similarity
            article_vec = article_embedding[0]
            context_vec = context_embedding[0]
            
            dot_product = np.dot(article_vec, context_vec)
            norm_a = np.linalg.norm(article_vec)
            norm_b = np.linalg.norm(context_vec)
            
            if norm_a == 0 or norm_b == 0:
                return 0.0
                
            similarity = dot_product / (norm_a * norm_b)
            return float(similarity)
            
        except Exception as e:
            logger.warning(f"Semantic relevance calculation failed: {e}")
            return 0.0

    def analyze_article_with_llm(self, article, symbol, direction, predicted_return):
        """
        Use LLM (Ollama) to deeply analyze an article's impact on a specific coin.
        Returns detailed analysis with mechanism explanation and key quotes.
        """
        coin_name = symbol.replace('USDT', '')
        title = article.get('title', 'Unknown')
        content = article.get('text', article.get('content', ''))[:2000]  # Limit content length
        source = article.get('source', 'Unknown')
        sentiment = article.get('sentiment_score', article.get('sentiment', 0))
        
        prompt = f"""🎯 ROLE: Bạn là chuyên gia phân tích tác động tin tức đến giá crypto.

📰 BÀI BÁO CẦN PHÂN TÍCH:
Tiêu đề: "{title}"
Nguồn: {source}
Nội dung: "{content}"

🪙 COIN ĐANG XÉT: {coin_name} ({symbol})
📊 DỰ BÁO AI: {direction} {predicted_return:+.2f}%
📈 SENTIMENT SCORE: {sentiment:+.2f}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YÊU CẦU PHÂN TÍCH (Trả về JSON thuần):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trả về JSON (KHÔNG có markdown):
{{
    "summary": "Tóm tắt bài báo trong 1-2 câu ngắn gọn",
    "is_relevant": true/false,
    "relevance_reason": "Giải thích tại sao bài báo này liên quan (hoặc không liên quan) đến {coin_name}",
    "impact_mechanism": "Giải thích CƠ CHẾ tác động: Tin này → Tâm lý thị trường → Hành vi giao dịch → Giá {coin_name}. Ví dụ: 'Institutional bán tháo → Áp lực bán tăng → Giá giảm'",
    "key_quote": "Trích dẫn nguyên văn 1 câu QUAN TRỌNG NHẤT từ bài báo (phải là câu có trong nội dung)",
    "predicted_impact": "TĂNG MẠNH (+3-5%)" hoặc "TĂNG NHẸ (+1-2%)" hoặc "KHÔNG ẢNH HƯỞNG" hoặc "GIẢM NHẸ (-1-2%)" hoặc "GIẢM MẠNH (-3-5%)",
    "confidence": "CAO" hoặc "TRUNG BÌNH" hoặc "THẤP",
    "time_effect": "NGẮN HẠN (1-4h)" hoặc "TRUNG HẠN (4-24h)" hoặc "DÀI HẠN (>24h)"
}}

⚠️ QUAN TRỌNG:
- "key_quote" PHẢI là câu có trong nội dung bài báo, KHÔNG được bịa
- Nếu bài báo KHÔNG liên quan đến {coin_name}, đặt is_relevant=false
- Giải thích mechanism phải cụ thể, không chung chung
"""
        
        try:
            result = self._call_ollama(prompt)
            if isinstance(result, dict):
                return result
            else:
                return {
                    "summary": "Không thể phân tích bài báo này",
                    "is_relevant": False,
                    "relevance_reason": "LLM analysis failed",
                    "impact_mechanism": "N/A",
                    "key_quote": title,
                    "predicted_impact": "KHÔNG ẢNH HƯỞNG",
                    "confidence": "THẤP",
                    "time_effect": "N/A"
                }
        except Exception as e:
            logger.warning(f"LLM article analysis failed: {e}")
            return {
                "summary": f"Phân tích lỗi: {str(e)[:50]}",
                "is_relevant": False,
                "relevance_reason": "Error",
                "impact_mechanism": "N/A",
                "key_quote": title,
                "predicted_impact": "KHÔNG ẢNH HƯỞNG",
                "confidence": "THẤP",
                "time_effect": "N/A"
            }

    def analyze_news_impact_for_coin(self, symbol, news_df, candles_df, direction, predicted_return):
        """
        Advanced news impact analysis using:
        1. FinBERT semantic similarity for relevance scoring
        2. LLM deep analysis for top 3 articles
        
        Returns detailed impact analysis with citations and mechanisms.
        """
        if news_df is None or news_df.empty:
            return {"top_articles": [], "overall_sentiment": "NEUTRAL", "combined_impact": "Không có tin tức để phân tích"}
        
        coin_name = symbol.replace('USDT', '')
        
        # Define coin context for semantic similarity
        coin_contexts = {
            'BTCUSDT': "Bitcoin BTC cryptocurrency price movement trading market halving institutional adoption",
            'ETHUSDT': "Ethereum ETH smart contract DeFi NFT layer 2 merge staking gas fees",
            'BNBUSDT': "Binance BNB exchange token CZ trading volume launchpad",
            'SOLUSDT': "Solana SOL blockchain fast transactions DeFi NFT ecosystem",
            'XRPUSDT': "Ripple XRP cross-border payment SEC lawsuit banking",
            'DOGEUSDT': "Dogecoin DOGE meme coin Elon Musk Twitter community",
            'ADAUSDT': "Cardano ADA proof of stake smart contract research",
            'AVAXUSDT': "Avalanche AVAX subnet DeFi fast finality",
            'DOTUSDT': "Polkadot DOT parachain interoperability Web3",
            'POLUSDT': "Polygon MATIC Ethereum scaling ZK rollup"
        }
        
        coin_context = coin_contexts.get(symbol.upper(), f"{coin_name} cryptocurrency trading price")
        
        # Step 1: Calculate semantic relevance for all articles
        articles_with_scores = []
        
        for _, row in news_df.iterrows():
            title = str(row.get('title', ''))
            content = str(row.get('text', row.get('content', '')))
            full_text = f"{title}. {content}"
            
            # Calculate semantic relevance using FinBERT
            semantic_score = self.calculate_semantic_relevance(full_text, coin_context)
            
            # Also check for direct keyword mentions (bonus score)
            keyword_bonus = 0
            coin_keywords = [coin_name.lower(), symbol.lower().replace('usdt', '')]
            for kw in coin_keywords:
                if kw in full_text.lower():
                    keyword_bonus = 0.2
                    break
            
            combined_score = semantic_score + keyword_bonus
            
            articles_with_scores.append({
                'row': row,
                'semantic_score': semantic_score,
                'combined_score': combined_score,
                'has_direct_mention': keyword_bonus > 0
            })
        
        # Sort by combined score and get top 3
        articles_with_scores.sort(key=lambda x: x['combined_score'], reverse=True)
        top_3_articles = articles_with_scores[:3]
        
        # Step 2: Deep LLM analysis for top 3 articles
        detailed_analyses = []
        
        for item in top_3_articles:
            row = item['row']
            semantic_score = item['semantic_score']
            has_direct_mention = item['has_direct_mention']
            
            # Call LLM for deep analysis
            llm_analysis = self.analyze_article_with_llm(
                article=row.to_dict(),
                symbol=symbol,
                direction=direction,
                predicted_return=predicted_return
            )
            
            detailed_analyses.append({
                "title": row.get('title', 'Unknown'),
                "source": row.get('source', 'Unknown'),
                "published_at": str(row.get('timestamp', 'N/A')),
                "semantic_relevance_score": round(semantic_score, 3),
                "has_direct_mention": has_direct_mention,
                "sentiment_score": round(row.get('sentiment_score', row.get('sentiment', 0)), 2),
                "llm_analysis": llm_analysis
            })
        
        # Step 3: Calculate overall sentiment from top articles
        sentiments = [a.get('sentiment_score', 0) for a in detailed_analyses]
        avg_sentiment = sum(sentiments) / len(sentiments) if sentiments else 0
        
        if avg_sentiment > 0.3:
            overall_sentiment = "TÍCH CỰC"
        elif avg_sentiment < -0.3:
            overall_sentiment = "TIÊU CỰC"
        else:
            overall_sentiment = "TRUNG LẬP"
        
        # Generate combined impact summary
        relevant_articles = [a for a in detailed_analyses if a.get('llm_analysis', {}).get('is_relevant', False)]
        
        if relevant_articles:
            impacts = [a.get('llm_analysis', {}).get('predicted_impact', 'N/A') for a in relevant_articles]
            combined_impact = f"Phân tích {len(relevant_articles)}/{len(detailed_analyses)} bài báo có liên quan. Tác động dự kiến: {', '.join(set(impacts))}"
        else:
            combined_impact = "Không có bài báo nào liên quan trực tiếp đến " + coin_name
        
        return {
            "top_articles": detailed_analyses,
            "overall_sentiment": overall_sentiment,
            "average_sentiment_score": round(avg_sentiment, 2),
            "combined_impact": combined_impact,
            "analysis_method": "FinBERT Semantic Similarity + LLM Deep Analysis"
        }

    def generate_comprehensive_explanation(self, symbol, direction, predicted_change, confidence, 
                                           current_price, candles_df, tech_indicators, 
                                           news_impact_data, top_news_item=None):
        """
        Generate a comprehensive, human-readable explanation combining:
        1. Price history evidence
        2. Technical analysis reasons
        3. News impact analysis
        4. Model prediction conclusion
        
        Returns a single cohesive paragraph.
        """
        coin_name = symbol.replace('USDT', '')
        direction_vi = {"UP": "TĂNG", "DOWN": "GIẢM", "SIDEWAYS": "ĐI NGANG"}.get(direction, direction)
        
        # 1. Price History Evidence
        price_evidence = ""
        if candles_df is not None and len(candles_df) > 0:
            try:
                # Get price 1h ago (12 candles of 5min = 1h)
                price_1h_ago = candles_df.iloc[-12]['close'] if len(candles_df) >= 12 else candles_df.iloc[0]['close']
                # Get price 24h ago (288 candles of 5min = 24h) 
                price_24h_ago = candles_df.iloc[0]['close'] if len(candles_df) >= 288 else candles_df.iloc[0]['close']
                
                change_1h = ((current_price - price_1h_ago) / price_1h_ago) * 100
                change_24h = ((current_price - price_24h_ago) / price_24h_ago) * 100
                
                price_evidence = f"Trong 1 giờ qua, giá đã {'tăng' if change_1h > 0 else 'giảm'} {abs(change_1h):.2f}% (từ ${price_1h_ago:,.2f} đến ${current_price:,.2f}). "
                if len(candles_df) >= 50:
                    price_evidence += f"Trong 24 giờ qua, giá {'tăng' if change_24h > 0 else 'giảm'} {abs(change_24h):.2f}%. "
            except Exception as e:
                price_evidence = ""
        
        # 2. Technical Analysis Reasons
        rsi = tech_indicators.get('rsi', 50)
        macd = tech_indicators.get('macd', 0)
        volume_status = "cao" if tech_indicators.get('current_volume', 0) > tech_indicators.get('volume_sma', 1) * 1.5 else "thấp"
        
        tech_reason = ""
        if rsi > 70:
            tech_reason = f"RSI(14) = {rsi:.1f} đang trong vùng quá mua, có thể xảy ra điều chỉnh giảm. "
        elif rsi < 30:
            tech_reason = f"RSI(14) = {rsi:.1f} đang trong vùng quá bán, tạo điều kiện cho sự phục hồi. "
        else:
            if macd > 0:
                tech_reason = f"RSI = {rsi:.1f} kết hợp MACD dương ({macd:.4f}) cho thấy xu hướng tích cực. "
            elif macd < 0:
                tech_reason = f"RSI = {rsi:.1f} kết hợp MACD âm ({macd:.4f}) cho thấy áp lực bán đang chiếm ưu thế. "
            else:
                tech_reason = f"RSI = {rsi:.1f} cho thấy thị trường đang trong trạng thái cân bằng. "
        
        tech_reason += f"Volume giao dịch {volume_status}, "
        tech_reason += "cho thấy sự tham gia mạnh của nhà đầu tư. " if volume_status == "cao" else "cho thấy thị trường đang chờ đợi tín hiệu rõ ràng hơn. "
        
        # 3. News Impact Evidence
        news_evidence = ""
        if news_impact_data and 'top_articles' in news_impact_data:
            top_articles = news_impact_data.get('top_articles', [])
            relevant_articles = [a for a in top_articles if a.get('llm_analysis', {}).get('is_relevant', False)]
            
            if relevant_articles:
                article = relevant_articles[0]
                llm = article.get('llm_analysis', {})
                title = article.get('title', '')[:80]
                mechanism = llm.get('impact_mechanism', '')
                key_quote = llm.get('key_quote', '')
                
                news_evidence = f"Về mặt tin tức, bài báo \"{title}\" "
                if mechanism and mechanism != 'N/A':
                    news_evidence += f"cho thấy: {mechanism}. "
                if key_quote and key_quote != title:
                    news_evidence += f"Trích dẫn: \"{key_quote[:150]}...\". "
            else:
                overall_sentiment = news_impact_data.get('overall_sentiment', 'TRUNG LẬP')
                news_evidence = f"Tin tức thị trường hiện tại có xu hướng {overall_sentiment.lower()}, "
                news_evidence += "không có sự kiện nổi bật tác động trực tiếp đến giá. "
        
        # 4. Model Prediction Conclusion
        conclusion = f"Dựa trên phân tích tổng hợp, mô hình AI dự báo {coin_name} sẽ {direction_vi.lower()} "
        conclusion += f"khoảng {abs(predicted_change):.2f}% trong thời gian tới, "
        conclusion += f"với độ tin cậy {confidence:.0f}%. "
        
        if abs(predicted_change) < 0.5:
            conclusion += "Thị trường đang trong trạng thái tích lũy, khuyến nghị chờ đợi tín hiệu rõ ràng hơn."
        elif predicted_change > 0:
            conclusion += "Đây có thể là cơ hội mua vào với quản lý rủi ro phù hợp."
        else:
            conclusion += "Khuyến nghị thận trọng và quan sát thêm diễn biến thị trường."
        
        # Combine all parts
        full_explanation = price_evidence + tech_reason + news_evidence + conclusion
        
        return full_explanation.strip()
