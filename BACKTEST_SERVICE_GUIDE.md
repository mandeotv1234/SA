# 📊 Backtest Service - Hướng Dẫn Chi Tiết

## 🎯 Tổng Quan

Backtest Service là microservice cho phép kiểm tra hiệu quả của các chiến lược trading dựa trên dữ liệu lịch sử (historical data). Service này tích hợp:
- **Technical Indicators** (RSI, MACD, EMA, SMA, Bollinger Bands)
- **AI Predictions** (dự đoán hướng giá, độ tin cậy, volatility)
- **News Sentiment** (phân tích cảm xúc tin tức)

---

## 📥 INPUT - Dữ Liệu Đầu Vào

### 1. **Strategy Configuration**
```json
{
  "strategy": {
    "name": "My AI Strategy 09-02-2026 22h15",
    "conditions": [
      {
        "type": "indicator|ai|price|news",
        "name": "RSI",              // Cho type=indicator
        "field": "direction_1h",    // Cho type=ai
        "operator": ">|<|>=|<=|=",
        "value": 30
      }
    ],
    "logic": "AND|OR",
    "action": "BUY|SELL",
    "timeframe": "1h|4h|1d",
    "take_profit": 5.0,   // % lợi nhuận mục tiêu
    "stop_loss": 2.0      // % cắt lỗ
  },
  "symbol": "BTCUSDT",
  "start_date": "2026-01-10T00:00:00Z",
  "end_date": "2026-02-09T23:59:59Z",
  "initial_capital": 10000
}
```

### 2. **Condition Types**

#### **A. Indicator (Technical Analysis)**
```javascript
{
  "type": "indicator",
  "name": "RSI|MACD|EMA20|SMA50|BollingerBands",
  "operator": ">|<|>=|<=",
  "value": 30
}
```

**Available Indicators:**
- `RSI`: Relative Strength Index (0-100)
- `MACD`: Moving Average Convergence Divergence
- `EMA20`: Exponential Moving Average (20 periods)
- `SMA50`: Simple Moving Average (50 periods)
- `BollingerBands`: Volatility indicator

#### **B. AI Predictions**
```javascript
{
  "type": "ai",
  "field": "direction_1h|confidence_1h|volatility",
  "operator": "=|>|<",
  "value": "UP|DOWN|SIDEWAYS" // hoặc số (0-1) cho confidence
}
```

**AI Fields:**
- `direction_1h`: Hướng giá dự đoán (UP/DOWN/SIDEWAYS)
- `confidence_1h`: Độ tin cậy (0.0 - 1.0)
- `volatility`: Mức độ biến động (LOW/MEDIUM/HIGH)

#### **C. Price**
```javascript
{
  "type": "price",
  "operator": ">|<",
  "value": 50000  // Giá USD
}
```

#### **D. News Sentiment**
```javascript
{
  "type": "news",
  "field": "sentiment_score",
  "operator": ">|<",
  "value": 0.3
}
```

**Sentiment Score Range:** `-1.0` (rất tiêu cực) đến `+1.0` (rất tích cực)

---

## ⚙️ PROCESSING - Xử Lý Logic

### 1. **Data Fetching**
```
┌─────────────────────────────────────────────────────────┐
│ 1. Fetch Historical Candles (OHLCV)                    │
│    - Binance API (primary)                              │
│    - TimescaleDB (fallback)                             │
├─────────────────────────────────────────────────────────┤
│ 2. Fetch AI Predictions                                 │
│    - TimescaleDB: ai_insights table                     │
│    - Filter by date range & symbol                      │
├─────────────────────────────────────────────────────────┤
│ 3. Fetch News Sentiment                                 │
│    - TimescaleDB: news_sentiment table                  │
│    - Filter by date range                               │
└─────────────────────────────────────────────────────────┘
```

### 2. **Backtest Engine Flow**
```
FOR each candle in historical data:
  ├─ Calculate Technical Indicators (RSI, MACD, etc.)
  ├─ Get Latest AI Prediction (at or before current time)
  ├─ Get Recent News (last 24 hours)
  │
  ├─ Build Context:
  │   {
  │     candle: { open, high, low, close, volume },
  │     currentPrice: close,
  │     indicators: { rsi, macd, ema20, ... },
  │     prediction: { direction, confidence, ... },
  │     news: [{ sentiment_score, title, time }, ...]
  │   }
  │
  ├─ Evaluate Strategy Conditions:
  │   IF (logic === 'AND'):
  │     result = ALL conditions are TRUE
  │   ELSE IF (logic === 'OR'):
  │     result = ANY condition is TRUE
  │
  ├─ Execute Trade:
  │   IF (result === TRUE AND no open position):
  │     OPEN position (BUY or SELL based on action)
  │     Set take_profit and stop_loss levels
  │
  ├─ Manage Open Position:
  │   IF (price hits take_profit):
  │     CLOSE position → Profit
  │   ELSE IF (price hits stop_loss):
  │     CLOSE position → Loss
  │
  └─ Calculate Metrics:
      - Total Return %
      - Win Rate
      - Max Drawdown
      - Sharpe Ratio
```

