const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'backtest-db',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'backtest_db',
    user: process.env.DB_USER || 'dev',
    password: process.env.DB_PASSWORD || 'dev123',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
    console.log('[DB] Connected to backtest database');
});

pool.on('error', (err) => {
    console.error('[DB ERROR]', err);
});

module.exports = pool;
