const kafka = require('../config/kafka');
const db = require('../config/db');

const groupId = process.env.AI_INSIGHTS_CONSUMER_GROUP_ID || 'core-service-ai-insights-consumer';
const consumer = kafka.consumer({ groupId });

const TOPIC = process.env.AI_INSIGHTS_TOPIC || 'ai_insights';

const run = async () => {
  await consumer.connect();
  console.log('AiInsightsConsumer connected, subscribing to', TOPIC);
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        const time = new Date();

        // Determine type - support new aggregated_prediction format
        let type = payload.type || 'unknown';
        let body = payload;

        // Handle nested insight format
        if (payload.insight) {
          body = payload.insight;
        }

        // Log different types appropriately
        if (type === 'aggregated_prediction') {
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
          await client.query(
            `INSERT INTO ai_insights (time, type, payload) VALUES ($1, $2, $3)`,
            [time, type, JSON.stringify(body)]
          );
          console.log('Inserted ai_insight of type', type);
        } catch (err) {
          console.error('Error inserting ai_insight:', err);
        } finally {
          client.release();
        }
      } catch (err) {
        console.error('Error processing ai_insights message:', err);
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
