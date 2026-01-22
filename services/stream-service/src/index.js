const { createServer } = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const BinanceClient = require('./binance-client');
const { initProducer, sendPriceEvent, disconnectProducer } = require('./kafkaProducer');
const { initConsumer } = require('./kafkaConsumer');

const PORT = process.env.PORT || 3000;
const SYMBOLS = (process.env.SYMBOLS || 'btcusdt,ethusdt').split(',').map(s => s.trim().toLowerCase());
const INTERVAL = process.env.INTERVAL || '1m';
const SEND_PARTIAL = (process.env.SEND_PARTIAL || 'false') === 'true';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Optimized HTTP Server
const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"alive": true}');
    return;
  }
  res.writeHead(404);
  res.end();
});

async function start() {
  // 1. Setup Redis Adapter for Horizontal Scaling
  const pubClient = createClient({ url: REDIS_URL });
  const subClient = pubClient.duplicate();

  try {
    await pubClient.connect();
    await subClient.connect();
    console.log('Redis connected for Socket.IO adapter');
  } catch (err) {
    console.error('Redis connection failed:', err);
    process.exit(1);
  }

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET'] },
    path: '/socket.io',
    transports: ['websocket'],
    perMessageDeflate: false,
    httpCompression: false,
    adapter: createAdapter(pubClient, subClient)
  });

  try {
    await initProducer();
    await initConsumer(io); // Start Consumer
  } catch (e) {
    console.error("Kafka init/Consumer failed, starting without proper Kafka...", e);
  }

  const client = new BinanceClient(SYMBOLS, INTERVAL);

  client.on('open', () => {
    console.log("Binance Stream Started for symbols:", SYMBOLS);
  });

  client.on('kline', (msg) => {
    if (!SEND_PARTIAL && !msg.kline.isFinal) return;

    // Use Room-based broadcasting: io.to(SYMBOL).emit(...)
    // This ensures only clients interested in this symbol receive the packet.
    // Significant bandwidth saving for 1000+ clients.
    const symbolRoom = msg.symbol.toUpperCase();

    // volatile: if client is lagging, drop the packet (realtime data)
    io.to(symbolRoom).volatile.emit('price_event', msg);

    // Also send to Kafka for persistence/analytics
    sendPriceEvent(msg);
  });

  client.connect();

  io.on('connection', (socket) => {
    // Optional monitoring log
    const clientsCount = io.engine.clientsCount;
    if (clientsCount % 100 === 0) {
      console.log(`Monitor: ${clientsCount} clients connected`);
    }

    // Client subscribes to a specific symbol
    socket.on('subscribe', (symbol) => {
      if (symbol && typeof symbol === 'string') {
        const room = symbol.toUpperCase();
        socket.join(room);
      }
    });

    // Client joins their personal room for notifications
    socket.on('join_user_room', (userId) => {
      if (userId && typeof userId === 'string') {
        console.log(`Socket ${socket.id} joined room user_${userId}`);
        socket.join(`user_${userId}`);
      }
    });

    // Client unsubscribes
    socket.on('unsubscribe', (symbol) => {
      if (symbol && typeof symbol === 'string') {
        const room = symbol.toUpperCase();
        socket.leave(room);
      }
    });
  });

  httpServer.listen(PORT, () => console.log(`Stream Service running on port ${PORT}`));

  const shutdown = async () => {
    console.log('Shutting down...');
    client.close();
    io.close();
    await disconnectProducer();
    await pubClient.disconnect();
    await subClient.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();