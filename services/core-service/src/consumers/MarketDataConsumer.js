const kafka = require('../config/kafka'); // should export a Kafka instance (from kafkajs)
const db = require('../config/db');

const groupId = process.env.KAFKA_GROUP_ID || 'core-service-market-consumer';
const consumer = kafka.consumer({ groupId });

const TOPIC = process.env.MARKET_DATA_TOPIC || 'market_data'; // align with stream-service
const BATCH_SIZE = Number(process.env.MARKET_CONSUMER_BATCH_SIZE || 100);
const FLUSH_INTERVAL = Number(process.env.MARKET_CONSUMER_FLUSH_MS || 2000);

let messageBuffer = [];
let flushTimer = null;
let running = false;

const flushBufferToDB = async () => {
  if (messageBuffer.length === 0) return;

  // take snapshot of buffer and reset immediately to accept new messages
  const currentBatch = messageBuffer.splice(0, messageBuffer.length);

  const client = await db.pool.connect();
  try {
    const values = [];
    const placeholders = currentBatch.map((kline, index) => {
      const i = index * 7;
      // time: use closeTime if available (represents candle end), otherwise openTime
      const timeMs = (kline.closeTime || kline.C || kline.closeTime === 0) ? kline.closeTime : kline.openTime;
      values.push(new Date(Number(timeMs))); // time
      values.push(String(kline.symbol || kline.s).toUpperCase()); // symbol
      values.push(parseFloat(kline.open)); // open
      values.push(parseFloat(kline.high)); // high
      values.push(parseFloat(kline.low)); // low
      values.push(parseFloat(kline.close)); // close
      values.push(parseFloat(kline.volume)); // volume
      return `($${i+1}, $${i+2}, $${i+3}, $${i+4}, $${i+5}, $${i+6}, $${i+7})`;
    }).join(',');

    const queryText = `
      INSERT INTO market_klines (time, symbol, open, high, low, close, volume)
      VALUES ${placeholders}
      ON CONFLICT (time, symbol) DO UPDATE 
      SET close = EXCLUDED.close, 
          high = GREATEST(market_klines.high, EXCLUDED.high),
          low = LEAST(market_klines.low, EXCLUDED.low),
          volume = EXCLUDED.volume;
    `;

    await client.query(queryText, values);
    console.log(`Saved ${currentBatch.length} klines to DB`);
  } catch (err) {
    console.error('Error batch inserting klines:', err);
    // in case of failure, re-insert currentBatch back to messageBuffer head for retry
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
  // supported incoming shapes:
  // 1) normalized: { symbol, interval, kline: { openTime, closeTime, open, high, low, close, volume, isFinal } }
  // 2) stream-service may send { symbol, kline: {...} } -> handle above
  // 3) raw Binance combined message: { stream, data: { e: 'kline', k: {...} } }
  // 4) raw payload with k: {...}
  if (!payload) return null;

  if (payload.kline && typeof payload.kline === 'object') {
    const k = payload.kline;
    return {
      symbol: payload.symbol || k.s,
      openTime: k.openTime || k.openTime || k.t || k.T || k.o ? k.openTime : undefined,
      closeTime: k.closeTime || k.closeTime || k.T || k.closeTime,
      open: k.open || k.o || k.O,
      high: k.high || k.h,
      low: k.low || k.l,
      close: k.close || k.c,
      volume: k.volume || k.v,
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
      isFinal: !!kObj.x
    };
  }

  // fallback: if payload has fields directly
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
      isFinal: payload.x || payload.isFinal || false
    };
  }

  return null;
};

const run = async () => {
  if (running) return;
  running = true;

  await consumer.connect();
  console.log('Kafka Consumer connected, subscribing to', TOPIC);

  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        // extract normalized kline object
        const kline = extractKline(payload);
        if (!kline) return; // ignore non-kline messages

        // push into buffer (we store simplified shape expected by DB builder)
        messageBuffer.push({
          symbol: kline.symbol,
          openTime: kline.openTime,
          closeTime: kline.closeTime,
          open: kline.open,
          high: kline.high,
          low: kline.low,
          close: kline.close,
          volume: kline.volume
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
        console.error('Error processing message:', err);
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
    console.log('MarketDataConsumer shut down cleanly');
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = run;