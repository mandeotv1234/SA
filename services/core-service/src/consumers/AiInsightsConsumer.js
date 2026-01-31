const kafka = require('../config/kafka');
const db = require('../config/db');

const groupId = process.env.AI_INSIGHTS_CONSUMER_GROUP_ID || 'core-service-ai-insights-consumer-v3';
const consumer = kafka.consumer({ groupId });

const TOPIC = process.env.AI_INSIGHTS_TOPIC || 'ai_insights';

const run = async () => {
  await consumer.connect();
  console.log('AiInsightsConsumer connected, subscribing to', TOPIC);
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        const time = new Date();

        console.log(`[AI-INSIGHTS-RECEIVED] Topic: ${topic}, Partition: ${partition}, Offset: ${message.offset}`);

        // Determine type - support both old and new formats
        let type = payload.type || 'unknown';
        let body = payload;

        // Handle nested insight format (old causal events)
        if (payload.insight) {
          body = payload.insight;
        }

        // Handle new prediction format with meta/predictions
        if (payload.meta && payload.predictions) {
          type = 'aggregated_prediction';
          const meta = payload.meta;
          const predictions = payload.predictions || [];
          console.log(`[PREDICTION-RECEIVED] ${predictions.length} symbols | Sentiment: ${meta.market_sentiment_label} (${meta.market_sentiment_score})`);
          predictions.forEach(p => {
            const forecast = p.forecast?.next_1h || {};
            console.log(`  ${p.symbol}: ${forecast.direction} @ ${p.current_price} (Conf: ${forecast.confidence}%)`);
          });
        } else if (type === 'aggregated_prediction') {
          // Old format
          const predictions = payload.predictions || [];
          console.log(`[AGGREGATED] Received prediction for ${predictions.length} symbols`);
          predictions.forEach(p => {
            console.log(`  ${p.symbol}: ${p.direction} (${p.change_percent}%)`);
          });
        } else if (type === 'causal_event') {
          console.log(`[CAUSAL] ${body.title?.substring(0, 50)}...`);
        } else {
          console.log(`[${type}] Received insight`);
        }

        const client = await db.pool.connect();
        try {
          // Extract symbol for per-symbol predictions
          let symbol = null;

          // Try to get symbol from meta (new format)
          if (payload.meta && payload.meta.symbol) {
            symbol = payload.meta.symbol;
          }
          // Or from first prediction
          else if (payload.predictions && payload.predictions.length > 0) {
            symbol = payload.predictions[0].symbol;
          }

          await client.query(
            `INSERT INTO ai_insights (time, type, symbol, payload) VALUES ($1, $2, $3, $4)`,
            [time, type, symbol, JSON.stringify(body)]
          );

          const symbolInfo = symbol ? ` symbol='${symbol}'` : '';
          console.log(`[DB-INSERTED] AI insight type='${type}'${symbolInfo} saved to database`);
        } catch (err) {
          console.error('[DB-ERROR] Error inserting ai_insight:', err);
        } finally {
          client.release();
        }
      } catch (err) {
        console.error('[CONSUMER-ERROR] Error processing ai_insights message:', err);
      }
    }
  });
};

const shutdown = async () => {
  try {
    await consumer.disconnect();
    console.log('AiInsightsConsumer shut down');
  } catch (err) {
    console.error('Error on AiInsightsConsumer shutdown:', err);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = run;
