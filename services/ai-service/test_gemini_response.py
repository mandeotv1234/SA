"""
Test Gemini API response to debug JSON parsing issues
"""
import os
import sys
import json
from pathlib import Path

# Load .env file
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

# Add app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.modules.gemini_client import GeminiClient

def test_gemini_response():
    print("=" * 80)
    print("GEMINI API RESPONSE TEST")
    print("=" * 80)
    
    # Initialize client
    client = GeminiClient()
    print(f"✓ Initialized Gemini client with model: {client.model}")
    print(f"✓ API URL: {client.api_url}")
    
    # Create a simple test prompt (similar to what inference.py sends)
    test_prompt = """
🎯 ROLE: Bạn là Senior Crypto Market Analyst với 10 năm kinh nghiệm.

📊 NHIỆM VỤ: Phân tích nhân quả cho dự báo giá BTCUSDT.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 DỮ LIỆU ĐẦU VÀO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔮 KẾT QUẢ DỰ BÁO:
   • Xu hướng: UP
   • Mục tiêu giá: +0.41%
   • Xác suất: 0.582
   • Độ tin cậy: 87.8%

📰 TIN TỨC CHÍNH:
   • Tiêu đề: "Bitcoin Crash Spells Trouble For Strategy"
   • Nội dung: "Bitcoin price dropped below $80,000..."

📊 CHỈ SỐ KỸ THUẬT:
   • RSI(14): 45.2
   • MACD: -0.0012
   • Bollinger Bands: [78500 - 81200]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YÊU CẦU ĐẦU RA (JSON FORMAT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trả về JSON thuần (KHÔNG có markdown ```json):
{
    "primary_driver": "NEWS_CATALYST",
    "key_event": "Tóm tắt sự kiện chính",
    "news_citations": [
        "Trích dẫn câu 1",
        "Trích dẫn câu 2"
    ],
    "explanation_vi": "Giải thích chi tiết 6-8 câu...",
    "causal_chain": {
        "cause": "Sự kiện cụ thể",
        "mechanism": "FOMO/Liquidation/Whale/Panic",
        "effect": "Giá tăng/giảm X%"
    },
    "sentiment_impact": {
        "news_sentiment": 0.5,
        "social_volume": "HIGH"
    },
    "actionable_advice": "Lời khuyên giao dịch cụ thể..."
}

⚠️ QUAN TRỌNG:
- BẮT BUỘC có đủ các field: primary_driver, explanation_vi
- Trả về JSON thuần, KHÔNG có markdown
"""

    print("\n" + "=" * 80)
    print("SENDING REQUEST TO GEMINI")
    print("=" * 80)
    
    # Call Gemini API
    result = client.generate(test_prompt, temperature=0.7, max_tokens=4096)
    
    if not result:
        print("❌ No result from Gemini API")
        return
    
    print(f"\n✓ Got response from Gemini")
    print(f"Response keys: {list(result.keys())}")
    
    # Extract response
    response_text = client.extract_response(result)
    
    print("\n" + "=" * 80)
    print("RAW RESPONSE TEXT")
    print("=" * 80)
    print(response_text)
    print("=" * 80)
    print(f"Length: {len(response_text)} chars")
    print("=" * 80)
    
    # Try to parse JSON
    print("\n" + "=" * 80)
    print("JSON PARSING TEST")
    print("=" * 80)
    
    import re
    
    # Clean up
    clean_json = response_text.strip()
    clean_json = re.sub(r'```json\s*', '', clean_json)
    clean_json = re.sub(r'```\s*', '', clean_json)
    
    # Extract JSON
    json_match = re.search(r'\{[\s\S]*\}', clean_json)
    if json_match:
        clean_json = json_match.group(0)
        print(f"✓ Extracted JSON block ({len(clean_json)} chars)")
    else:
        print("❌ No JSON block found")
        return
    
    # Try to parse
    try:
        parsed = json.loads(clean_json)
        print("✓ Successfully parsed JSON!")
        print(f"\nParsed keys: {list(parsed.keys())}")
        
        # Check required fields
        has_primary_driver = 'primary_driver' in parsed
        has_explanation = 'explanation_vi' in parsed
        
        print(f"\nRequired fields check:")
        print(f"  - primary_driver: {'✓' if has_primary_driver else '❌'}")
        print(f"  - explanation_vi: {'✓' if has_explanation else '❌'}")
        
        if has_primary_driver and has_explanation:
            print("\n✅ ALL REQUIRED FIELDS PRESENT!")
            print(f"\nParsed JSON (pretty):")
            print(json.dumps(parsed, indent=2, ensure_ascii=False))
        else:
            print("\n❌ MISSING REQUIRED FIELDS!")
            print(f"\nActual JSON structure:")
            print(json.dumps(parsed, indent=2, ensure_ascii=False))
            
    except json.JSONDecodeError as e:
        print(f"❌ JSON parsing failed: {e}")
        print(f"\nProblematic JSON preview (first 500 chars):")
        print(clean_json[:500])
        print("\n...")
        print(f"\nLast 200 chars:")
        print(clean_json[-200:])

if __name__ == '__main__':
    test_gemini_response()
