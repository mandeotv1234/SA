require('dotenv').config();
const { Pool } = require('pg');

const CONNECTION_STRING = process.env.DATABASE_URL || null;

const pool = CONNECTION_STRING
  ? new Pool({ connectionString: CONNECTION_STRING })
  : new Pool({
    user: process.env.DB_USER || 'dev',
    host: process.env.DB_HOST || 'timescaledb',
    database: process.env.DB_NAME || 'timeseriesdb',
    password: process.env.DB_PASSWORD || 'dev',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    max: 20,
    idleTimeoutMillis: 30000,
  });

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const initDB = async () => {
  const client = await pool.connect();
  try {
    console.log("🔄 Initializing Database Schema...");

    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;');
      const ext = await client.query(`SELECT extname FROM pg_extension WHERE extname = 'timescaledb';`);
      if (ext.rowCount > 0) {
        console.log('✅ timescaledb extension is available.');
      } else {
        console.log('⚠️ timescaledb extension not available, continuing without hypertable creation.');
      }
    } catch (extErr) {
      console.warn('⚠️ Could not create timescaledb extension (not available or insufficient privileges). Continuing without hypertable:', extErr.message);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS market_klines (
        time        TIMESTAMPTZ       NOT NULL,
        symbol      TEXT              NOT NULL,
        open        DECIMAL           NOT NULL,
        high        DECIMAL           NOT NULL,
        low         DECIMAL           NOT NULL,
        close       DECIMAL           NOT NULL,
        volume      DECIMAL           NOT NULL,
        UNIQUE(time, symbol)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS news_sentiment (
        time TIMESTAMPTZ NOT NULL,
        url  TEXT NOT NULL,
        source TEXT,
        title TEXT,
        sentiment_score DOUBLE PRECISION,
        raw_score JSONB,
        UNIQUE (url)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_insights (
        time TIMESTAMPTZ NOT NULL,
        type TEXT,
        payload JSONB
      );
    `);

    const checkExt = await client.query(`SELECT extname FROM pg_extension WHERE extname = 'timescaledb';`);
    if (checkExt.rowCount > 0) {
      try {
        await client.query(`
          SELECT create_hypertable(
            'market_klines',
            'time',
            if_not_exists => TRUE,
            migrate_data => TRUE
          );
        `);
        console.log("✅ market_klines converted to hypertable (timescaledb).");
        try {
          await client.query(`
              SELECT create_hypertable(
                'news_sentiment',
                'time',
                if_not_exists => TRUE,
                migrate_data => TRUE
              );
            `);
          console.log("✅ news_sentiment converted to hypertable (timescaledb).");
        } catch (hyErrNews) {
          console.warn('⚠️ create_hypertable for news_sentiment failed (continuing with standard table):', hyErrNews.message);
        }
        try {
          await client.query(`
                  SELECT create_hypertable(
                    'ai_insights',
                    'time',
                    if_not_exists => TRUE,
                    migrate_data => TRUE
                  );
                `);
          console.log("✅ ai_insights converted to hypertable (timescaledb).");
        } catch (hyErrInsights) {
          console.warn('⚠️ create_hypertable for ai_insights failed (continuing with standard table):', hyErrInsights.message);
        }
      } catch (hyErr) {
        console.warn('⚠️ create_hypertable failed (continuing with standard table):', hyErr.message);
      }
    } else {
      console.log('ℹ️ timescaledb not installed; market_klines remains a normal table.');
    }

    console.log("✅ Database initialization complete.");
  } catch (err) {
    console.error("❌ Database initialization failed:", err.message);
    throw err;
  } finally {
    client.release();
  }
};

initDB().catch(() => { /* init errors already logged */ });

const query = (text, params) => pool.query(text, params);

module.exports = {
  query,
  pool,
};