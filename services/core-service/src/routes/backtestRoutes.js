const express = require('express');
const router = express.Router();
const db = require('../config/db');
const BacktestEngine = require('../backtest/engine');
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Helper: Fetch candles from Binance API
const fetchBinanceCandles = async (symbol, interval, startTime, endTime) => {
    let allCandles = [];
    let currentStart = new Date(startTime).getTime();
    const endTimestamp = new Date(endTime).getTime();

    // Safety limit to prevent infinite loops (max ~20 requests for typical range)
    const MAX_REQUESTS = 50;
    let requests = 0;

    console.log(`[Backtest] Fetching Binance data for ${symbol} (${interval}) from ${startTime} to ${endTime}`);

    while (currentStart < endTimestamp && requests < MAX_REQUESTS) {
        try {
            // Binance Limit: 1000 per request
            const url = `https://api.binance.com/api/v3/klines`;
            const params = {
                symbol: symbol.toUpperCase(),
                interval: interval,
                startTime: currentStart,
                endTime: endTimestamp,
                limit: 1000
            };

            const res = await axios.get(url, { params });
            const data = res.data; // [[time, open, high, low, close, vol, ...], ...]

            if (!data || data.length === 0) break;

            const candles = data.map(c => ({
                time: new Date(c[0]),
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5])
            }));

            allCandles = allCandles.concat(candles);

            // Next start time = close time of last candle + 1
            const lastCloseTime = data[data.length - 1][6];
            // Or simpler: last Open Time + 1 is risky if gap. 
            // Binance returns Open Time at index 0.
            const lastOpenTime = data[data.length - 1][0];

            if (lastOpenTime >= endTimestamp) break;

            // Move pointer forward (handling potential gaps by just adding 1ms to last received candle?)
            // Robust way: last returned candle time + 1ms? No, + interval?
            // Binance klines startTime includes the candle starting at that time.
            // So next request should start at lastOpenTime + 1 (or + intervalMs).
            // Actually, if we received N candles, the last one started at T.
            // We want candles starting AFTER T.
            currentStart = lastOpenTime + 1;

            requests++;
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 50));
        } catch (e) {
            console.error('[Backtest] Binance fetch error:', e.message);
            // If error 429 (Rate Limit) -> break and return partial or throw
            break;
        }
    }

    // Deduplicate if any overlap (though loop logic should prevent it)
    // Optional
    return allCandles;
};

// Helper: Resample candles to larger timeframes
const resampleCandles = (candles, timeframe) => {
    if (!timeframe || timeframe === '1h') return candles;

    // Map timeframe to milliseconds
    const timeMap = {
        '15m': 15 * 60 * 1000,
        '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '12h': 12 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000
    };

    const intervalMs = timeMap[timeframe];
    // Default DB data is 1h (market_klines). 
    // We cannot resample 1h to 15m/30m accurately.
    // If target is smaller than 1h, and we are relying on DB fallback, this is an issue.
    // However, for now, let's just return empty or error to avoid misleading results.
    if (intervalMs < 60 * 60 * 1000) {
        console.warn(`[Backtest] Cannot resample 1h DB data to ${timeframe}. returning empty.`);
        return [];
    }

    if (!intervalMs) return candles;

    const resampled = [];
    let currentBucket = null;

    for (const candle of candles) {
        const candleTime = new Date(candle.time).getTime();
        // Snap time to grid
        const bucketStartTime = Math.floor(candleTime / intervalMs) * intervalMs;

        if (!currentBucket || currentBucket.time !== bucketStartTime) {
            if (currentBucket) {
                currentBucket.time = new Date(currentBucket.time);
                resampled.push(currentBucket);
            }

            // Start new bucket
            currentBucket = {
                time: bucketStartTime,
                open: Number(candle.open),
                high: Number(candle.high),
                low: Number(candle.low),
                close: Number(candle.close),
                volume: Number(candle.volume)
            };
        } else {
            // Aggregate
            currentBucket.high = Math.max(currentBucket.high, Number(candle.high));
            currentBucket.low = Math.min(currentBucket.low, Number(candle.low));
            currentBucket.close = Number(candle.close);
            currentBucket.volume += Number(candle.volume);
        }
    }

    if (currentBucket) {
        currentBucket.time = new Date(currentBucket.time);
        resampled.push(currentBucket);
    }

    return resampled;
};

// Middleware xác thực user (giả sử có middleware check header từ Kong hoặc tự decode)
const requireAuth = (req, res, next) => {
    // 1. Check if X-User-Id already exists (maybe from internal call or if Kong works)
    const kongUserId = req.headers['x-user-id'];
    if (kongUserId) {
        req.userId = kongUserId;
        return next();
    }

    // 2. Fallback: Parse Authorization Header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            // Since Kong already validated the signature, decode is safe for identity
            const decoded = jwt.decode(token);
            if (decoded && decoded.sub) {
                req.userId = decoded.sub;
                return next();
            }
        } catch (e) {
            console.error('Error decoding token', e);
        }
    }

    return res.status(401).json({ error: 'Unauthorized: Missing User Identity' });
};

