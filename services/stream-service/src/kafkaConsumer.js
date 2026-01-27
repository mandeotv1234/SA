const { Kafka } = require('kafkajs');
const { createClient } = require('redis');

const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Shared consumer group - only 1 instance will receive each message
const SHARED_GROUP_ID = 'stream-gateway-shared';
const REDIS_CHANNEL = 'market_prices';
const USER_EVENTS_CHANNEL = 'user_events';

let sequenceCounter = 0;
let redisPublisher, redisSubscriber;

const kafka = new Kafka({
    clientId: 'stream-service-consumer',
    brokers: BROKERS,
    retry: {
        initialRetryTime: 100,
        retries: 8
    }
});

const consumer = kafka.consumer({
    groupId: SHARED_GROUP_ID,
    sessionTimeout: 30000,
    heartbeatInterval: 3000
});

const initConsumer = async (io) => {
    try {
        // Setup Redis clients
        redisPublisher = createClient({ url: REDIS_URL });
        redisSubscriber = createClient({ url: REDIS_URL });

        await redisPublisher.connect();
        await redisSubscriber.connect();

        console.log('Redis clients connected');

        // Initialize sequence counter from Redis
        const lastSeq = await redisPublisher.get('last_sequence');
        sequenceCounter = lastSeq ? parseInt(lastSeq) : 0;
        console.log(`Sequence counter initialized to: ${sequenceCounter}`);

        // Subscribe to Redis for broadcasts from other instances
        await redisSubscriber.subscribe(REDIS_CHANNEL, (message) => {
            try {
                const data = JSON.parse(message);


                const symbolRoom = data.symbol.toUpperCase();
                const interval = (data.interval || '1m').toUpperCase();
                const intervalRoom = `${symbolRoom}_${interval}`;

                io.to(intervalRoom).volatile.emit('price_event', data);

                // Also emit to general symbol room for backward compatibility
                if (interval === '1M') {
                    io.to(symbolRoom).volatile.emit('price_event', data);
                }

                console.log(`Broadcasted ${data.symbol} seq:${data.seq} to room ${intervalRoom}`);
            } catch (err) {
                console.error('Error processing Redis message:', err);
            }
        });

        // Subscribe to user events channel
        await redisSubscriber.subscribe(USER_EVENTS_CHANNEL, (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'vip_update') {
                    io.to(`user_${data.userId}`).emit('vip_update', data.data);
                    console.log(`Broadcasted VIP update to user_${data.userId}`);
                }
            } catch (err) {
                console.error('Error processing user event:', err);
            }
        });

        // Connect to Kafka
        await consumer.connect();
        console.log(`Kafka Consumer connected (Shared Group: ${SHARED_GROUP_ID})`);

        await consumer.subscribe({ topic: 'market.prices', fromBeginning: false });
        await consumer.subscribe({ topic: 'user.events', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const payload = JSON.parse(message.value.toString());

                    if (topic === 'market.prices') {
                        // Add sequence number
                        sequenceCounter++;

                        const enrichedMessage = {
                            seq: sequenceCounter,
                            timestamp: Date.now(),
                            symbol: payload.symbol,
                            interval: payload.interval || '1m',
                            kline: payload.kline || payload
                        };

                        // Save sequence to Redis
                        await redisPublisher.set('last_sequence', sequenceCounter);

                        // Broadcast to all instances via Redis
                        await redisPublisher.publish(
                            REDIS_CHANNEL,
                            JSON.stringify(enrichedMessage)
                        );

                        console.log(`Published ${payload.symbol} seq:${sequenceCounter} to Redis`);

                    } else if (topic === 'user.events') {
                        // Handle user events (VIP upgrades, etc.)
                        if (payload.event === 'user.upgraded') {
                            const userMessage = {
                                type: 'vip_update',
                                userId: payload.userId,
                                data: { isVip: true }
                            };

                            await redisPublisher.publish(
                                USER_EVENTS_CHANNEL,
                                JSON.stringify(userMessage)
                            );

                            console.log(`Published VIP update for user ${payload.userId}`);
                        }
                    }
                } catch (err) {
                    console.error('Error processing Kafka message:', err);
                }
            },
        });
    } catch (error) {
        console.error('Failed to init Kafka Consumer:', error);
        setTimeout(() => initConsumer(io), 5000);
    }
};

const getSequenceCounter = () => sequenceCounter;

const cleanup = async () => {
    try {
        if (consumer) await consumer.disconnect();
        if (redisPublisher) await redisPublisher.disconnect();
        if (redisSubscriber) await redisSubscriber.disconnect();
        console.log('Kafka and Redis connections closed');
    } catch (err) {
        console.error('Error during cleanup:', err);
    }
};

module.exports = { initConsumer, getSequenceCounter, cleanup };
