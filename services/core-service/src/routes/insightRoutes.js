const express = require('express');
const router = express.Router();
const { getInsights } = require('../controllers/InsightsController');
const { requireVIP } = require('../middleware/authMiddleware');

// Protect this route with VIP middleware
router.get('/', requireVIP, getInsights);

module.exports = router;
