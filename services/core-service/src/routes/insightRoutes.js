const express = require('express');
const router = express.Router();
const { getInsights, getLatestPrediction } = require('../controllers/InsightsController');
const { requireVIP } = require('../middleware/authMiddleware');

// Protect this route with VIP middleware
router.get('/', requireVIP, getInsights);

// Get latest prediction for a specific symbol
router.get('/latest/:symbol', requireVIP, getLatestPrediction);

// Internal route for other microservices (no auth)
router.get('/internal', getInsights);

module.exports = router;