// GET /v1/backtest/history - Lấy danh sách backtest của user
router.get('/history', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query(`
      SELECT id, strategy_name, symbol, start_date, end_date, win_rate, net_profit_percent, created_at
      FROM backtest_results
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [req.userId]);

        res.json(rows);
    } catch (err) {
        console.error('Error fetching backtest history:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /v1/backtest/:id - Lấy chi tiết 1 backtest
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { rows } = await db.query(`
      SELECT * FROM backtest_results
      WHERE id = $1 AND user_id = $2
    `, [req.params.id, req.userId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Backtest not found' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching backtest detail:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /v1/backtest/run - Chạy backtest mới
router.post('/run', requireAuth, async (req, res) => {
    const { strategy, symbol, start_date, end_date, initial_capital } = req.body;

    if (!strategy || !symbol || !start_date || !end_date) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
        console.log(`[BACKTEST] Starting backtest for ${symbol} from ${start_date} to ${end_date}`);

        // --- 1. FETCH CANDLES (Binance -> DB Fallback) ---
        let processedCandles = [];
        const timeframe = strategy.timeframe || '1h';

        // A. Try Binance
        try {
            processedCandles = await fetchBinanceCandles(symbol, timeframe, start_date, end_date);
            if (processedCandles.length > 0) {
                console.log(`[Backtest] Loaded ${processedCandles.length} candles from Binance.`);
            }
        } catch (binanceErr) {
            console.warn('[Backtest] Binance fetch failed:', binanceErr.message);
        }

        // B. Fallback to DB
        if (processedCandles.length === 0) {
            console.log('[Backtest] Fetching from DB (Fallback)...');
            const candlesResult = await db.query(
                `SELECT * FROM market_klines 
               WHERE symbol = $1 AND time >= $2 AND time <= $3 ORDER BY time ASC`,
                [symbol.toUpperCase(), start_date, end_date]
            );

            // Resample DB data (assuming DB has 1h data)
            processedCandles = resampleCandles(candlesResult.rows, timeframe);
            console.log(`[Backtest] Loaded ${processedCandles.length} candles from DB (Resampled).`);
        }

        if (processedCandles.length < 50) {
            return res.status(400).json({ error: "Insufficient historical data (checked Binance & DB)." });
        }

        // --- 2. FETCH PREDICTIONS & NEWS (Always from DB) ---
        // Predictions need to be matched with candle times? Engine handles strict time checks.
        // We fetch all predictions in range.
        const predictionsQuery = `
          SELECT time, direction_1h, confidence_1h, volatility
          FROM ai_predictions
          WHERE symbol = $1 AND time >= $2 AND time <= $3
          ORDER BY time ASC
        `;

        const newsQuery = `
          SELECT time, sentiment_score, title
          FROM news_sentiment
          WHERE time >= $1 AND time <= $2
          ORDER BY time ASC
        `;

        const [predictionsRes, newsRes] = await Promise.all([
            db.query(predictionsQuery, [symbol.toUpperCase(), start_date, end_date]),
            db.query(newsQuery, [start_date, end_date])
        ]);

        console.log(`[BACKTEST] Aux Data: ${predictionsRes.rows.length} predictions, ${newsRes.rows.length} news items`);

        // --- 3. RUN ENGINE ---
        const engine = new BacktestEngine(
            strategy,
            {
                candles: processedCandles,
                predictions: predictionsRes.rows,
                news: newsRes.rows
            },
            initial_capital || 10000
        );

        const results = engine.run();

        if (results.error) {
            return res.status(400).json({ error: results.error });
        }

        // --- 4. SAVE RESULTS ---
        const insertQuery = `
          INSERT INTO backtest_results (
            user_id, strategy_name, strategy_config, symbol, start_date, end_date, initial_capital,
            total_trades, winning_trades, losing_trades, win_rate, 
            total_profit, total_loss, net_profit, net_profit_percent,
            max_drawdown, sharpe_ratio, 
            trades, equity_curve, execution_time_ms, data_points_analyzed
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17,
            $18, $19, $20, $21
          ) RETURNING id
        `;

        const saved = await db.query(insertQuery, [
            req.userId,
            strategy.name || 'Untitled Strategy',
            JSON.stringify(strategy),
            symbol,
            start_date,
            end_date,
            initial_capital,
            results.total_trades,
            results.winning_trades,
            results.losing_trades,
            results.win_rate,
            results.total_profit,
            results.total_loss,
            results.net_profit,
            results.net_profit_percent,
            results.max_drawdown,
            results.sharpe_ratio,
            JSON.stringify(results.trades),
            JSON.stringify(results.equity_curve),
            results.execution_time_ms,
            results.data_points_analyzed
        ]);

        console.log(`[BACKTEST] Completed successfully. ID: ${saved.rows[0].id}`);

        res.json({ status: 'success', results, id: saved.rows[0].id });

    } catch (err) {
        console.error('Error running backtest:', err);
        res.status(500).json({ error: 'An unexpected error occurred' });
    }
});
module.exports = router;
