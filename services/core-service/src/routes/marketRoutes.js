const express = require('express');
const router = express.Router();
const marketController = require('../controllers/MarketController');

// Endpoint: GET /api/v1/klines?symbol=BTCUSDT
router.get('/klines', marketController.getKlines);

// Endpoint: GET /api/v1/klines/missed?symbol=BTCUSDT&fromSeq=100&toSeq=150
router.get('/klines/missed', marketController.getMissedKlines);

module.exports = router;