require('dotenv').config();
const BinanceClient = require('./binance-client');
const { Kafka } = require('kafkajs');

const SYMBOLS = (process.env.SYMBOLS || 'btcusdt,ethusdt,bnbusdt,solusdt,dogeusdt,adausdt,xrpusdt').split(',').map(s => s.trim().toLowerCase());
const INTERVAL = process.env.INTERVAL || '1m';
const BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');

const kafka = new Kafka({
    clientId: 'stream-ingester',
    brokers: BROKERS,
    retry: {
        initialRetryTime: 100,
        retries: 8
    }
});

const producer = kafka.producer();

async function startIngester() {
    try {
        await producer.connect();
        console.log('✅ Ingester Kafka Producer Connected');

        const client = new BinanceClient(SYMBOLS, INTERVAL);

        client.on('open', () => {
            console.log("🚀 Ingester connected to Binance Source for:", SYMBOLS);
        });

        client.on('kline', async (msg) => {
            // msg format: { symbol: 'BTCUSDT', kline: {...} }
            try {
                await producer.send({
                    topic: 'market.prices',
                    messages: [
                        {
                            key: msg.symbol,
                            value: JSON.stringify(msg)
                        }
                    ]
                });
            } catch (err) {
                console.error('Kafka send error:', err);
            }
        });

        client.connect();

        // Graceful shutdown
        const shutdown = async () => {
            console.log('Shutting down Ingester...');
            client.close();
            await producer.disconnect();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (e) {
        console.error('Ingester startup failed:', e);
        process.exit(1);
    }
}

startIngester();
