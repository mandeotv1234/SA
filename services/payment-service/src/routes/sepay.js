const express = require('express');
const router = express.Router();
const { processPayment } = require('../services/paymentProcessor');

// Sepay Webhook Endpoint
router.post('/webhook', async (req, res) => {
    try {
        const transaction = req.body;
        // Basic validation of Sepay payload structure if needed
        // transactionDate, accountNumber, subAccount, transferType, transferAmount, accumulated, code, content, referenceCode, description

        await processPayment(transaction);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

module.exports = router;
