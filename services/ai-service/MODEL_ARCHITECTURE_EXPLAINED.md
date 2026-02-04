# DEEP LEARNING MODEL - GIẢI THÍCH CHI TIẾT

## 🧠 KIẾN TRÚC MODEL: AdvancedDualStreamNetwork

Model này là **Dual-Stream Architecture** - xử lý 2 luồng dữ liệu song song:
1. **Price Stream**: LSTM + Transformer xử lý dữ liệu giá
2. **News Stream**: Multi-Head Attention xử lý tin tức

---

## 📥 INPUT VÀO MODEL

### 1. Price Data: `x_price` [Batch, 60, 11]
```python
# 60 timesteps (60 nến 5 phút = 5 giờ lịch sử)
# 11 features cho mỗi nến:
[
    Open,           # Giá mở cửa
    High,           # Giá cao nhất
    Low,            # Giá thấp nhất
    Close,          # Giá đóng cửa
    Volume,         # Khối lượng giao dịch
    RSI,            # Relative Strength Index (14)
    MACD,           # Moving Average Convergence Divergence
    BB_high,        # Bollinger Band Upper
    BB_low,         # Bollinger Band Lower
    SMA_20,         # Simple Moving Average 20
    EMA_12          # Exponential Moving Average 12
]

# Ví dụ shape: [1, 60, 11]
# - Batch = 1 (dự đoán 1 coin)
# - Seq = 60 (60 nến)
# - Features = 11
```

### 2. News Embeddings: `x_news` [Batch, 60, 768]
```python
# 60 timesteps (align với 60 nến)
# 768 features (FinBERT embedding dimension)

# Cách align tin tức với nến:
# - Mỗi nến 5 phút có 1 vector 768-dim
# - Vector này là tổng hợp sentiment của TẤT CẢ tin tức 
#   xuất hiện trong khoảng thời gian đó
# - Nếu không có tin: vector = [0, 0, ..., 0]
# - Nếu có tin: vector = FinBERT(news_content)

# Ví dụ:
# Nến #58 (5 phút trước): có 2 tin → embedding = avg([emb1, emb2])
# Nến #59 (hiện tại): không có tin → embedding = [0, 0, ...]
```

### 3. Coin Index: `coin_idx` [Batch]
```python
# Mã hóa loại coin:
coin_mapping = {
    "BTCUSDT": 0,
    "ETHUSDT": 1,
    "BNBUSDT": 2,
    "SOLUSDT": 3,
    "XRPUSDT": 4,
    "DOGEUSDT": 5,
    "ADAUSDT": 6,
    "AVAXUSDT": 7,
    "DOTUSDT": 8,
    "POLUSDT": 9
}

# Ví dụ: coin_idx = [0] → BTCUSDT
```

---

## 🔄 QUÁ TRÌNH XỬ LÝ TRONG MODEL

### BƯỚC 1: Price Stream Processing
```python
# 1.1. Bi-LSTM xử lý sequence
lstm_out = LSTM(x_price)  # [1, 60, 256]
# → Học temporal patterns trong giá

# 1.2. Transformer attention
price_features = Transformer(lstm_out)  # [1, 60, 128]
# → Học long-range dependencies

# 1.3. Lấy context cuối cùng
price_context = price_features[:, -1, :]  # [1, 128]
# → Đại diện cho trạng thái giá hiện tại
```

### BƯỚC 2: News Stream Processing
```python
# 2.1. Self-attention trên news
news_features = MultiHeadAttention(x_news)  # [1, 60, 768]
# → Học mối quan hệ giữa các tin tức

# 2.2. Temporal importance scoring
news_scores = TemporalScore(news_features)  # [1, 60, 1]
news_weights = softmax(news_scores)  # [1, 60, 1]
# → Xác định tin nào quan trọng nhất

# 2.3. Weighted aggregation
news_context = sum(news_features * news_weights)  # [1, 768]
# → Đại diện cho tác động tin tức tổng hợp
```

### BƯỚC 3: Coin Embedding
```python
# Mỗi coin có đặc điểm riêng (volatility, liquidity, correlation)
coin_embed = Embedding(coin_idx)  # [1, 16]
coin_context = Linear(coin_embed)  # [1, 128]
```

### BƯỚC 4: Cross-Modal Fusion
```python
# Price "nhìn vào" News để hiểu tác động
cross_attn_out = CrossAttention(
    query=price_features,      # [1, 60, 128]
    key=news_features,         # [1, 60, 768]
    value=news_features        # [1, 60, 768]
)  # [1, 60, 128]

cross_context = cross_attn_out[:, -1, :]  # [1, 128]
```

### BƯỚC 5: Fusion & Shared Features
```python
# Gộp tất cả contexts
fused = concat([price_context, cross_context, coin_context])  # [1, 384]

# Qua fusion layers
fused_features = FusionLayers(fused)  # [1, 128]

# Shared features cho tất cả prediction heads
shared = SharedLayers(fused_features)  # [1, 128]
```

---

## 📤 OUTPUT TỪ MODEL

### Model trả về 4 thứ:

