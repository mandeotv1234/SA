require('dotenv').config();
const { Kafka } = require('kafkajs');

const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const kafka = new Kafka({
    clientId: 'payment-service',
    brokers: BROKERS,
    retry: {
        initialRetryTime: 100,
        retries: 8
    }
});

const producer = kafka.producer();
const admin = kafka.admin();

const connectProducer = async () => {
    try {
        await producer.connect();
        console.log('Kafka Producer connected');
    } catch (error) {
        console.error('Error connecting Kafka Producer:', error);
    }
};

const createTopics = async () => {
    try {
        await admin.connect();
        const topics = await admin.listTopics();
        if (!topics.includes('payment.success')) {
            await admin.createTopics({
                topics: [{ topic: 'payment.success', numPartitions: 1 }]
            });
            console.log('Created topic: payment.success');
        }
        await admin.disconnect();
    } catch (error) {
        console.error('Error creating topics:', error);
    }
};

module.exports = { producer, connectProducer, createTopics };
