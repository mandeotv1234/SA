const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const WebSocket = require('ws');
const cron = require('node-cron');
const http = require('http');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Database connection
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: 5432,
    database: process.env.POSTGRES_DB || 'investment_db',
    user: process.env.POSTGRES_USER || 'dev',
    password: process.env.POSTGRES_PASSWORD || 'dev',
});

// Kafka setup
const kafka = new Kafka({
    clientId: 'investment-service',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'investment-service-group-v3' });

// Pending requests map
const pendingAnalysisRequests = new Map(); // requestId -> { resolve, reject, timeout }

// Initialize database
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS investments (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        usdt_amount DECIMAL(20, 8) NOT NULL,
        coin_amount DECIMAL(20, 8) NOT NULL,
        buy_price DECIMAL(20, 8) NOT NULL,
        buy_time TIMESTAMP NOT NULL DEFAULT NOW(),
        sell_price DECIMAL(20, 8),
        sell_time TIMESTAMP,
        target_sell_time TIMESTAMP NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        ai_prediction JSONB,
        ai_advice TEXT,
        actual_profit_usdt DECIMAL(20, 8),
        predicted_profit_usdt DECIMAL(20, 8),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_investments_user ON investments(user_id);
      CREATE INDEX IF NOT EXISTS idx_investments_status ON investments(status);
      CREATE INDEX IF NOT EXISTS idx_investments_target_sell ON investments(target_sell_time);
    `);
        console.log('[DB] Investment database initialized');
    } finally {
        client.release();
    }
}

// Get current price from stream service
async function getCurrentPrice(symbol) {
    try {
        const response = await axios.get(`http://core-service:3000/v1/klines?symbol=${symbol}&interval=1m&limit=1`);
        if (response.data && response.data.length > 0) {
            return parseFloat(response.data[0].close);
        }
        throw new Error('No price data found');
    } catch (error) {
        console.error(`[ERROR] Failed to get price for ${symbol}:`, error.message);
        return 50000 + Math.random() * 1000;
    }
}

// Get latest AI prediction from Kafka topic
let latestAIPrediction = null;

async function consumeKafkaTopics() {
    await consumer.connect();
    // Subscribe to multiple topics
    await consumer.subscribe({ topics: ['ai_insights', 'investment.analysis.result'], fromBeginning: true });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            try {
                const payload = JSON.parse(message.value.toString());

                if (topic === 'ai_insights') {
                    if (payload.type === 'aggregated_prediction') {
                        // Only update if we have valid predictions
                        if (payload.predictions && Array.isArray(payload.predictions) && payload.predictions.length > 0) {
                            latestAIPrediction = payload;
                            console.log(`[KAFKA] Received AI prediction update (${payload.predictions.length} symbols)`);
                        } else {
                            console.warn('[KAFKA] Received empty AI prediction, ignoring update');
                        }
                    }
                } else if (topic === 'investment.analysis.result') {
                    // Handle analysis result
                    const requestId = payload.requestId;
                    if (requestId && pendingAnalysisRequests.has(requestId)) {
                        const { resolve, timeout } = pendingAnalysisRequests.get(requestId);
                        clearTimeout(timeout);
                        pendingAnalysisRequests.delete(requestId);
                        resolve(payload);
                        console.log(`[KAFKA] Resolved analysis request ${requestId}`);
                    }
                }
            } catch (error) {
                console.error('[KAFKA ERROR]', error);
            }
        },
    });
}

// Fetch latest prediction from Core Service (Warmup/Fallback)
async function fetchLatestPredictionFromCore() {
    try {
        // Correct endpoint for core-service
        const url = 'http://core-service:3000/v1/insights/internal?type=aggregated_prediction&limit=1';
        const res = await axios.get(url);
        if (res.data && res.data.rows && res.data.rows.length > 0) {
            const row = res.data.rows[0];
            if (row.payload && row.payload.predictions && row.payload.predictions.length > 0) {
                latestAIPrediction = row.payload;
                console.log(`[WARMUP] Loaded latest prediction from Core Service (${row.payload.predictions.length} symbols)`);
            } else {
                console.warn('[WARMUP] Latest prediction from Core Service is empty or invalid, skipping update');
            }
        }
    } catch (e) {
        console.error('[WARMUP ERROR] Failed to fetch from core-service:', e.message);
    }
}

