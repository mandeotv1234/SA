const { Kafka } = require('kafkajs');

const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const kafka = new Kafka({
    clientId: 'stream-service-consumer',
    brokers: BROKERS,
    retry: {
        initialRetryTime: 100,
        retries: 8
    }
});

const consumer = kafka.consumer({ groupId: 'stream-service-group' });

const initConsumer = async (io) => {
    try {
        await consumer.connect();
        console.log('Stream Service Kafka Consumer connected');

        await consumer.subscribe({ topic: 'user.events', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const rawMessage = message.value.toString();
                    console.log('Stream Service received:', rawMessage);
                    const payload = JSON.parse(rawMessage);

                    if (payload.event === 'user.upgraded') {
                        const { userId } = payload;
                        console.log(`Broadcasting vip_update to user_${userId}`);
                        io.to(`user_${userId}`).emit('vip_update', { isVip: true });
                    }

                } catch (err) {
                    console.error('Error processing Kafka message:', err);
                }
            },
        });
    } catch (error) {
        console.error('Failed to init Kafka Consumer:', error);
    }
};

module.exports = { initConsumer };
