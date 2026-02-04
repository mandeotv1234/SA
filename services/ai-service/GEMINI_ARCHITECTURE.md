# KIẾN TRÚC PREDICTION PIPELINE VỚI GEMINI API

## 🔄 QUY TRÌNH DỰ ĐOÁN (PREDICTION FLOW)

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEWS AGGREGATOR                              │
│  - Nhận 72 bài báo từ Kafka                                     │
│  - Buffer và schedule prediction mỗi 60s                        │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │  LOOP: 10 coins            │
        │  (BTCUSDT, ETHUSDT, ...)   │
        └────────────┬───────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              INFERENCE ENGINE (cho từng coin)                   │
│                                                                 │
│  1. Lấy 76 nến giá từ market_cache                             │
│  2. Thêm technical indicators (RSI, MACD, BB, SMA, EMA)        │
│  3. Vectorize 72 bài báo bằng FinBERT → 768-dim embeddings    │
│  4. Align news to candles (mỗi nến có sentiment vector)        │
│  5. Chuẩn bị input tensors:                                     │
│     - X_price: [1, 60, 11] (OHLCV + 6 indicators)             │
│     - X_news: [1, 60, 768] (FinBERT embeddings)               │
│     - coin_idx: [1] (0-10)                                     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│           DEEP LEARNING MODEL (AdvancedDualStreamNetwork)       │
│                                                                 │
│  Architecture:                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Coin Embed   │  │ Price Stream │  │ News Stream  │         │
│  │ (16-dim)     │  │ LSTM+Trans   │  │ Attention    │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                  │                 │
│         └─────────────────┴──────────────────┘                 │
│                           │                                     │
│                    ┌──────▼──────┐                             │
│                    │   Fusion    │                             │
│                    │   Layers    │                             │
│                    └──────┬──────┘                             │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                 │
│         │                 │                 │                 │
│    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐             │
│    │ 1h Head │      │ 24h Head│      │Vol Head │             │
│    └────┬────┘      └────┬────┘      └────┬────┘             │
│         │                │                 │                 │
│  OUTPUT:│                │                 │                 │
│  - direction_logit: 0.330659               │                 │
│  - direction: 0.582 (UP)                   │                 │
│  - return: +0.41%                          │                 │
│  - confidence: 0.878                       │                 │
│  - volatility: LOW (0.48)                  │                 │
│  - attention_weights: [60 timesteps]       │                 │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         POST-PROCESSING (trong inference.py)                    │
│                                                                 │
│  1. Phân tích attention weights → Tìm tin tức quan trọng nhất  │
│  2. Detect news alignment:                                      │
│     - Tin xuất hiện khi nào?                                   │
│     - Volume spike bao nhiêu %?                                │
│     - Giá phản ứng như thế nào?                                │
│  3. Analyze impact mechanisms:                                  │
│     - FOMO_BUYING                                              │
│     - SHORT_LIQUIDATION                                        │
│     - WHALE_ACCUMULATION                                       │
│     - PANIC_SELLING                                            │
│  4. Build structured causal reasoning                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│    GEMINI API CALL (CHỈ để tạo explanation văn bản)            │
│                                                                 │
│  Gemini Client chỉ có 2 methods:                               │
│  ✅ generate(prompt) - Gọi Gemini API                          │
│  ✅ extract_response(result) - Parse JSON response             │
│                                                                 │
│  ❌ KHÔNG CÓ generate_market_prediction() nữa!                 │
│                                                                 │
│  Input: PROMPT CHI TIẾT từ inference.py:                       │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 🎯 ROLE: Senior Crypto Market Analyst                     │ │
│  │                                                            │ │
│  │ 📊 DỮ LIỆU ĐẦU VÀO:                                        │ │
│  │ - Symbol: BTCUSDT                                          │ │
│  │ - Direction: UP (+0.41%)                                   │ │
│  │ - Confidence: 87.8%                                        │ │
│  │ - Tin tức chính: "Bitcoin's Crash Spells Trouble..."      │ │
│  │ - Nội dung đầy đủ: "..."                                   │ │
│  │ - RSI: 45.2, MACD: -0.0012, BB: [78500 - 81200]          │ │
│  │ - Alignment: Tin xuất hiện 15 phút trước                   │ │
│  │ - Volume spike: +120%                                      │ │
│  │ - Price reaction: +0.8%                                    │ │
│  │ - Impact mechanism: SHORT_LIQUIDATION (75% confidence)     │ │
│  │                                                            │ │
│  │ 🧠 YÊU CẦU:                                                │ │
│  │ LAYER 1: Phân tích thời điểm (alignment)                  │ │
│  │ LAYER 2: Giải thích nhân quả (causal)                     │ │
│  │ LAYER 3: Lời khuyên chiến lược                            │ │
│  │                                                            │ │
│  │ TRẢ VỀ JSON:                                               │ │
│  │ {                                                          │ │
│  │   "primary_driver": "NEWS_CATALYST",                      │ │
│  │   "key_event": "Bitcoin Crash Triggers Short Squeeze",    │ │
│  │   "news_citations": ["Trích dẫn nguyên văn..."],          │ │
│  │   "explanation_vi": "Dự báo TĂNG 0.41%...",              │ │
│  │   "causal_chain": {...},                                  │ │
│  │   "actionable_advice": "Entry $79,500..."                 │ │
│  │ }                                                          │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Output: JSON với causal explanation chi tiết                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              FINAL PREDICTION OBJECT                            │
│                                                                 │
│  {                                                              │
│    "symbol": "BTCUSDT",                                         │
│    "current_price": 79234.50,                                   │
│    "forecast": {                                                │
│      "next_1h": {                                               │
│        "direction": "UP",                                       │
│        "expected_price": 79559.23,                              │
│        "price_change_percent": 0.41,                            │
│        "confidence": 87.8                                       │
│      },                                                         │
│      "next_24h": {...}                                          │
│    },                                                           │
│    "technical_indicators": {                                    │
│      "rsi": 45.2,                                               │
│      "macd": -0.0012,                                           │
│      "bb_high": 81200,                                          │
│      "bb_low": 78500                                            │
│    },                                                           │
│    "news_impact_analysis": {                                    │
│      "top_articles": [...],  // FinBERT semantic analysis      │
│      "overall_sentiment": "TIÊU CỰC",                           │
│      "combined_impact": "..."                                   │
│    },                                                           │
│    "explanation": "Trong 1 giờ qua, giá đã giảm 1.2%...",     │
│    "causal_analysis": {  // ← GEMINI GENERATED                 │
│      "primary_driver": "NEWS_CATALYST",                         │
│      "key_event": "Bitcoin Crash Triggers Short Squeeze",       │
│      "explanation_vi": "Dự báo TĂNG 0.41% được thúc đẩy...",  │
│      "actionable_advice": "Entry $79,500-$79,800..."           │
│    },                                                           │
│    "sources": [...],                                            │
│    "debug_metadata": {                                          │
│      "driver": "NEWS",                                          │
│      "attention_score": 0.234,                                  │
│      "model_trained": true,                                     │
│      "news_count_analyzed": 72                                  │
│    }                                                            │
│  }                                                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
              Publish to Kafka
              (ai_insights topic)
```

## 📝 TÓM TẮT VAI TRÒ CỦA GEMINI

### ✅ GEMINI ĐƯỢC DÙNG ĐỂ:
1. **Tạo causal explanation văn bản** (tiếng Việt) từ dữ liệu đã có
2. **Giải thích TẠI SAO** model dự đoán như vậy
3. **Trích dẫn tin tức** cụ thể từ bài báo
4. **Đưa ra lời khuyên giao dịch** (Entry, SL, TP)

### ❌ GEMINI KHÔNG DÙNG ĐỂ:
1. ~~Dự đoán giá~~ (Deep Learning model làm việc này)
2. ~~Phân tích technical indicators~~ (DataProcessor làm việc này)
3. ~~Tính toán sentiment~~ (FinBERT làm việc này)
4. ~~Detect news alignment~~ (Inference engine làm việc này)

## 🎯 KẾT LUẬN

**Gemini chỉ là "người kể chuyện"** - nhận dữ liệu từ Deep Learning model và 
technical analysis, rồi viết thành văn bản dễ hiểu cho người dùng.

**Deep Learning model mới là "bộ não"** - thực hiện prediction thực sự dựa trên
60 timesteps của price + news data.
