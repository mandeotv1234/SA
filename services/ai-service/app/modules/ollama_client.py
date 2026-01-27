import os
import requests
import json
import time
from typing import Optional

class OllamaClient:
    def __init__(self):
        self.api_url = os.getenv('OLLAMA_API_URL', 'https://0b15afd4e8d1.ngrok-free.app')
        self.model = os.getenv('OLLAMA_MODEL', 'llama3.2')
        self.generate_endpoint = f"{self.api_url}/api/generate"
        
    def generate(self, prompt: str, stream: bool = False) -> Optional[dict]:
        """
        Generate response from Ollama model
        
        Args:
            prompt: The prompt to send to the model
            stream: Whether to stream the response (default: False)
            
        Returns:
            dict: Response from Ollama API or None if error
        """
        try:
            payload = {
                "model": self.model,
                "prompt": prompt,
                "stream": stream,
                "format": "json"  # Force JSON mode
            }
            
            response = requests.post(
                self.generate_endpoint,
                json=payload,
                timeout=120  # 2 minutes timeout
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Ollama API error: {response.status_code} - {response.text}")
                return None
                
        except requests.exceptions.Timeout:
            print("Ollama API request timed out")
            return None
        except Exception as e:
            print(f"Error calling Ollama API: {str(e)}")
            return None
    
    def extract_response(self, result: dict) -> str:
        """
        Extract the response text from Ollama API result
        
        Args:
            result: The result dict from generate()
            
        Returns:
            str: The response text or empty string if error
        """
        if result and 'response' in result:
            return result['response']
        return ""
    
    def generate_market_prediction(self, news_summaries: list, symbols: list = None) -> dict:
        """
        Generate market prediction based on aggregated news
        
        Args:
            news_summaries: List of news articles with title, content, sentiment
            symbols: List of trading symbols to predict
            
        Returns:
            dict: Prediction results with market sentiment and individual predictions
        """
        if symbols is None:
            symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]
        
        if not news_summaries:
            return {"error": "no_news", "predictions": []}
        
        # Build news summary (using filtered list)
        news_text = ""
        count = 0
        for news in news_summaries:
            title = news.get("title", "")
            if "Google News" in title: continue # Extra safety
            
            sentiment = news.get("sentiment", "Neutral")
            content = news.get("content", "")[:400] # Increase context slightly
            count += 1
            news_text += f"{count}. [{sentiment}] {title}\n   {content}\n\n"
            if count >= 35: break
        
        prompt = f"""Bạn là Chuyên gia Phân tích Tài chính Crypto. Phân tích {count} tin tức sau và dự đoán giá 24h tới cho TẤT CẢ 10 đồng coin.

TIN TỨC:
{news_text}

YÊU CẦU BẮT BUỘC:
1. Phải dự đoán đầy đủ cho 10 coins: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, DOTUSDT, POLUSDT
2. Mỗi coin cần có:
   - direction: "UP" hoặc "DOWN" hoặc "NEUTRAL"
   - change_percent: số thực (ví dụ: 2.5 hoặc -1.8)
   - confidence: số từ 0.0-1.0
   - reason: Lý do CHI TIẾT bằng tiếng Việt (trích dẫn tin tức cụ thể)
   - causal_factor: Nguyên nhân chính (ví dụ: "Fed giữ lãi suất", "ETF Bitcoin được duyệt")
3. Nếu không có tin về coin nào, để NEUTRAL với reason "Không có tin tức liên quan"

TRẢ VỀ JSON (KHÔNG KÈM TEXT):
{{
  "analysis_summary": "Tóm tắt 2-3 câu về thị trường chung",
  "market_sentiment": "BULLISH hoặc BEARISH hoặc NEUTRAL",
  "predictions": [
    {{"symbol": "BTCUSDT", "direction": "UP", "change_percent": 1.2, "confidence": 0.75, "reason": "Lý do cụ thể từ tin X", "causal_factor": "Sự kiện Y"}},
    {{"symbol": "ETHUSDT", "direction": "DOWN", "change_percent": -0.8, "confidence": 0.6, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "BNBUSDT", "direction": "NEUTRAL", "change_percent": 0.0, "confidence": 0.5, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "SOLUSDT", "direction": "...", "change_percent": 0.0, "confidence": 0.0, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "XRPUSDT", "direction": "...", "change_percent": 0.0, "confidence": 0.0, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "DOGEUSDT", "direction": "...", "change_percent": 0.0, "confidence": 0.0, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "ADAUSDT", "direction": "...", "change_percent": 0.0, "confidence": 0.0, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "AVAXUSDT", "direction": "...", "change_percent": 0.0, "confidence": 0.0, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "DOTUSDT", "direction": "...", "change_percent": 0.0, "confidence": 0.0, "reason": "...", "causal_factor": "..."}},
    {{"symbol": "POLUSDT", "direction": "...", "change_percent": 0.0, "confidence": 0.0, "reason": "...", "causal_factor": "..."}}
  ],
  "key_factors": ["Yếu tố 1", "Yếu tố 2"],
  "risks": ["Rủi ro 1"]
}}

QUAN TRỌNG: Phải có đủ 10 predictions, không được thiếu!"""

        result = self.generate(prompt)
        if result:
            response_text = self.extract_response(result)
            
            # Debug: log response length
            print(f"[OLLAMA] Response length: {len(response_text)} chars")
            
            try:
                import re
                # Extract JSON from response - try to find complete object
                json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                if json_match:
                    json_str = json_match.group()
                    parsed = json.loads(json_str)
                    
                    # Validate predictions structure
                    if "predictions" in parsed:
                        valid_preds = []
                        for pred in parsed["predictions"]:
                            if isinstance(pred, dict) and "symbol" in pred:
                                valid_preds.append(pred)
                            else:
                                print(f"[WARNING] Skipping invalid prediction: {pred}")
                        parsed["predictions"] = valid_preds
                        print(f"[OLLAMA] Validated {len(valid_preds)} predictions")
                    
                    # Add metadata
                    parsed["timestamp"] = time.time()
                    parsed["news_count"] = count
                    parsed["model"] = self.model
                    return parsed
                else:
                    print(f"[ERROR] No JSON found in response")
                    print(f"Response preview: {response_text[:500]}")
            except json.JSONDecodeError as e:
                print(f"[ERROR] Failed to parse JSON: {e}")
                print(f"Response preview: {response_text[:500]}")
        else:
            print(f"[ERROR] No result from Ollama API")
        
        return {"error": "prediction_failed", "predictions": []}
