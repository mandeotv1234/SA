const { Kafka, CompressionTypes, Partitioners } = require('kafkajs');

const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const TOPIC = process.env.MARKET_DATA_TOPIC || 'market_data';
const LOG_PRODUCE = (process.env.LOG_PRODUCE || 'false') === 'true';

const kafka = new Kafka({ 
  clientId: process.env.KAFKA_CLIENT_ID || 'stream-service', 
  brokers: BROKERS,
  connectionTimeout: 3000, 
  retry: { initialRetryTime: 100, retries: 8 }
});

// use legacy partitioner to silence v2 warning / keep previous partitioning behavior
const producer = kafka.producer({
  allowAutoTopicCreation: false,
  idempotent: true,
  createPartitioner: Partitioners.LegacyPartitioner
});

let connected = false;

async function initProducer() {
  if (!connected) {
    await producer.connect();
    connected = true;
    console.log('Kafka producer connected to', BROKERS);
  }
}

function sendPriceEvent(event) {
  if (!connected) {
    if (LOG_PRODUCE) console.warn('Kafka producer not connected, dropping event', event && event.symbol);
    return;
  }

  if (LOG_PRODUCE) console.debug('Producing event', event.symbol, event.kline && event.kline.closeTime);

  producer.send({
    topic: TOPIC,
    compression: CompressionTypes.GZIP,
    messages: [{ key: String(event.symbol || ''), value: JSON.stringify(event) }]
  }).then((meta) => {
    if (LOG_PRODUCE) console.debug('Kafka send success', JSON.stringify(meta));
  }).catch(err => {
    console.error('Kafka async send failed', err);
  });
}

async function disconnectProducer() {
  if (connected) {
    await producer.disconnect();
    connected = false;
  }
}

module.exports = { initProducer, sendPriceEvent, disconnectProducer };