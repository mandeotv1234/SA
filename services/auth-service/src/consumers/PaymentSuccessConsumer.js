const { Kafka } = require('kafkajs');
const { pool } = require('../db');
const sseService = require('../services/sseService');

const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const kafka = new Kafka({
    clientId: 'auth-service-payment-consumer',
    brokers: BROKERS,
    retry: {
        initialRetryTime: 100,
        retries: 8
    }
});

const consumer = kafka.consumer({ groupId: 'auth-service-group' });
const producer = kafka.producer();

const run = async () => {
    try {
        await consumer.connect();
        await producer.connect();
        console.log('PaymentSuccessConsumer & Producer connected');

        await consumer.subscribe({ topic: 'payment.success', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const rawMessage = message.value.toString();
                    const payload = JSON.parse(rawMessage);
                    console.log(`Processing payment for User ${payload.userId}`);

                    // Update User VIP status
                    const res = await pool.query(
                        'UPDATE users SET is_vip = true WHERE id = $1 RETURNING id, email, is_vip',
                        [payload.userId]
                    );

                    if (res.rowCount > 0) {
                        console.log(`✅ User ${payload.userId} upgraded to VIP successfully!`);

                        // The local import of sseService is redundant as it's already imported globally.
                        // const sseService = require('../services/sseService'); // This line is removed as per instruction interpretation.

                        // Send SSE event
                        sseService.sendEvent(payload.userId, 'vip_update', { isVip: true });
                        console.log(`SSE Sent: vip_update for ${payload.userId}`);

                        // Publish event for Stream Service (Socket.IO) - Optional if we strictly use SSE
                        await producer.send({
                            topic: 'user.events',
                            messages: [
                                {
                                    key: payload.userId,
                                    value: JSON.stringify({
                                        event: 'user.upgraded',
                                        userId: payload.userId,
                                        timestamp: new Date().toISOString()
                                    })
                                }
                            ]
                        });
                        console.log(`Events sent: user.upgraded for ${payload.userId}`);

                    } else {
                        console.error(`❌ User ${payload.userId} not found in database.`);
                    }

                } catch (err) {
                    console.error('Error processing payment.success message:', err);
                }
            },
        });
    } catch (err) {
        console.error('Failed to start Payment Consumer:', err);
    }
};

module.exports = run;
