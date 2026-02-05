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
        
        self.model = os.getenv('GEMINI_MODEL', 'gemma-3-1b-it')
        self.api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        
        # Debug logging
        print(f"[GEMINI-INIT] Model: {self.model}")
        print(f"[GEMINI-INIT] API Key: {self.api_key[:20]}...{self.api_key[-4:]}")
        print(f"[GEMINI-INIT] API URL: {self.api_url}")
        
    def generate(self, prompt: str, temperature: float = 0.7, max_tokens: int = 2048, max_retries: int = 3) -> Optional[dict]:
        """
        Generate response from Gemini model with automatic rate limit handling
        
        Args:
            prompt: The prompt to send to the model
            temperature: Sampling temperature (0.0 to 1.0)
            max_tokens: Maximum tokens to generate
            max_retries: Maximum number of retries on rate limit (429)
            
        Returns:
            dict: Response from Gemini API or None if error
        """
        import re
        
        for attempt in range(max_retries):
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
                    timeout=60  # Increased timeout
                )
                
                if response.status_code == 200:
                    return response.json()
                    
                elif response.status_code == 429:
                    # Rate limit - parse retry delay from response
                    try:
                        error_data = response.json()
                        retry_delay = 30  # Default 30 seconds
                        
                        # Try to extract retryDelay from response
                        details = error_data.get('error', {}).get('details', [])
                        for detail in details:
                            if detail.get('@type', '').endswith('RetryInfo'):
                                delay_str = detail.get('retryDelay', '30s')
                                # Parse "24.123864863s" format
                                match = re.search(r'([\d.]+)s', delay_str)
                                if match:
                                    retry_delay = float(match.group(1))
                                break
                        
                        if attempt < max_retries - 1:
                            wait_time = min(retry_delay + 5, 60)  # Add 5s buffer, max 60s
                            print(f"[GEMINI] Rate limit hit. Waiting {wait_time:.1f}s before retry {attempt+2}/{max_retries}...")
                            time.sleep(wait_time)
                            continue
                        else:
                            print(f"[GEMINI] Rate limit exceeded after {max_retries} retries")
                            return None
                            
                    except Exception as e:
                        print(f"[GEMINI] Error parsing rate limit response: {e}")
                        if attempt < max_retries - 1:
                            time.sleep(30)
                            continue
                        return None
                else:
                    print(f"Gemini API error: {response.status_code} - {response.text[:500]}")
                    return None
                    
            except requests.exceptions.Timeout:
                print(f"Gemini API request timed out (attempt {attempt+1}/{max_retries})")
                if attempt < max_retries - 1:
                    time.sleep(5)
                    continue
                return None
            except Exception as e:
                print(f"Error calling Gemini API: {str(e)}")
                return None
        
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
    