### 3. **Strategy Evaluation Logic**

**Example: AND Logic**
```javascript
Conditions:
  1. RSI < 30
  2. AI direction_1h = UP
  3. News sentiment > 0.2

Evaluation:
  IF (RSI < 30) AND (AI = UP) AND (News > 0.2):
    → Execute BUY
```

**Example: OR Logic**
```javascript
Conditions:
  1. RSI < 30
  2. MACD > 0

Evaluation:
  IF (RSI < 30) OR (MACD > 0):
    → Execute BUY
```

---

## 📤 OUTPUT - Kết Quả

### 1. **Backtest Results**
```json
{
  "id": "284af5d9-1e73-4050-8e91-4e8d23822352",
  "user_id": "user123",
  "strategy": { ... },
  "symbol": "BTCUSDT",
  "timeframe": "1h",
  "start_date": "2026-01-10T00:00:00Z",
  "end_date": "2026-02-09T23:59:59Z",
  "initial_capital": 10000,
  
  "results": {
    "total_trades": 15,
    "winning_trades": 9,
    "losing_trades": 6,
    "win_rate": 60.0,
    
    "total_return": 8.5,           // % profit/loss
    "final_capital": 10850,
    "max_drawdown": -3.2,          // % worst loss
    "sharpe_ratio": 1.45,
    
    "avg_win": 2.3,                // % average win
    "avg_loss": -1.5,              // % average loss
    "profit_factor": 1.53          // total_wins / total_losses
  },
  
  "trades": [
    {
      "entry_time": "2026-01-15T10:00:00Z",
      "entry_price": 42500,
      "exit_time": "2026-01-15T14:00:00Z",
      "exit_price": 43200,
      "type": "BUY",
      "profit_loss": 1.65,         // %
      "exit_reason": "take_profit"
    }
  ],
  
  "created_at": "2026-02-09T22:13:11Z"
}
```

### 2. **Performance Metrics**

| Metric | Description | Good Value |
|--------|-------------|------------|
| **Total Return** | Tổng lợi nhuận/lỗ (%) | > 5% |
| **Win Rate** | Tỷ lệ thắng (%) | > 50% |
| **Max Drawdown** | Mức lỗ tối đa (%) | < -10% |
| **Sharpe Ratio** | Hiệu quả điều chỉnh rủi ro | > 1.0 |
| **Profit Factor** | Tỷ lệ lãi/lỗ | > 1.5 |

---

## 🎓 VÍ DỤ STRATEGIES CHO DEMO

### 📈 **Strategy 1: Conservative BUY (RSI Oversold + AI Confirmation)**

**Mục tiêu:** Mua khi thị trường oversold và AI dự đoán tăng

```json
{
  "name": "Conservative BUY - RSI + AI",
  "conditions": [
    {
      "type": "indicator",
      "name": "RSI",
      "operator": "<",
      "value": 35
    },
    {
      "type": "ai",
      "field": "direction_1h",
      "operator": "=",
      "value": "UP"
    },
    {
      "type": "ai",
      "field": "confidence_1h",
      "operator": ">",
      "value": 0.6
    }
  ],
  "logic": "AND",
  "action": "BUY",
  "take_profit": 3.0,
  "stop_loss": 1.5
}
```

**Giải thích:**
- RSI < 35: Thị trường oversold (bán quá mức)
- AI dự đoán UP với confidence > 60%
- Take profit 3%, Stop loss 1.5%

---

### 📉 **Strategy 2: Aggressive SELL (RSI Overbought + Negative News)**

**Mục tiêu:** Bán khi thị trường overbought và tin tức tiêu cực

```json
{
  "name": "Aggressive SELL - RSI + News",
  "conditions": [
    {
      "type": "indicator",
      "name": "RSI",
      "operator": ">",
      "value": 70
    },
    {
      "type": "news",
      "field": "sentiment_score",
      "operator": "<",
      "value": -0.2
    }
  ],
  "logic": "AND",
  "action": "SELL",
  "take_profit": 4.0,
  "stop_loss": 2.0
}
```

**Giải thích:**
- RSI > 70: Thị trường overbought (mua quá mức)
- News sentiment < -0.2: Tin tức tiêu cực
- Take profit 4%, Stop loss 2%

---

### 📊 **Strategy 3: Moderate BUY (MACD + Positive News)**

**Mục tiêu:** Mua khi MACD tích cực và tin tức tốt

```json
{
  "name": "Moderate BUY - MACD + News",
  "conditions": [
    {
      "type": "indicator",
      "name": "MACD",
      "operator": ">",
      "value": 0
    },
    {
      "type": "news",
      "field": "sentiment_score",
      "operator": ">",
      "value": 0.3
    }
  ],
  "logic": "AND",
  "action": "BUY",
  "take_profit": 5.0,
  "stop_loss": 2.5
}
```

**Giải thích:**
- MACD > 0: Xu hướng tăng
- News sentiment > 0.3: Tin tức khá tích cực
- Take profit 5%, Stop loss 2.5%

