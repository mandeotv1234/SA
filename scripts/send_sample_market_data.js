const { Kafka } = require('kafkajs');

async function send() {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ brokers });
  const producer = kafka.producer();
  await producer.connect();
  const sample = {
    symbol: 'BTCUSDT',
    interval: '1m',
    kline: {
      openTime: Date.now() - 60000,
      closeTime: Date.now(),
      open: '30000',
      high: '30100',
      low: '29900',
      close: '30050',
      volume: '12.34'
    }
  };
  await producer.send({ topic: process.env.MARKET_DATA_TOPIC || 'market_data', messages: [{ value: JSON.stringify(sample) }] });
  console.log('sample sent');
  await producer.disconnect();
}

send().catch(err=>{ console.error(err); process.exit(1); });
