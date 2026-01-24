require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const authMiddleware = require('./middleware/auth');
const { initDB } = require('./db');
const { getRedisClient } = require('./config/redis');

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());
app.use(cookieParser()); // Phase 2: Parse cookies for refresh tokens

// public auth routes
app.use('/auth', authRoutes);

// protected example endpoint
app.get('/profile', authMiddleware, async (req, res) => {
  const user = { id: req.user.sub, email: req.user.email };
  res.json({ user });
});

app.get('/health', (req, res) => res.json({ alive: true }));

const startPaymentConsumer = require('./consumers/PaymentSuccessConsumer');

// Initialize Redis and DB
Promise.all([
  initDB(),
  getRedisClient()
]).then(() => {
  console.log('✓ Database and Redis connected');
  
  app.listen(PORT, () => {
    console.log(`Auth Service listening on ${PORT}`);

    // Start Kafka Consumer
    startPaymentConsumer().catch(err => {
      console.error('Failed to start PaymentSuccessConsumer', err);
    });
  });
}).catch(err => {
  console.error('Service initialization failed:', err);
  process.exit(1);
});