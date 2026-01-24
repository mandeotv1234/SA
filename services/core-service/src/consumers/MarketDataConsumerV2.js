const kafka = require('../config/kafka');
const db = require('../config/db');

const groupId = process.env.MARKET_CONSUMER_GROUP_ID || process.env.KAFKA_GROUP_ID || 'core-service-market-consumer';
const consumer = kafka.consumer({ groupId });

const TOPIC = process.env.MARKET_DATA_TOPIC || 'market_data';
const BATCH_SIZE = Number(process.env.MARKET_CONSUMER_BATCH_SIZE || 100);
const FLUSH_INTERVAL = Number(process.env.MARKET_CONSUMER_FLUSH_MS || 2000);

let messageBuffer = [];
let flushTimer = null;
let running = false;

const flushBufferToDB = async () => {
    if (messageBuffer.length === 0) return;

    const currentBatch = messageBuffer.splice(0, messageBuffer.length);

    // Deduplicate batch: keep only the latest update for each (symbol, time) pair
    const uniqueMap = new Map();
    for (const kline of currentBatch) {
        const timeMs = kline.openTime || kline.t || kline.openTime === 0 ? kline.openTime : kline.closeTime;
        const key = `${String(kline.symbol).toUpperCase()}-${timeMs}`;
        uniqueMap.set(key, { ...kline, timeMs });
    }

    const uniqueBatch = Array.from(uniqueMap.values());

    const client = await db.pool.connect();
    try {
        const values = [];
        const placeholders = uniqueBatch.map((kline, index) => {
            const i = index * 8; // 8 fields including sequence
            values.push(new Date(Number(kline.timeMs))); // time
            values.push(String(kline.symbol).toUpperCase()); // symbol
            values.push(parseFloat(kline.open)); // open
            values.push(parseFloat(kline.high)); // high
            values.push(parseFloat(kline.low)); // low
            values.push(parseFloat(kline.close)); // close
            values.push(parseFloat(kline.volume)); // volume
            values.push(kline.seq || null); // sequence number from stream-service
            return `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7}, $${i + 8})`;
        }).join(',');

        const queryText = `
      INSERT INTO market_klines (time, symbol, open, high, low, close, volume, sequence)
      VALUES ${placeholders}
      ON CONFLICT (time, symbol) DO UPDATE 
      SET close = EXCLUDED.close, 
          high = GREATEST(market_klines.high, EXCLUDED.high),
          low = LEAST(market_klines.low, EXCLUDED.low),
          volume = EXCLUDED.volume,
          sequence = COALESCE(EXCLUDED.sequence, market_klines.sequence);
    `;

        await client.query(queryText, values);
        console.log(`[MarketDataConsumerV2] Saved ${uniqueBatch.length} klines with sequences (deduplicated from ${currentBatch.length})`);
    } catch (err) {
        console.error('[MarketDataConsumerV2] Error batch inserting klines:', err);
        messageBuffer = currentBatch.concat(messageBuffer);
    } finally {
        client.release();
    }
};

const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
        flushTimer = null;
        await flushBufferToDB();
    }, FLUSH_INTERVAL);
};

const extractKline = (payload) => {
    if (!payload) return null;

    // Handle normalized format with kline object
    if (payload.kline && typeof payload.kline === 'object') {
        const k = payload.kline;
        return {
            symbol: payload.symbol || k.s,
            openTime: k.openTime || k.t || k.T,
            closeTime: k.closeTime || k.T,
            open: k.open || k.o || k.O,
            high: k.high || k.h,
            low: k.low || k.l,
            close: k.close || k.c,
            volume: k.volume || k.v,
            seq: payload.seq || k.seq, // Extract sequence number
            isFinal: k.isFinal !== undefined ? k.isFinal : !!k.x
        };
    }

    // Binance style: payload.data.k or payload.k
    const kObj = (payload.data && payload.data.k) ? payload.data.k : (payload.k || payload.K);
    if (kObj) {
        return {
            symbol: kObj.s,
            openTime: kObj.t,
            closeTime: kObj.T,
            open: kObj.o,
            high: kObj.h,
            low: kObj.l,
            close: kObj.c,
            volume: kObj.v,
            seq: payload.seq || kObj.seq,
            isFinal: !!kObj.x
        };
    }

    // Fallback: direct fields
    if (payload.s && (payload.o || payload.c)) {
        return {
            symbol: payload.s,
            openTime: payload.t || payload.openTime,
            closeTime: payload.T || payload.closeTime,
            open: payload.o || payload.open,
            high: payload.h || payload.high,
            low: payload.l || payload.low,
            close: payload.c || payload.close,
            volume: payload.v || payload.volume,
            seq: payload.seq,
            isFinal: payload.x || payload.isFinal || false
        };
    }

    return null;
};

const run = async () => {
    if (running) return;
    running = true;

    await consumer.connect();
    console.log('[MarketDataConsumerV2] Kafka Consumer connected, subscribing to', TOPIC);

    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            try {
                const payload = JSON.parse(message.value.toString());
                const kline = extractKline(payload);
                if (!kline) return;

                messageBuffer.push({
                    symbol: kline.symbol,
                    openTime: kline.openTime,
                    closeTime: kline.closeTime,
                    open: kline.open,
                    high: kline.high,
                    low: kline.low,
                    close: kline.close,
                    volume: kline.volume,
                    seq: kline.seq // Include sequence number
                });

                if (messageBuffer.length >= BATCH_SIZE) {
                    if (flushTimer) {
                        clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    await flushBufferToDB();
                } else {
                    scheduleFlush();
                }
            } catch (err) {
                console.error('[MarketDataConsumerV2] Error processing message:', err);
            }
        }
    });
};

const shutdown = async () => {
    try {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        await flushBufferToDB();
        await consumer.disconnect();
        console.log('[MarketDataConsumerV2] Shut down cleanly');
    } catch (err) {
        console.error('[MarketDataConsumerV2] Error during shutdown:', err);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = run;
