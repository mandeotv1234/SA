const express = require('express');
const router = express.Router();
const { getInsights } = require('../controllers/InsightsController');

router.get('/', getInsights);

module.exports = router;
