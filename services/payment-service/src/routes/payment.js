const express = require('express');
const router = express.Router();
const PaymentTransaction = require('../models/PaymentTransaction');

// Create payment transaction
router.post('/create', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        // Create transaction with 10 minute expiration
        const transaction = await PaymentTransaction.create(userId, 10000, 10);

        res.json({
            success: true,
            transaction: {
                id: transaction.id,
                transactionId: transaction.transactionId,
                amount: transaction.amount,
                expiresAt: transaction.expiresAt,
                status: transaction.status
            }
        });
    } catch (error) {
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Failed to create transaction' });
    }
});

// Check transaction status
router.get('/status/:transactionId', async (req, res) => {
    try {
        const { transactionId } = req.params;
        const transaction = await PaymentTransaction.findByTransactionId(transactionId);

        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.json({
            success: true,
            transaction: {
                id: transaction.id,
                transactionId: transaction.transaction_id,
                userId: transaction.user_id,
                amount: transaction.amount,
                status: transaction.status,
                createdAt: transaction.created_at,
                expiresAt: transaction.expires_at,
                completedAt: transaction.completed_at
            }
        });
    } catch (error) {
        console.error('Error checking transaction:', error);
        res.status(500).json({ error: 'Failed to check transaction' });
    }
});

// Get user transactions
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const transactions = await PaymentTransaction.findByUserId(userId);

        res.json({
            success: true,
            transactions: transactions.map(t => ({
                id: t.id,
                transactionId: t.transaction_id,
                amount: t.amount,
                status: t.status,
                createdAt: t.created_at,
                expiresAt: t.expires_at,
                completedAt: t.completed_at
            }))
        });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

module.exports = router;
