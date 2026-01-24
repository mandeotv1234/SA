
import logging
import math
from app.modules.news_aggregator import get_last_result
from app.modules.ollama_client import OllamaClient

logger = logging.getLogger(__name__)
ollama = OllamaClient()

def analyze_investment(payload: dict):
    """
    Analyze a specific investment request and return advice + calculations.
    payload: {
        "symbol": "BTCUSDT",
        "amount": 1000.0,
        "buy_price": 90000.0,
        "target_sell_time": "ISO_STRING",
        "current_time": "ISO_STRING"
    }
    """
    try:
        symbol = payload.get("symbol")
        amount = float(payload.get("amount", 0))
        buy_price = float(payload.get("buy_price", 0))
        
        # Calculate duration in minutes
        from datetime import datetime
        target_time = datetime.fromisoformat(payload.get("target_sell_time").replace('Z', '+00:00'))
        current_time = datetime.fromisoformat(payload.get("current_time").replace('Z', '+00:00'))
        
        duration_minutes = (target_time - current_time).total_seconds() / 60
        if duration_minutes <= 0:
            duration_minutes = 1 # Minimum 1 minute
            
        # Try to get prediction from payload first (Stateless)
        pred = payload.get('market_prediction')
        
        # If not in payload, try local cache
        if not pred:
            prediction_data = get_last_result()
            if prediction_data and 'predictions' in prediction_data:
                pred = next((p for p in prediction_data['predictions'] if p['symbol'] == symbol), None)
        
        if not pred:
            return {
                "advice": f"⚠️ Không có dữ liệu dự báo cho {symbol} (AI Cache Empty).",
                "predicted_price": buy_price,
                "predicted_profit_usdt": 0,
                "predicted_profit_percent": 0
            }
            
        # Extract forecast data
        # Structure: forecast.next_1h.expected_price, etc.
        # Note: The structure from Kafka message vs Inference output might differ slightly.
        # User JSON shows: pred['forecast']['next_1h']['expected_price']
        
        forecast = pred.get('forecast', {})
        next_1h = forecast.get('next_1h', {})
        next_24h = forecast.get('next_24h', {})
        
        # Interpolate Price
        # Start: buy_price (at T=0)
        # End 1h: next_1h['expected_price'] (at T=60)
        # End 24h: average of next_24h['expected_range'] (at T=1440)
        
        price_1h = next_1h.get('expected_price', buy_price)
        
        # Calculate expected price at target duration (Linear interpolation for simplicity)
        if duration_minutes <= 60:
            # Interpolate between buy_price and price_1h
            slope = (price_1h - buy_price) / 60
            predicted_price = buy_price + (slope * duration_minutes)
        else:
            # Interpolate between price_1h and price_24h
            range_24h = next_24h.get('expected_range', {})
            price_24h = (range_24h.get('low', buy_price) + range_24h.get('high', buy_price)) / 2
            
            slope = (price_24h - price_1h) / (1440 - 60)
            predicted_price = price_1h + (slope * (duration_minutes - 60))
            
        predicted_profit_usdt = (amount / buy_price) * (predicted_price - buy_price)
        predicted_profit_percent = ((predicted_price - buy_price) / buy_price) * 100
        
        # Generate Advice via Ollama
        direction = next_1h.get('direction', 'NEUTRAL')
        confidence = next_1h.get('confidence', 0)
        
        prompt = f"""
        Bạn là cố vấn đầu tư Crypto chuyên nghiệp (AI). Hãy viết một đoạn lời khuyên ngắn gọn (tối đa 3 câu) bằng Tiếng Việt.
        
        Thông tin giao dịch:
        - Coin: {symbol}
        - Vốn: {amount}$
        - Thời gian giữ lệnh: {int(duration_minutes)} phút
        - Dự báo AI: Xu hướng {direction} (Tin cậy {confidence}%)
        - Dự tính lợi nhuận: {predicted_profit_percent:.2f}% ({predicted_profit_usdt:.2f}$)
        
        Yêu cầu QUAN TRỌNG:
        - CHỈ TRẢ VỀ VĂN BẢN (PLAIN TEXT).
        - KHÔNG dùng định dạng JSON.
        - KHÔNG dùng Markdown header.
        - Tập trung vào rủi ro và lời khuyên hành động (Mua/Bán/Chờ).
        """
        
        try:
            ollama_res = ollama.generate(prompt)
            advice = ollama.extract_response(ollama_res)
            # Remove markdown if any
            advice = advice.replace('```', '').strip()
        except Exception:
            advice = f"Dự báo xu hướng {direction}. Lợi nhuận ước tính {predicted_profit_percent:.2f}%."

        return {
            "advice": advice,
            "predicted_price": predicted_price,
            "predicted_profit_usdt": predicted_profit_usdt,
            "predicted_profit_percent": predicted_profit_percent,
            "details": {
                "direction": direction,
                "confidence": confidence
            }
        }
        
    except Exception as e:
        logger.error(f"Investment analysis failed: {e}")
        return {
            "error": str(e),
            "advice": "Lỗi phân tích.",
            "predicted_price": 0,
            "predicted_profit_usdt": 0
        }
