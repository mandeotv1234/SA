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
                "stream": stream
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
        
        # Build news summary
        news_text = ""
        for i, news in enumerate(news_summaries[:20], 1):  # Limit to 20 articles
            title = news.get("title", "")
            sentiment = news.get("sentiment", "Neutral")
            content = news.get("content", "")[:300]
            news_text += f"{i}. [{sentiment}] {title}\n   {content}\n\n"
        
        prompt = f"""You are a senior crypto market analyst. Analyze these {len(news_summaries)} news articles and predict short-term (24h) price movements for: {', '.join(symbols)}.

NEWS:
{news_text}

Provide predictions in JSON format:
{{
    "analysis_summary": "Brief market overview (2-3 sentences)",
    "market_sentiment": "BULLISH|BEARISH|NEUTRAL",
    "predictions": [
        {{
            "symbol": "BTCUSDT",
            "direction": "UP|DOWN|NEUTRAL",
            "change_percent": 2.5,
            "confidence": 0.75,
            "reason": "Brief explanation"
        }}
    ],
    "key_factors": ["factor 1", "factor 2"],
    "risks": ["risk 1", "risk 2"]
}}

IMPORTANT: Return ONLY valid JSON, no markdown or extra text."""

        result = self.generate(prompt)
        if result:
            response_text = self.extract_response(result)
            try:
                import re
                # Extract JSON from response
                json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                if json_match:
                    parsed = json.loads(json_match.group())
                    # Add metadata
                    parsed["timestamp"] = time.time()
                    parsed["news_count"] = len(news_summaries)
                    parsed["model"] = self.model
                    return parsed
            except json.JSONDecodeError as e:
                print(f"Failed to parse JSON from Ollama response: {e}")
                print(f"Response: {response_text[:500]}")
        
        return {"error": "prediction_failed", "predictions": []}