```python
pred_1h = {
    'direction_logit': tensor([0.330659]),  # Raw logit (chưa qua sigmoid)
    'direction': tensor([0.582]),           # Sigmoid(logit) = probability
    'return': tensor([0.0089]),             # % return dự đoán (0.89%)
    'confidence': tensor([0.723])           # Độ tin cậy của model
}

pred_24h = {
    'direction_logit': tensor([-0.123]),
    'direction': tensor([0.469]),           # 46.9% → DOWN
    'return': tensor([-0.0156]),            # -1.56%
    'confidence': tensor([0.651])
}

volatility_probs = tensor([[0.15, 0.70, 0.15]])  # [LOW, MEDIUM, HIGH]

attention_weights = {
    'news_temporal': tensor([60 values]),   # Attention cho từng timestep
    'cross_modal': tensor([60x60 matrix])   # Cross-attention matrix
}
```

---

## 🧮 POST-PROCESSING: TÍNH GIÁ DỰ ĐOÁN

### ⚠️ QUAN TRỌNG: Model KHÔNG trả về giá trực tiếp!

Model chỉ trả về:
- ✅ **direction_logit**: Xác suất thô (UP/DOWN)
- ✅ **return**: % thay đổi dự đoán (nhưng thường không tin cậy nếu model chưa train tốt)
- ✅ **confidence**: Độ tin cậy

**Code sẽ tính toán giá dự đoán** dựa trên các outputs này:

```python
# BƯỚC 1: Lấy probability từ logit
prob_value = sigmoid(direction_logit)  # 0.330659 → 0.582

# BƯỚC 2: Kiểm tra model đã train tốt chưa
pred_return_val = pred_1h['return'].item()  # 0.0089 = 0.89%

if abs(pred_return_val) > 0.005:  # > 0.5%
    # Model chưa train tốt → Dùng heuristic
    print("⚠️ Model chưa tin cậy, dùng fallback logic")
    
    # Tính % change dựa trên probability
    move_percent_1h = (prob_value - 0.5) * 0.04
    # prob=0.582 → (0.582-0.5)*0.04 = 0.0328 = 3.28%
    
    # Điều chỉnh theo volatility
    volatility_class = argmax(volatility_probs)  # 1 = MEDIUM
    if volatility_class == 2:  # HIGH
        move_percent_1h *= 1.3
    elif volatility_class == 0:  # LOW
        move_percent_1h *= 0.7
    
else:
    # Model đã train tốt → Dùng output của model
    print("✅ Model tin cậy, dùng prediction")
    confidence_factor = 0.3 + abs(prob_value - 0.5) * 1.4
    move_percent_1h = pred_return_val * confidence_factor

# BƯỚC 3: Safety bounds (giới hạn ±3%)
move_percent_1h = max(-0.03, min(0.03, move_percent_1h))

# BƯỚC 4: Tính giá target
current_price = 78307.65
target_price_1h = current_price * (1 + move_percent_1h)
# = 78307.65 * 1.0167 = 79614.89

# BƯỚC 5: Xác định direction
if abs(move_percent_1h) < 0.005:  # < 0.5%
    direction_1h = "SIDEWAYS"
elif move_percent_1h > 0:
    direction_1h = "UP"
else:
    direction_1h = "DOWN"

# BƯỚC 6: Tính confidence
raw_confidence = abs(prob_value - 0.5) * 2 * 100
confidence_1h = min(95, max(40, 40 + raw_confidence * 1.1))
# = min(95, max(40, 40 + 16.4 * 1.1)) = 58.0%
```

### Dự đoán 24H:
```python
# 24h = 3.5x của 1h (nhưng cap ở ±8%)
move_percent_24h = move_percent_1h * 3.5
move_percent_24h = max(-0.08, min(0.08, move_percent_24h))

target_price_24h = current_price * (1 + move_percent_24h)
```

---

## 📊 TÓM TẮT LUỒNG DỮ LIỆU

```
INPUT:
├─ x_price [1, 60, 11]      ─┐
├─ x_news [1, 60, 768]      ─┤
└─ coin_idx [1]             ─┤
                             │
                             ▼
                    ┌────────────────┐
                    │  DEEP LEARNING │
                    │     MODEL      │
                    └────────────────┘
                             │
                             ▼
OUTPUT (RAW):
├─ direction_logit: 0.330659
├─ direction_prob: 0.582
├─ return: 0.0089 (0.89%)
├─ confidence: 0.723
└─ volatility: [0.15, 0.70, 0.15]
                             │
                             ▼
                    ┌────────────────┐
                    │ POST-PROCESSING│
                    │  (inference.py)│
                    └────────────────┘
                             │
                             ▼
FINAL PREDICTION:
├─ direction: "UP"
├─ price_change: +1.67%
├─ target_price_1h: $79,614.89
├─ target_price_24h: $82,888.45
└─ confidence: 58.0%
```

---

## 🎯 KẾT LUẬN

### Model làm gì:
1. ✅ Phân tích 60 nến giá + technical indicators
2. ✅ Phân tích 60 timesteps tin tức (FinBERT embeddings)
3. ✅ Học mối quan hệ giữa Price và News
4. ✅ Trả về **xác suất** UP/DOWN và **% thay đổi dự kiến**

### Code post-processing làm gì:
1. ✅ Chuyển đổi logit → probability
2. ✅ Kiểm tra model có tin cậy không
3. ✅ Tính toán **giá target cụ thể** (1H và 24H)
4. ✅ Xác định direction (UP/DOWN/SIDEWAYS)
5. ✅ Tính confidence score

### Gemini làm gì:
1. ✅ Đọc kết quả từ model + post-processing
2. ✅ Viết **explanation** bằng tiếng Việt
3. ✅ Trích dẫn tin tức (nếu có)
4. ✅ Đưa ra actionable advice

**→ Model dự đoán XÁC SUẤT, code tính GIÁ, Gemini GIẢI THÍCH!**
