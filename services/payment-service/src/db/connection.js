require('dotenv').config();
const { Pool } = require('pg');

let pool;

const createPool = () => {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }
    return pool;
};

const initDB = async () => {
    const pool = createPool();
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_transactions (\n                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                transaction_id VARCHAR(255) UNIQUE,
                amount DECIMAL(10, 2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                payment_method VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                completed_at TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_user_id ON payment_transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_status ON payment_transactions(status);
            CREATE INDEX IF NOT EXISTS idx_transaction_id ON payment_transactions(transaction_id);
        `);
        console.log('Payment transactions table initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
};

module.exports = { createPool, initDB };
