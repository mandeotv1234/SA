const { createPool } = require('../db/connection');

class PaymentTransaction {
    static async create(userId, amount, expiresInMinutes = 10) {
        const pool = createPool();
        const transactionId = `TXN_${Date.now()}_${userId}`;
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

        const result = await pool.query(
            'INSERT INTO payment_transactions (user_id, transaction_id, amount, status, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [userId, transactionId, amount, 'pending', expiresAt]
        );

        return {
            id: result.rows[0].id,
            userId,
            transactionId,
            amount,
            status: 'pending',
            expiresAt
        };
    }

    static async findByTransactionId(transactionId) {
        const pool = createPool();
        const result = await pool.query(
            'SELECT * FROM payment_transactions WHERE transaction_id = $1',
            [transactionId]
        );
        return result.rows[0] || null;
    }

    static async findByUserId(userId) {
        const pool = createPool();
        const result = await pool.query(
            'SELECT * FROM payment_transactions WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        return result.rows;
    }

    static async updateStatus(transactionId, status, completedAt = null) {
        const pool = createPool();
        const result = await pool.query(
            'UPDATE payment_transactions SET status = $1, completed_at = $2 WHERE transaction_id = $3',
            [status, completedAt, transactionId]
        );
        return result.rowCount > 0;
    }

    static async markAsCompleted(transactionId) {
        return this.updateStatus(transactionId, 'completed', new Date());
    }

    static async markAsExpired(transactionId) {
        return this.updateStatus(transactionId, 'expired');
    }

    static async expireOldTransactions() {
        const pool = createPool();
        const result = await pool.query(
            'UPDATE payment_transactions SET status = $1 WHERE status = $2 AND expires_at < NOW()',
            ['expired', 'pending']
        );
        return result.rowCount;
    }
}

module.exports = PaymentTransaction;
