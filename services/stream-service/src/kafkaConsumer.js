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

// Use a unique group ID for each instance to ensure ALL instances receive the price updates (Broadcast pattern)
const groupId = `stream-gateway-${Math.random().toString(36).substring(7)}`;

const consumer = kafka.consumer({ groupId });

const initConsumer = async (io) => {
    try {
        await consumer.connect();
        console.log(`Stream Gateway Consumer connected (Group: ${groupId})`);

        await consumer.subscribe({ topic: 'user.events', fromBeginning: false });
        await consumer.subscribe({ topic: 'market.prices', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const rawMessage = message.value.toString();
                    const payload = JSON.parse(rawMessage);

                    // Handle VIP User Events
                    if (topic === 'user.events') {
                        if (payload.event === 'user.upgraded') {
                            const { userId } = payload;
                            console.log(`Broadcasting vip_update to user_${userId}`);
                            io.to(`user_${userId}`).emit('vip_update', { isVip: true });
                        }
                    }

                    // Handle Market Price Events from Ingester
                    if (topic === 'market.prices') {
                        const symbolRoom = payload.symbol.toUpperCase();
                        io.to(symbolRoom).volatile.emit('price_event', payload);
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
