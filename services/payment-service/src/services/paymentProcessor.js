const { producer } = require('../config/kafka');
const PaymentTransaction = require('../models/PaymentTransaction');

/**
 * Parses the transaction content to extract User ID.
 * Expected format: "VIP <USER_ID>"
 */
const processPayment = async (transaction) => {
    console.log('Processing transaction:', transaction);

    // 1. Validate Amount (Must be >= 10,000)
    if (transaction.transferAmount < 10000) {
        console.log('Amount too small:', transaction.transferAmount);
        return;
    }

    // 2. Parse Content
    const content = transaction.content || '';

    // Match strict UUID (with or without hyphens)
    // Supports: 
    // - f8f3a7da-f4e8-4af6-a5ba-72a6e3cef9bb
    // - f8f3a7daf4e84af6a5ba72a6e3cef9bb
    const match = content.match(/VIP\s+([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/i);

    if (!match) {
        console.log('Invalid content format or User ID not found:', content);
        return;
    }

    let userId = match[1];

    // Normalize UUID: If missing hyphens, insert them
    if (userId.indexOf('-') === -1 && userId.length === 32) {
        userId = `${userId.substr(0, 8)}-${userId.substr(8, 4)}-${userId.substr(12, 4)}-${userId.substr(16, 4)}-${userId.substr(20)}`;
        console.log('Normalized User ID:', userId);
    }

    try {
        // 3. Find or create transaction record
        const existingTransactions = await PaymentTransaction.findByUserId(userId);
        const pendingTransaction = existingTransactions.find(t => t.status === 'pending');

        if (pendingTransaction) {
            // Mark as completed
            await PaymentTransaction.markAsCompleted(pendingTransaction.transaction_id);
            console.log(`Transaction ${pendingTransaction.transaction_id} marked as completed`);
        } else {
            // Create new completed transaction
            const newTransaction = await PaymentTransaction.create(userId, transaction.transferAmount, 10);
            await PaymentTransaction.markAsCompleted(newTransaction.transactionId);
            console.log(`New transaction ${newTransaction.transactionId} created and completed`);
        }

        // 4. Publish Event to Kafka
        await producer.send({
            topic: 'payment.success',
            messages: [
                {
                    key: userId,
                    value: JSON.stringify({
                        userId: userId,
                        amount: transaction.transferAmount,
                        transactionId: transaction.id || transaction.referenceCode,
                        timestamp: new Date().toISOString()
                    })
                }
            ]
        });
        console.log(`Payment processed for User ${userId}, event sent to Kafka.`);
    } catch (error) {
        console.error('Failed to process payment:', error);
        throw error;
    }
};

module.exports = { processPayment };