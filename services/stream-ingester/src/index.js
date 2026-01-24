require('dotenv').config();
const BinanceClient = require('./binance-client');
const { Kafka } = require('kafkajs');

const SYMBOLS = (process.env.SYMBOLS || 'btcusdt,ethusdt,bnbusdt,solusdt,dogeusdt,adausdt,xrpusdt').split(',').map(s => s.trim().toLowerCase());
// Support multiple timeframes for realtime updates
const TIMEFRAMES = ['1m', '5m', '1h', '1d', '1w', '1M'];
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
const clients = []; // Store all BinanceClient instances

async function startIngester() {
    try {
        await producer.connect();
        console.log('✅ Ingester Kafka Producer Connected');

        // Create a separate WebSocket connection for each timeframe
        for (const interval of TIMEFRAMES) {
            const client = new BinanceClient(SYMBOLS, interval);

            client.on('open', () => {
                console.log(`🚀 Ingester connected to Binance for ${interval}:`, SYMBOLS);
            });

            client.on('kline', async (msg) => {
                // msg format: { symbol: 'BTCUSDT', interval: '1m', kline: {...} }
                try {
                    await producer.send({
                        topic: 'market.prices',
                        messages: [
                            {
                                key: `${msg.symbol}_${msg.interval}`,
                                value: JSON.stringify(msg)
                            }
                        ]
                    });
                } catch (err) {
                    console.error(`Kafka send error for ${interval}:`, err);
                }
            });

            client.connect();
            clients.push(client);
        }

        console.log(`✅ Started ${TIMEFRAMES.length} WebSocket connections for timeframes:`, TIMEFRAMES);

        // Graceful shutdown
        const shutdown = async () => {
            console.log('Shutting down Ingester...');
            clients.forEach(client => client.close());
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
