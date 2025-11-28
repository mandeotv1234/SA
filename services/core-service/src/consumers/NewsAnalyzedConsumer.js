const kafka = require('../config/kafka');
const db = require('../config/db');

const groupId = process.env.KAFKA_GROUP_ID || 'core-service-news-consumer';
const consumer = kafka.consumer({ groupId });

const TOPIC = process.env.NEWS_ANALYZED_TOPIC || 'news_analyzed';
const BATCH_SIZE = Number(process.env.NEWS_CONSUMER_BATCH_SIZE || 100);
const FLUSH_INTERVAL = Number(process.env.NEWS_CONSUMER_FLUSH_MS || 2000);

let messageBuffer = [];
let flushTimer = null;
let running = false;

const flushBufferToDB = async () => {
  if (messageBuffer.length === 0) return;
  const currentBatch = messageBuffer.splice(0, messageBuffer.length);

  const client = await db.pool.connect();
  try {
    const values = [];
    const placeholders = currentBatch.map((item, index) => {
      const i = index * 6;
      // time, url, source, title, sentiment_score, raw_score
      values.push(item.time);
      values.push(item.url);
      values.push(item.source);
      values.push(item.title);
      values.push(item.sentiment_score);
      values.push(JSON.stringify(item.raw_score));
      return `($${i+1}, $${i+2}, $${i+3}, $${i+4}, $${i+5}, $${i+6})`;
    }).join(',');

    const queryText = `
      INSERT INTO news_sentiment (time, url, source, title, sentiment_score, raw_score)
      VALUES ${placeholders}
      ON CONFLICT DO NOTHING;
    `;

    await client.query(queryText, values);
    console.log(`Saved ${currentBatch.length} news_sentiment rows to DB`);
  } catch (err) {
    console.error('Error inserting news_sentiment batch:', err);
    // requeue
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

const normalizeSentiment = (payload) => {
  // Accept multiple shapes. Prefer explicit sentiment_score and sentiment_label.
  let label = payload.sentiment_label || payload.label || null;
  let score = payload.sentiment_score || payload.score || null;
  const raw = payload.raw || payload.raw_score || payload.sentiment || payload;

  // If score is an object with probabilities, compute signed score
  if (score && typeof score === 'object') {
    // if structure like {pos: 0.8, neg: 0.1, neu:0.1}
    const pos = Number(score.pos || score.positive || 0);
    const neg = Number(score.neg || score.negative || 0);
    // signed score = pos - neg
    return { signed: pos - neg, raw };
  }

  // if raw contains probs
  if (!score && raw && typeof raw === 'object') {
    const pos = Number(raw.pos || raw.positive || 0);
    const neg = Number(raw.neg || raw.negative || 0);
    if (pos || neg) return { signed: pos - neg, raw };
  }

  // numeric score present
  if (score !== null && !isNaN(Number(score))) {
    let s = Number(score);
    if (label && typeof label === 'string') {
      const l = label.toLowerCase();
      if (l === 'negative' || l === 'neg') s = -Math.abs(s);
      if (l === 'neutral') s = 0.0;
    }
    return { signed: s, raw };
  }

  // fallback zero
  return { signed: 0.0, raw };
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
        // Expected payload fields: url, title, published_at, source, sentiment_label, sentiment_score, raw
        const time = payload.published_at ? new Date(payload.published_at) : new Date();
        const url = payload.url || payload.link || null;
        if (!url) return;
        const title = payload.title || null;
        const source = payload.source || null;

        const { signed, raw } = normalizeSentiment(payload);

        messageBuffer.push({ time, url, source, title, sentiment_score: signed, raw_score: raw });

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
        console.error('Error processing news_analyzed message:', err);
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
    console.log('NewsAnalyzedConsumer shut down cleanly');
  } catch (err) {
    console.error('Error during news consumer shutdown:', err);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = run;
