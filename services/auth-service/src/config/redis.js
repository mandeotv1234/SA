const { createClient } = require('redis');

let redisClient = null;

async function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379', 10)
    },
    password: process.env.REDIS_PASSWORD || undefined
  });

  client.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  client.on('connect', () => {
    console.log('Redis Client Connected');
  });

  await client.connect();
  redisClient = client;
  return client;
}

async function closeRedisClient() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

module.exports = { getRedisClient, closeRedisClient };
