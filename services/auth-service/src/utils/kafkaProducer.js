const { Kafka } = require('kafkajs');

const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',').map(b => b.trim());

const kafka = new Kafka({
    clientId: 'auth-service-producer',
    brokers: BROKERS,
    retry: {
        initialRetryTime: 100,
        retries: 8
    }
});

const producer = kafka.producer();

let producerReady = false;

async function initProducer() {
    try {
        await producer.connect();
        producerReady = true;
        console.log('[KAFKA PRODUCER] Connected');
    } catch (e) {
        console.error('[KAFKA PRODUCER ERROR]', e);
    }
}

async function publishUserSettingsUpdate(userId, email, notificationSettings) {
    if (!producerReady) {
        console.warn('[KAFKA] Producer not ready, skipping event');
        return;
    }

    try {
        await producer.send({
            topic: 'user_settings_updated',
            messages: [{
                key: userId,
                value: JSON.stringify({
                    user_id: userId,
                    email: email,
                    notification_settings: notificationSettings,
                    timestamp: new Date().toISOString()
                })
            }]
        });
        console.log(`[KAFKA] Published settings update for user ${userId}`);
    } catch (e) {
        console.error('[KAFKA PUBLISH ERROR]', e);
    }
}

module.exports = { initProducer, publishUserSettingsUpdate };
