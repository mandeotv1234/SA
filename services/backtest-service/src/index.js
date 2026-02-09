const express = require('express');
const cors = require('cors');
const db = require('./config/db');
const backtestRoutes = require('./routes/backtestRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'backtest-service' });
});

// Routes
app.use('/v1/backtest', backtestRoutes);

// Error handling
app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Database initialization
async function initDB() {
    try {
        await db.query('SELECT NOW()');
        console.log('[DB] Database connected successfully');
    } catch (err) {
        console.error('[DB ERROR] Failed to connect:', err.message);
        process.exit(1);
    }
}

const PORT = process.env.PORT || 8005;

app.listen(PORT, async () => {
    await initDB();
    console.log(`[BACKTEST SERVICE] Running on port ${PORT}`);
});
