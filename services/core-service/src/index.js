require('dotenv').config();
const express = require('express');
const cors = require('cors');
const marketRoutes = require('./routes/marketRoutes');
const newsRoutes = require('./routes/newsRoutes');
const startMarketConsumer = require('./consumers/MarketDataConsumer');
const startNewsConsumer = require('./consumers/NewsAnalyzedConsumer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Cho phép Frontend React gọi API
app.use(express.json());

// Routes
app.use('/api/v1', marketRoutes);
app.use('/api/v1/news', newsRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.send('Core Service is running...');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Core Service running on port ${PORT}`);
  
  // Sau khi server web chạy, khởi động luôn Kafka Consumer
  startMarketConsumer().catch(err => {
    console.error('Failed to start Kafka Consumer', err);
  });
  // start news analyzed consumer
  startNewsConsumer().catch(err => {
    console.error('Failed to start NewsAnalyzedConsumer', err);
  });
});