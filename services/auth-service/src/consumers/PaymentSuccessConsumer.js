const { Kafka } = require('kafkajs');
const { pool } = require('../db');

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

const run = async () => {
    await consumer.connect();
    console.log('PaymentSuccessConsumer connected');
    await consumer.subscribe({ topic: 'payment.success', fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            try {
                const rawMessage = message.value.toString();
                console.log('=== Received Kafka Message ===');
                console.log('Topic:', topic);
                console.log('Raw message:', rawMessage);

                const payload = JSON.parse(rawMessage);
                console.log('Parsed payload:', payload);
                console.log(`Processing payment.success for User ${payload.userId}`);

                // Update User VIP status
                const res = await pool.query(
                    'UPDATE users SET is_vip = true WHERE id = $1 RETURNING id, email, is_vip',
                    [payload.userId]
                );

                console.log('Update query result:', res.rows);

                if (res.rowCount > 0) {
                    console.log(`✅ User ${payload.userId} upgraded to VIP successfully!`);
                } else {
                    console.error(`❌ User ${payload.userId} not found in database.`);
                }

            } catch (err) {
                console.error('Error processing payment.success message:', err);
            }
        },
    });
};

module.exports = run;
