# QUY TRÌNH DỰ ĐOÁN GIÁ TRONG AI-SERVICE

## 📊 TỔNG QUAN

AI-service sử dụng **Deep Learning Model** (AdvancedDualStreamNetwork) để dự đoán giá, sau đó dùng **Gemini API** để tạo explanation bằng tiếng Việt.

---

## 🔮 BƯỚC 1: DỰ ĐOÁN TỪ DEEP LEARNING MODEL

### Input vào model:
```python
# 1. Price data (60 timesteps × 11 features)
X_price = [OHLCV + RSI + MACD + BB_high + BB_low + SMA_20 + EMA_12]

# 2. News embeddings (60 timesteps × 768 features)
X_news = FinBERT embeddings của tin tức được align với từng nến

# 3. Coin identifier
coin_idx = 0-9 (BTCUSDT=0, ETHUSDT=1, ...)
```

### Output từ model:
```python
{
    "direction_1h_logit": 0.330659,      # Raw logit từ model
    "direction_24h_logit": -0.123,       # Logit cho 24h
    "volatility_logit": 0.3097,          # Dự đoán volatility
    "attention_weights": [60 values]     # Attention cho từng timestep
}
```

---

## 🧮 BƯỚC 2: POST-PROCESSING DỰ ĐOÁN

### 2.1. Chuyển đổi Logit → Probability
```python
prob_value = sigmoid(direction_1h_logit)  # 0.330659 → 0.582 (58.2%)
```

### 2.2. Tính toán % thay đổi giá 1H
```python
# Nếu model chưa train tốt (|predicted_return| > 0.5%):
if abs(pred_return_val) > 0.005:
    # Fallback: dùng heuristic dựa trên probability
    move_percent_1h = (prob_value - 0.5) * 0.04  # ±2% max
    
    # Điều chỉnh theo volatility
    if volatility == "HIGH":
        move_percent_1h *= 1.3
    elif volatility == "LOW":
        move_percent_1h *= 0.7

# Nếu model đã train tốt:
else:
    confidence_factor = 0.3 + abs(prob_value - 0.5) * 1.4
    move_percent_1h = pred_return_val * confidence_factor

# Safety bounds: giới hạn ±3%
move_percent_1h = max(-0.03, min(0.03, move_percent_1h))
```

**Ví dụ:**
- `prob_value = 0.582` → `move_percent_1h = +0.0167` → **+1.67%**

### 2.3. Xác định Direction 1H
```python
if abs(move_percent_1h) < 0.005:  # < 0.5%
    direction_1h = "SIDEWAYS"
elif move_percent_1h > 0:
    direction_1h = "UP"
else:
    direction_1h = "DOWN"
```

### 2.4. Tính Confidence 1H
```python
if direction_1h == "SIDEWAYS":
    confidence_1h = 60 + (sideways_strength * 25)  # 60-85%
else:
    raw_confidence = abs(prob_value - 0.5) * 2 * 100
    confidence_1h = min(95, max(40, 40 + raw_confidence * 1.1))
```

**Ví dụ:**
- `prob_value = 0.582` → `raw_confidence = 16.4%` → `confidence_1h = 58.0%`

### 2.5. Dự đoán 24H (dựa trên 1H)
```python
# 24h = 3.5x của 1h move, nhưng cap ở ±8%
if direction_1h == "SIDEWAYS":
    move_percent_24h = move_percent_1h * 2
else:
    move_percent_24h = move_percent_1h * 3.5
    move_percent_24h = max(-0.08, min(0.08, move_percent_24h))

target_price_24h = current_price * (1 + move_percent_24h)

# Tạo range ±20% của move
range_margin = abs(move_percent_24h) * 0.2
range_low = current_price * (1 + move_percent_24h - range_margin)
range_high = current_price * (1 + move_percent_24h + range_margin)
```

**Ví dụ:**
- `move_percent_1h = +1.67%` → `move_percent_24h = +5.85%` (3.5x)
- `current_price = $78,307` → `target_price_24h = $82,888`
- `range = [$81,971 - $83,805]` (±1.17%)

---

## 🤖 BƯỚC 3: TẠO PROMPT CHO GEMINI