// Get AI prediction for specific symbol
async function getAIPredictionForSymbol(symbol) {
    // Check if we need to fetch/refetch data
    if (!latestAIPrediction || !latestAIPrediction.predictions || latestAIPrediction.predictions.length === 0) {
        console.log('[AI] Current prediction data is missing or empty. Fetching from Core Service...');
        await fetchLatestPredictionFromCore();

        if (!latestAIPrediction || !latestAIPrediction.predictions || latestAIPrediction.predictions.length === 0) {
            console.warn('[AI] No valid prediction data available even after fetch');
            return null;
        }
    }

    // Check if predictions array is empty (double check)
    if (!Array.isArray(latestAIPrediction.predictions) || latestAIPrediction.predictions.length === 0) {
        console.warn('[AI] Predictions array is empty - AI service is still processing');
        return null;
    }

    const pred = latestAIPrediction.predictions.find(p => p.symbol === symbol);
    if (!pred) {
        console.warn(`[AI] No prediction found for ${symbol} in ${latestAIPrediction.predictions.length} available predictions`);
    }
    return pred || null;
}

// Helper: Perform Investment Analysis Logic
async function analyzeInvestmentLogic(symbol, usdt_amount, target_sell_time) {
    const buyPrice = await getCurrentPrice(symbol);
    const coinAmount = usdt_amount / buyPrice;

    // Get AI prediction - REQUIRED
    const aiPred = await getAIPredictionForSymbol(symbol);

    if (!aiPred) {
        throw new Error('AI_SERVICE_UNAVAILABLE');
    }
    try {
        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const analysisPayload = {
            requestId,
            symbol,
            amount: parseFloat(usdt_amount),
            buy_price: buyPrice,
            target_sell_time,
            current_time: new Date().toISOString(),
            market_prediction: aiPred
        };

        // Send to Kafka
        await producer.send({
            topic: 'investment.analysis.request',
            messages: [{ key: requestId, value: JSON.stringify(analysisPayload) }]
        });

        // Wait for reply with 120s timeout
        aiAnalysis = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (pendingAnalysisRequests.has(requestId)) {
                    pendingAnalysisRequests.delete(requestId);
                    resolve(null);
                    console.warn(`[KAFKA TIMEOUT] Analysis request ${requestId} timed out`);
                }
            }, 120000); // 120 seconds timeout

            pendingAnalysisRequests.set(requestId, { resolve, reject, timeout });
        });
    } catch (err) {
        console.error('[AI ANALYSIS ERROR]', err.message);
    }

    // Process Result
    let predictedPrice, predictedProfitUsdt, aiAdvice, predictedPercent;

    if (aiAnalysis && !aiAnalysis.error) {
        // Got response from AI service
        predictedPrice = aiAnalysis.predicted_price;
        predictedProfitUsdt = aiAnalysis.predicted_profit_usdt;
        aiAdvice = aiAnalysis.advice;
        predictedPercent = aiAnalysis.predicted_profit_percent;

        const displayDirection = aiAnalysis.details?.direction || aiPred.direction;
        const displayConfidence = aiAnalysis.details?.confidence || aiPred.confidence;

        // Enrich aiPred
        aiPred.direction = displayDirection;
        aiPred.confidence = displayConfidence;
        aiPred.change_percent = predictedPercent;
    } else {
        // Fallback calculation
        predictedPrice = buyPrice + (buyPrice * ((aiPred.change_percent || 0) / 100));
        predictedProfitUsdt = (predictedPrice - buyPrice) * coinAmount;
        predictedPercent = aiPred.change_percent || 0;

        aiAdvice = generateAdvice(aiPred, buyPrice, usdt_amount);
    }

    return {
        buyPrice,
        coinAmount,
        aiPred,
        aiAdvice,
        predictedPrice,
        predictedProfitUsdt,
        predictedPercent
    };
}

