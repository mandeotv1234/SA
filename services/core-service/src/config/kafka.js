require('dotenv').config();
const { Kafka } = require('kafkajs');

const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'core-service',
  brokers: BROKERS,
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

module.exports = kafka;