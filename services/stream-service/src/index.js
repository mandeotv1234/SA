const { createServer } = require('http');
const { Server } = require('socket.io');
const BinanceClient = require('./binance-client');
const { initProducer, sendPriceEvent, disconnectProducer } = require('./kafkaProducer');

const PORT = process.env.PORT || 3000;
const SYMBOLS = (process.env.SYMBOLS || 'btcusdt,ethusdt').split(',').map(s => s.trim().toLowerCase());
const INTERVAL = process.env.INTERVAL || '1m';
const SEND_PARTIAL = (process.env.SEND_PARTIAL || 'false') === 'true';

// Tối ưu HTTP Server
const httpServer = createServer((req, res) => {
    // Health check đơn giản, không dùng overhead của framework
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"alive": true}');
      return;
    }
    res.writeHead(404);
    res.end();
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET'] }, // Chỉ cần GET cho sub
  path: '/socket.io',
  // TỐI ƯU HIỆU NĂNG SOCKET:
  transports: ['websocket'], // Bỏ polling, chỉ dùng websocket
  perMessageDeflate: false,  // Tắt nén socket nếu CPU server yếu (tăng băng thông nhưng giảm CPU)
  httpCompression: false,    // Tắt nén HTTP headers
});

async function start() {
  try {
    await initProducer();
  } catch (e) {
    console.error("Kafka init failed, starting without Kafka...", e);
  }

  const client = new BinanceClient(SYMBOLS, INTERVAL);
  
  // Xử lý sự kiện open để reconnect socket client nếu cần
  client.on('open', () => {
    console.log("Binance Stream Started");
  });

  client.on('kline', (msg) => {
    // Logic filter
    if (!SEND_PARTIAL && !msg.kline.isFinal) return;

    // 1. BROADCAST NGAY LẬP TỨC (Priority 1)
    // Dùng volatile để nếu Client mạng lag thì bỏ qua gói tin cũ, không cố gửi lại gây lag thêm
    io.volatile.emit('price_event', msg); 

    // 2. GỬI KAFKA ASYNC (Priority 2)
    // Không dùng 'await' ở đây. Để nó chạy background.
    sendPriceEvent(msg); 
  });

  client.connect();

  // Socket monitoring (Optional)
  io.on('connection', (socket) => {
    // Log số lượng client để monitor
     console.log(`Clients: ${io.engine.clientsCount}`);
  });

  httpServer.listen(PORT, () => console.log(`Stream Service running on port ${PORT}`));

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    client.close();
    io.close(); // Đóng socket server
    await disconnectProducer();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();