// POST /v1/investments/analyze - Preview analysis only
app.post('/v1/investments/analyze', async (req, res) => {
    const { symbol, usdt_amount, target_sell_time } = req.body;
    if (!symbol || !usdt_amount || !target_sell_time) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const result = await analyzeInvestmentLogic(symbol, usdt_amount, target_sell_time);

        res.json({
            ai_recommendation: {
                advice: result.aiAdvice,
                predicted_price: result.predictedPrice,
                predicted_profit_usdt: result.predictedProfitUsdt,
                predicted_profit_percent: result.predictedPercent,
                confidence: result.aiPred.confidence,
                direction: result.aiPred.direction,
                causal_factor: result.aiPred.causal_factor,
                buy_price: result.buyPrice // Expose buy price context
            }
        });
    } catch (err) {
        if (err.message === 'AI_SERVICE_UNAVAILABLE') {
            return res.status(503).json({
                error: 'Hệ thống AI đang khởi động. Vui lòng thử lại sau 1-2 phút.',
                error_code: 'AI_SERVICE_UNAVAILABLE',
                details: 'AI service is processing market data. Please wait a moment and try again.'
            });
        }
        res.status(500).json({ error: err.message });
    }
});

// POST /v1/investments - Create new investment simulation
app.post('/v1/investments', async (req, res) => {
    const { user_id, symbol, usdt_amount, target_sell_time, ai_analysis } = req.body;

    if (!user_id || !symbol || !usdt_amount || !target_sell_time) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        let buyPrice, coinAmount, aiPred, aiAdvice, predictedProfitUsdt, predictedPrice, predictedPercent;

        if (ai_analysis) {
            console.log(`[INVESTMENT] Using pre-calculated analysis for ${symbol}`);
            buyPrice = ai_analysis.buy_price || await getCurrentPrice(symbol);
            coinAmount = usdt_amount / buyPrice;
            aiAdvice = ai_analysis.advice;
            predictedProfitUsdt = ai_analysis.predicted_profit_usdt;
            predictedPrice = ai_analysis.predicted_price;
            predictedPercent = ai_analysis.predicted_profit_percent;

            // Reconstruct aiPred for DB
            aiPred = {
                symbol,
                direction: ai_analysis.direction,
                confidence: ai_analysis.confidence,
                change_percent: predictedPercent,
                causal_factor: ai_analysis.causal_factor,
                reason: ai_analysis.reason
            };
        } else {
            console.log(`[INVESTMENT] Performing new analysis for ${symbol}`);
            const analysis = await analyzeInvestmentLogic(symbol, usdt_amount, target_sell_time);
            buyPrice = analysis.buyPrice;
            coinAmount = analysis.coinAmount;
            aiPred = analysis.aiPred;
            aiAdvice = analysis.aiAdvice;
            predictedProfitUsdt = analysis.predictedProfitUsdt;
            predictedPrice = analysis.predictedPrice;
            predictedPercent = analysis.predictedPercent;
        }

        // Insert investment
        const result = await pool.query(`
      INSERT INTO investments (
        user_id, symbol, usdt_amount, coin_amount, buy_price, target_sell_time,
        ai_prediction, ai_advice, predicted_profit_usdt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [user_id, symbol, usdt_amount, coinAmount, buyPrice, target_sell_time,
            JSON.stringify(aiPred), aiAdvice, predictedProfitUsdt]);

        const investment = result.rows[0];

        // Send notification to user via WebSocket
        sendToUser(user_id, {
            type: 'investment_created',
            investment: investment,
            ai_recommendation: {
                advice: aiAdvice,
                predicted_price: predictedPrice,
                predicted_profit_usdt: predictedProfitUsdt,
                predicted_profit_percent: predictedPercent,
                confidence: aiPred.confidence,
                direction: aiPred.direction
            }
        });

        res.json({
            investment: investment,
            ai_recommendation: {
                advice: aiAdvice,
                predicted_price: predictedPrice,
                predicted_profit_usdt: predictedProfitUsdt,
                predicted_profit_percent: predictedPercent,
                confidence: aiPred.confidence,
                direction: aiPred.direction,
                causal_factor: aiPred.causal_factor,
                reason: aiPred.reason
            }
        });

    } catch (err) {
        console.error('[ERROR] Create investment failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// SSE Clients map
const sseClients = new Map(); // userId -> [{ res, id }]

// GET /v1/investments/events - SSE Endpoint
app.get('/v1/investments/events', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).send('Missing user_id');

    // Headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable buffering for Nginx/Kong
        'Content-Encoding': 'identity', // Disable compression for SSE
        'Access-Control-Allow-Origin': '*' // Ensure CORS works for SSE
    });

    // Send initial connection message and ping to keep alive
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n'); // SSE comment to keep connection alive
    }, 30000);

    // Add client to map
    if (!sseClients.has(userId)) {
        sseClients.set(userId, []);
    }
    const clientId = Date.now();
    sseClients.get(userId).push({ res, id: clientId });

    console.log(`[SSE] User ${userId} connected. Total clients: ${sseClients.get(userId).length}`);

    // Remove client on close
    req.on('close', () => {
        clearInterval(heartbeat);
        const clients = sseClients.get(userId) || [];
        sseClients.set(userId, clients.filter(c => c.id !== clientId));
        if (sseClients.get(userId).length === 0) {
            sseClients.delete(userId);
        }
        console.log(`[SSE] User ${userId} disconnected. Remaining clients: ${sseClients.get(userId)?.length || 0}`);
    });
});

// Helper: Send message to user via SSE
function sendToUser(userId, data) {
    const clients = sseClients.get(userId);
    if (!clients || clients.length === 0) return;

    console.log(`[SSE] Sending ${data.type} to user ${userId} (${clients.length} clients)`);
    clients.forEach(client => {
        try {
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
            console.error(`[SSE ERROR] Send failed:`, err.message);
        }
    });
}

// GET /v1/investments/:user_id - Get user's investments
app.get('/v1/investments/:user_id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM investments WHERE user_id = $1 ORDER BY created_at DESC',
            [req.params.user_id]
        );
        res.json({ investments: result.rows });
    } catch (error) {
        console.error('[ERROR] Get investments failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /v1/investments/:id/sell - Manually sell investment
app.post('/v1/investments/:id/sell', async (req, res) => {
    const { id } = req.params;

    try {
        const investment = await pool.query(
            'SELECT * FROM investments WHERE id = $1 AND status = $2',
            [id, 'active']
        );

        if (investment.rows.length === 0) {
            return res.status(404).json({ error: 'Investment not found or already closed' });
        }

        await closeInvestment(investment.rows[0]);

        res.json({ message: 'Investment closed successfully' });
    } catch (error) {
        console.error('[ERROR] Sell investment failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Helper: Close investment and calculate results
async function closeInvestment(inv) {
    const sellPrice = await getCurrentPrice(inv.symbol);
    const sellValueUsdt = sellPrice * inv.coin_amount;
    const actualProfitUsdt = sellValueUsdt - inv.usdt_amount;
    const actualProfitPercent = (actualProfitUsdt / inv.usdt_amount) * 100;

    await pool.query(`
    UPDATE investments 
    SET sell_price = $1, sell_time = NOW(), status = 'closed', 
        actual_profit_usdt = $2, updated_at = NOW()
    WHERE id = $3
  `, [sellPrice, actualProfitUsdt, inv.id]);

    const accuracy = calculateAccuracy(actualProfitUsdt, inv.predicted_profit_usdt);

    // Publish to Kafka
    await producer.send({
        topic: 'investment_results',
        messages: [{
            key: inv.user_id,
            value: JSON.stringify({
                investment_id: inv.id,
                user_id: inv.user_id,
                symbol: inv.symbol,
                usdt_invested: parseFloat(inv.usdt_amount),
                actual_profit_usdt: parseFloat(actualProfitUsdt),
                actual_profit_percent: actualProfitPercent,
                predicted_profit_usdt: parseFloat(inv.predicted_profit_usdt),
                ai_accuracy: accuracy,
                buy_price: parseFloat(inv.buy_price),
                sell_price: parseFloat(sellPrice),
                buy_time: inv.buy_time,
                sell_time: new Date(),
                result: actualProfitUsdt >= 0 ? 'profit' : 'loss'
            })
        }]
    });

    // Send WebSocket notification
    sendToUser(inv.user_id, {
        type: 'investment_closed',
        investment_id: inv.id,
        symbol: inv.symbol,
        result: actualProfitUsdt >= 0 ? 'profit' : 'loss',
        actual_profit_usdt: actualProfitUsdt,
        actual_profit_percent: actualProfitPercent,
        predicted_profit_usdt: inv.predicted_profit_usdt,
        ai_accuracy: accuracy,
        message: `Đầu tư ${inv.symbol} đã đóng. ${actualProfitUsdt >= 0 ? 'Lời' : 'Lỗ'} ${Math.abs(actualProfitUsdt).toFixed(2)} USDT (${actualProfitPercent.toFixed(2)}%)`
    });

    console.log(`[CLOSE] Investment ${inv.id} closed. Profit: ${actualProfitUsdt} USDT`);
}

// Helper: Generate AI advice in Vietnamese
function generateAdvice(aiPred, buyPrice, usdtAmount) {
    const { change_percent, confidence, direction, reason, causal_factor } = aiPred;

    let advice = '';

    if (direction === 'UP' && confidence > 0.7) {
        advice = `✅ AI KHUYẾN NGHỊ ĐẦU TƯ\n`;
        advice += `Dự đoán giá sẽ TĂNG ${change_percent.toFixed(2)}% (độ tin cậy ${(confidence * 100).toFixed(0)}%)\n`;
        advice += `Lợi nhuận dự kiến: ${(usdtAmount * change_percent / 100).toFixed(2)} USDT\n`;
    } else if (direction === 'DOWN' && confidence > 0.7) {
        advice = `❌ AI KHÔNG KHUYẾN NGHỊ\n`;
        advice += `Dự đoán giá sẽ GIẢM ${Math.abs(change_percent).toFixed(2)}% (độ tin cậy ${(confidence * 100).toFixed(0)}%)\n`;
        advice += `Rủi ro lỗ: ${Math.abs(usdtAmount * change_percent / 100).toFixed(2)} USDT\n`;
    } else {
        advice = `⚠️ AI CHƯA RÕ RÀNG\n`;
        advice += `Thị trường không ổn định (độ tin cậy thấp: ${(confidence * 100).toFixed(0)}%)\n`;
        advice += `Nên thận trọng khi đầu tư.\n`;
    }

    if (reason) {
        advice += `\nLý do: ${reason}`;
    }
    if (causal_factor) {
        advice += `\nNguyên nhân: ${causal_factor}`;
    }

    return advice;
}

// Helper: Calculate accuracy
function calculateAccuracy(actual, predicted) {
    if (predicted === 0) return actual === 0 ? 100 : 0;
    const error = Math.abs((actual - predicted) / predicted);
    return Math.max(0, Math.min(100, (1 - error) * 100));
}


// Background job: Auto-close investments at target time
cron.schedule('* * * * *', async () => {
    console.log('[CRON] Checking for investments to auto-close...');

    try {
        const result = await pool.query(`
      SELECT * FROM investments 
      WHERE status = 'active' AND target_sell_time <= NOW()
    `);

        for (const inv of result.rows) {
            await closeInvestment(inv);
        }

        if (result.rows.length > 0) {
            console.log(`[CRON] Auto-closed ${result.rows.length} investments`);
        }
    } catch (error) {
        console.error('[CRON ERROR]', error);
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'investment-service' });
});

// Start server
const PORT = process.env.PORT || 8001;
server.listen(PORT, async () => {
    await initDB();
    await producer.connect();
    await fetchLatestPredictionFromCore(); // Warmup
    await consumeKafkaTopics();
    console.log(`[INVESTMENT SERVICE] Running on port ${PORT}`);
    console.log(`[WEBSOCKET] Ready for connections`);
});
