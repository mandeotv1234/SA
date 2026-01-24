const { createServer } = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const { initConsumer } = require('./kafkaConsumer');

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Optimized HTTP Server
const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"alive": true, "role": "gateway"}');
    return;
  }
  res.writeHead(404);
  res.end();
});

async function start() {
  // 1. Setup Redis Adapter for Horizontal Scaling (Socket.IO coordination)
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

  // 2. Start Kafka Consumer (Receives Prices & Events -> Broadcasts to Sockets)
  try {
    await initConsumer(io);
  } catch (e) {
    console.error("Kafka Gateway init failed", e);
  }

  io.on('connection', (socket) => {
    console.log(`[CONNECTION] New client connected: ${socket.id}`);

    // Optional monitoring log
    const clientsCount = io.engine.clientsCount;
    if (clientsCount % 100 === 0 || clientsCount < 10) {
      console.log(`[MONITOR] Total clients connected: ${clientsCount}`);
    }

    // Client subscribes to a specific symbol (Price Feed)
    socket.on('subscribe', (symbol) => {
      console.log(`[SUBSCRIBE] Received subscribe event from ${socket.id} for: ${symbol}`);
      if (symbol && typeof symbol === 'string') {
        const room = symbol.toUpperCase();
        socket.join(room);
        console.log(`[SUBSCRIBE] ✅ Client ${socket.id} joined room: ${room}`);

        // Log current room members
        const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
        console.log(`[SUBSCRIBE] Room ${room} now has ${roomSize} client(s)`);
      } else {
        console.log(`[SUBSCRIBE] ❌ Invalid symbol received: ${symbol}`);
      }
    });

    // Client joins their personal room (User Notifications)
    socket.on('join_user_room', (userId) => {
      if (userId && typeof userId === 'string') {
        socket.join(`user_${userId}`);
        console.log(`[USER_ROOM] Client ${socket.id} joined user room: user_${userId}`);
      }
    });

    socket.on('unsubscribe', (symbol) => {
      if (symbol && typeof symbol === 'string') {
        const room = symbol.toUpperCase();
        socket.leave(room);
        console.log(`[UNSUBSCRIBE] Client ${socket.id} left room: ${room}`);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[DISCONNECT] Client ${socket.id} disconnected. Reason: ${reason}`);
    });
  });

  httpServer.listen(PORT, () => console.log(`Stream Gateway running on port ${PORT}`));

  const shutdown = async () => {
    console.log('Shutting down Gateway...');
    io.close();
    await pubClient.disconnect();
    await subClient.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
