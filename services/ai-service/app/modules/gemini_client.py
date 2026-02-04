import os
import requests
import json
import time
from typing import Optional

class GeminiClient:
    """Client for Google Gemini API to replace Ollama."""
    
    def __init__(self):
        self.api_key = os.getenv('GEMINI_API_KEY', '')
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")
        
        self.model = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash-lite')
        self.api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        
        # Debug logging
        print(f"[GEMINI-INIT] Model: {self.model}")
        print(f"[GEMINI-INIT] API Key: {self.api_key[:20]}...{self.api_key[-4:]}")
        print(f"[GEMINI-INIT] API URL: {self.api_url}")
        
    def generate(self, prompt: str, temperature: float = 0.7, max_tokens: int = 2048) -> Optional[dict]:
        """
        Generate response from Gemini model
        
        Args:
            prompt: The prompt to send to the model
            temperature: Sampling temperature (0.0 to 1.0)
            max_tokens: Maximum tokens to generate
            
        Returns:
            dict: Response from Gemini API or None if error
        """
        try:
            payload = {
                "contents": [{
                    "parts": [{
                        "text": prompt
                    }]
                }],
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_tokens,
                    "topP": 0.95,
                    "topK": 40
                }
            }
            
            headers = {
                "Content-Type": "application/json"
            }
            
            response = requests.post(
                f"{self.api_url}?key={self.api_key}",
                json=payload,
                headers=headers,
                timeout=30  # 30 seconds timeout
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Gemini API error: {response.status_code} - {response.text}")
                return None
                
        except requests.exceptions.Timeout:
            print("Gemini API request timed out")
            return None
        except Exception as e:
            print(f"Error calling Gemini API: {str(e)}")
            return None
    
    def extract_response(self, result: dict) -> str:
        """
        Extract the response text from Gemini API result
        
        Args:
            result: The result dict from generate()
            
        Returns:
            str: The response text or empty string if error
        """
        try:
            if result and 'candidates' in result:
                if len(result['candidates']) > 0:
                    candidate = result['candidates'][0]
                    
                    # Check finish_reason for debugging
                    finish_reason = candidate.get('finishReason', 'UNKNOWN')
                    print(f"[GEMINI-DEBUG] Finish reason: {finish_reason}")
                    
                    if 'content' in candidate and 'parts' in candidate['content']:
                        parts = candidate['content']['parts']
                        if len(parts) > 0 and 'text' in parts[0]:
                            text = parts[0]['text']
                            print(f"[GEMINI-DEBUG] Extracted text length: {len(text)} chars")
                            return text
            
            print(f"[GEMINI-DEBUG] Failed to extract. Result keys: {result.keys() if result else 'None'}")
            return ""
        except Exception as e:
            print(f"Error extracting Gemini response: {e}")
            return ""
    

