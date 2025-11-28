const express = require('express');
const router = express.Router();
const marketController = require('../controllers/MarketController');

// Endpoint: GET /api/v1/klines?symbol=BTCUSDT
router.get('/klines', marketController.getKlines);

module.exports = router;