---

### 🎯 **Strategy 4: AI-Driven BUY (Pure AI Strategy)**

**Mục tiêu:** Tin tưởng hoàn toàn vào AI predictions

```json
{
  "name": "AI-Driven BUY",
  "conditions": [
    {
      "type": "ai",
      "field": "direction_1h",
      "operator": "=",
      "value": "UP"
    },
    {
      "type": "ai",
      "field": "confidence_1h",
      "operator": ">",
      "value": 0.75
    },
    {
      "type": "ai",
      "field": "volatility",
      "operator": "=",
      "value": "LOW"
    }
  ],
  "logic": "AND",
  "action": "BUY",
  "take_profit": 4.0,
  "stop_loss": 2.0
}
```

**Giải thích:**
- AI dự đoán UP với confidence > 75%
- Volatility thấp (ít rủi ro)
- Take profit 4%, Stop loss 2%

---

### 🔄 **Strategy 5: Mean Reversion SELL**

**Mục tiêu:** Bán khi giá cao hơn nhiều so với SMA50

```json
{
  "name": "Mean Reversion SELL",
  "conditions": [
    {
      "type": "indicator",
      "name": "RSI",
      "operator": ">",
      "value": 65
    },
    {
      "type": "ai",
      "field": "direction_1h",
      "operator": "=",
      "value": "DOWN"
    }
  ],
  "logic": "AND",
  "action": "SELL",
  "take_profit": 3.5,
  "stop_loss": 1.8
}
```

**Giải thích:**
- RSI > 65: Gần overbought
- AI dự đoán DOWN
- Take profit 3.5%, Stop loss 1.8%

---

### 📰 **Strategy 6: News-Driven BUY (Flexible OR Logic)**

**Mục tiêu:** Mua khi có TIN TỐT hoặc RSI thấp

```json
{
  "name": "News-Driven BUY",
  "conditions": [
    {
      "type": "news",
      "field": "sentiment_score",
      "operator": ">",
      "value": 0.5
    },
    {
      "type": "indicator",
      "name": "RSI",
      "operator": "<",
      "value": 40
    }
  ],
  "logic": "OR",
  "action": "BUY",
  "take_profit": 6.0,
  "stop_loss": 3.0
}
```

**Giải thích:**
- News sentiment > 0.5 HOẶC RSI < 40
- Logic OR: Chỉ cần 1 trong 2 điều kiện đúng
- Take profit 6%, Stop loss 3%

---

## 📋 CHECKLIST DEMO CHO THẦY

### ✅ **Chuẩn Bị**
1. Đảm bảo có dữ liệu trong khoảng thời gian demo (ví dụ: 2026-01-10 đến 2026-02-09)
2. Kiểm tra TimescaleDB có đủ:
   - Historical candles (OHLCV)
   - AI predictions
   - News sentiment

### ✅ **Demo Flow**

**Bước 1:** Chọn Strategy từ danh sách trên (ví dụ: Strategy 1 - Conservative BUY)

**Bước 2:** Cấu hình parameters:
- Symbol: BTCUSDT
- Timeframe: 1h
- Start Date: 2026-01-10
- End Date: 2026-02-09
- Initial Capital: $10,000

**Bước 3:** Run Backtest và giải thích:
- "Strategy này sẽ mua khi RSI < 35 (oversold) VÀ AI dự đoán tăng với confidence > 60%"
- "Take profit ở 3%, stop loss ở 1.5%"

**Bước 4:** Phân tích kết quả:
- Total Return: X%
- Win Rate: Y%
- Số trades: Z
- Giải thích tại sao có kết quả này

**Bước 5:** So sánh với Strategy khác (ví dụ: Strategy 2 - SELL)
- Chỉ ra sự khác biệt
- Giải thích khi nào nên dùng BUY vs SELL strategy

---

## 🎯 TIPS CHO DEMO THÀNH CÔNG

1. **Chọn timeframe phù hợp:**
   - 1h: Nhiều trades, phù hợp demo
   - 4h/1d: Ít trades hơn, ổn định hơn

2. **Điều chỉnh ngưỡng hợp lý:**
   - RSI: 30-70 (oversold-overbought)
   - AI confidence: 0.6-0.8
   - News sentiment: -0.3 đến 0.3

3. **Giải thích logic rõ ràng:**
   - Tại sao chọn điều kiện này?
   - Ý nghĩa của mỗi indicator?
   - Kỳ vọng kết quả như thế nào?

4. **So sánh strategies:**
   - Conservative vs Aggressive
   - BUY vs SELL
   - Technical vs AI-driven

---

## 📞 API Endpoints

### **POST /v1/backtest/run**
Chạy backtest với strategy configuration

### **GET /v1/backtest/history**
Lấy danh sách các backtest đã chạy

### **GET /v1/backtest/:id**
Xem chi tiết kết quả backtest

---

**Tài liệu này cung cấp đầy đủ thông tin về Backtest Service để demo hiệu quả!** 🚀