### 3.1. Chuẩn bị dữ liệu
```python
dl_stats = {
    "probability": 0.582,
    "confidence": 58.0,
    "volatility": "LOW",
    "predicted_return": 1.67  # % change for 1h
}

tech_indicators = {
    "rsi": 53.7,
    "macd": -0.0065,
    "bb_high": 79500,
    "bb_low": 77800,
    "close": 78307.65
}
```

### 3.2. Prompt gửi đến Gemini
```
🎯 ROLE: Bạn là Senior Crypto Market Analyst

📊 NHIỆM VỤ: Phân tích và giải thích dự báo giá cho BTCUSDT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 KẾT QUẢ DỰ BÁO TỪ DEEP LEARNING MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔮 DỰ BÁO 1 GIỜ TỚI:
   • Xu hướng: UP
   • Mục tiêu giá: +1.67%
   • Xác suất: 0.582
   • Độ tin cậy: 58.0%
   • Volatility: LOW

📊 CHỈ SỐ KỸ THUẬT HIỆN TẠI:
   • Giá hiện tại: $78,307.65
   • RSI(14): 53.7 → Trung lập
   • MACD: -0.0065 → Tiêu cực
   • Bollinger Bands: [77800 - 79500]

📰 TIN TỨC: [Nếu có tin tức, sẽ hiển thị tiêu đề, nội dung, sentiment]
   HOẶC
   Không có tin tức đáng kể. Biến động giá chủ yếu do technical factors.

🎯 PRIMARY DRIVER: TECHNICAL
   → Model đã phân tích và xác định yếu tố chính ảnh hưởng đến giá là: Technical patterns

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YÊU CẦU ĐẦU RA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trả về JSON:
{
    "primary_driver": "TECHNICAL_CATALYST",
    "key_event": "Tóm tắt pattern chính",
    "news_citations": ["Trích dẫn nếu có tin"],
    "explanation_vi": "6-8 câu giải thích chi tiết...",
    "causal_chain": {...},
    "sentiment_impact": {...},
    "actionable_advice": "Entry, SL, TP cụ thể..."
}
```

---

## 📤 BƯỚC 4: OUTPUT CUỐI CÙNG

```json
{
  "symbol": "BTCUSDT",
  "current_price": 78307.65,
  "forecast": {
    "next_1h": {
      "direction": "UP",
      "expected_price": 79614.89,
      "price_change_percent": 1.67,
      "volatility": "LOW",
      "confidence": 58.0
    },
    "next_24h": {
      "direction": "UP",
      "expected_price": 82888.45,
      "price_change_percent": 5.85,
      "expected_range": {
        "low": 81971.23,
        "high": 83805.67
      },
      "confidence": 43.5
    }
  },
  "technical_indicators": {
    "rsi": 53.7,
    "macd": -0.0065,
    "bb_high": 79500,
    "bb_low": 77800
  },
  "explanation": "Dự báo UP +1.67% dựa trên...",  // ← Từ Gemini
  "causal_analysis": {                              // ← Từ Gemini
    "primary_driver": "TECHNICAL_CATALYST",
    "key_event": "RSI Neutral + MACD Divergence",
    "news_citations": [],
    "explanation_vi": "Giải thích 6-8 câu...",
    "causal_chain": {...},
    "actionable_advice": "Entry: $78,000-$78,500..."
  }
}
```

---

## 🔑 TÓM TẮT

### Dữ liệu đưa vào Gemini prompt:
1. ✅ **Dự đoán 1H**: Direction, % change, confidence, volatility
2. ✅ **Technical indicators**: RSI, MACD, Bollinger Bands, giá hiện tại
3. ✅ **Tin tức** (nếu có): Title, content, sentiment, attention score
4. ✅ **Primary driver**: NEWS hoặc TECHNICAL

### Gemini KHÔNG dự đoán giá:
- ❌ Gemini KHÔNG tính toán % thay đổi
- ❌ Gemini KHÔNG quyết định UP/DOWN
- ✅ Gemini CHỈ giải thích TẠI SAO model dự đoán như vậy

### Vai trò của Gemini:
- Đọc kết quả từ Deep Learning model
- Phân tích technical indicators
- Trích dẫn tin tức (nếu có)
- Viết explanation bằng tiếng Việt dễ hiểu
- Đưa ra actionable advice (Entry, SL, TP)
