"""
Test script for Gemini API response quality.
Run: python test_gemini.py
"""

import os
import requests
import json

# Get API key from environment or use directly
API_KEY = os.getenv('GEMINI_API_KEY', '')
if not API_KEY:
    print("⚠️  GEMINI_API_KEY not found in environment!")
    print("Please set it: export GEMINI_API_KEY=your_key_here")
    exit(1)

# Models to test
MODELS_TO_TEST = [
    "gemma-3-1b-it",       # Current (lightweight, may struggle with JSON)
    "gemini-2.0-flash",    # Fast, good quality
    "gemini-1.5-flash",    # Previous gen, reliable
    "gemini-2.0-flash-lite", # Lite version
]

# Sample prompt (SIMPLIFIED - same as ai-service uses now)
TEST_PROMPT = """BẠN LÀ CHUYÊN GIA PHÂN TÍCH CRYPTO. TRẢ LỜI HOÀN TOÀN BẰNG TIẾNG VIỆT.

DỮ LIỆU ĐẦU VÀO:
- Coin: BTCUSDT
- Giá hiện tại: $76,624.58
- Dự báo: UP +1.68%
- Độ tin cậy: 72.5%
- RSI: 58.23 (Trung lập)
- MACD: 0.0023 (Tích cực)
- Bollinger: $75,200.00 - $78,050.00

📰 TIN TỨC THỊ TRƯỜNG (Top 3 theo Attention Score):

   1. "Why Bitcoin's $76,000 Level Matters for Strategy's Q4 Earnings"
      • Nguồn: beincrypto.com
      • Sentiment: -0.9 | Attention: 0.525

   2. "'Sell Gold, Buy Bitcoin': Cathie Wood Makes The Rotation Call"
      • Nguồn: newsbtc.com
      • Sentiment: +0.25 | Attention: 0.514

   3. "ETF tiền điện tử 3/2: Bitcoin bị rút 272 triệu USD"
      • Nguồn: coinphoton.com
      • Sentiment: +0.07 | Attention: 0.464

NHIỆM VỤ: Viết giải thích BẰNG TIẾNG VIỆT kết hợp:
1. Phân tích kỹ thuật: RSI, MACD, Bollinger Bands cho thấy gì?
2. Tác động tin tức: Các tin trên ảnh hưởng thế nào đến giá?
3. Kết luận: Tại sao giá sẽ up +1.68%?

TRẢ VỀ JSON (KHÔNG CÓ MARKDOWN):
{
    "primary_driver": "TECHNICAL_CATALYST",
    "key_event": "Sự kiện/pattern chính bằng tiếng Việt",
    "news_citations": ["Trích dẫn tin tức quan trọng"],
    "explanation_vi": "Viết 4-6 câu tiếng Việt. Câu 1: Dự báo giá BTCUSDT sẽ up khoảng +1.68%. Câu 2: Phân tích RSI=58.2 và MACD=0.0023 cho thấy gì. Câu 3: Tác động từ tin tức (Cathie Wood kêu gọi mua Bitcoin hỗ trợ tâm lý tích cực). Câu 4: Kết luận và rủi ro.",
    "causal_chain": {
        "cause": "Nguyên nhân chính bằng tiếng Việt",
        "mechanism": "Cơ chế tác động bằng tiếng Việt",
        "effect": "Kết quả: giá up +1.68%"
    },
    "sentiment_impact": {
        "news_sentiment": 0.25,
        "social_volume": "LOW"
    },
    "actionable_advice": "Entry: $76,624. Stop-loss: $74,326. Take-profit: $77,912."
}

⚠️ BẮT BUỘC:
- explanation_vi PHẢI BẰNG TIẾNG VIỆT 100%
- PHẢI kết hợp phân tích KỸ THUẬT + TIN TỨC
- KHÔNG dùng tiếng Anh trong explanation_vi
"""

def test_model(model_name):
    """Test a specific Gemini model."""
    print(f"\n{'='*60}")
    print(f"🧪 Testing Model: {model_name}")
    print(f"{'='*60}")
    
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    
    payload = {
        "contents": [{
            "parts": [{
                "text": TEST_PROMPT
            }]
        }],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2048,
            "topP": 0.95,
            "topK": 40
        }
    }
    
    try:
        response = requests.post(
            f"{api_url}?key={API_KEY}",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            
            # Extract text
            if result.get('candidates'):
                candidate = result['candidates'][0]
                finish_reason = candidate.get('finishReason', 'UNKNOWN')
                
                if 'content' in candidate and 'parts' in candidate['content']:
                    text = candidate['content']['parts'][0].get('text', '')
                    
                    print(f"✅ Status: 200 OK")
                    print(f"📝 Finish Reason: {finish_reason}")
                    print(f"📏 Response Length: {len(text)} chars")
                    print(f"\n📄 Raw Response:\n{'-'*40}")
                    print(text[:1500] + "..." if len(text) > 1500 else text)
                    print(f"{'-'*40}")
                    
                    # Try to parse JSON
                    try:
                        # Clean markdown if present
                        clean_text = text.strip()
                        if clean_text.startswith('```'):
                            clean_text = clean_text.split('```')[1]
                            if clean_text.startswith('json'):
                                clean_text = clean_text[4:]
                        
                        parsed = json.loads(clean_text)
                        
                        print(f"\n✅ JSON Parse: SUCCESS")
                        print(f"   • primary_driver: {parsed.get('primary_driver', '❌ MISSING')}")
                        print(f"   • explanation_vi: {'✅ Present' if parsed.get('explanation_vi') else '❌ MISSING'}")
                        print(f"   • key_event: {'✅ Present' if parsed.get('key_event') else '❌ MISSING'}")
                        print(f"   • actionable_advice: {'✅ Present' if parsed.get('actionable_advice') else '❌ MISSING'}")
                        
                        if parsed.get('primary_driver') and parsed.get('explanation_vi'):
                            print(f"\n🎉 Model {model_name} PASSED!")
                            return True
                        else:
                            print(f"\n⚠️  Model {model_name} returned partial JSON")
                            return False
                            
                    except json.JSONDecodeError as e:
                        print(f"\n❌ JSON Parse: FAILED - {e}")
                        return False
                else:
                    print(f"❌ No content in response")
                    return False
            else:
                print(f"❌ No candidates in response")
                print(f"Response: {result}")
                return False
                
        else:
            print(f"❌ API Error: {response.status_code}")
            print(f"Response: {response.text[:500]}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"❌ Request timed out")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def main():
    print("="*60)
    print("🔬 GEMINI MODEL COMPARISON TEST")
    print("="*60)
    print(f"API Key: {API_KEY[:15]}...{API_KEY[-4:]}")
    
    results = {}
    
    for model in MODELS_TO_TEST:
        passed = test_model(model)
        results[model] = passed
    
    # Summary
    print("\n" + "="*60)
    print("📊 SUMMARY")
    print("="*60)
    
    for model, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"  {model}: {status}")
    
    # Recommendation
    passed_models = [m for m, p in results.items() if p]
    if passed_models:
        print(f"\n💡 Recommended Model: {passed_models[0]}")
    else:
        print(f"\n⚠️  No models passed. Consider using a more capable model or simplifying the prompt.")


if __name__ == "__main__":
    main()
