-- TimescaleDB schema for core-service
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS market_klines (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  open_time TIMESTAMPTZ NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume NUMERIC,
  raw JSONB
);
SELECT create_hypertable('market_klines', 'open_time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS ai_insights (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  topic TEXT,
  payload JSONB
);

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  avg_price NUMERIC NOT NULL,
  side TEXT DEFAULT 'long',
  created_at TIMESTAMPTZ DEFAULT now()
);
-- TimescaleDB Hypertable for market_klines
CREATE TABLE IF NOT EXISTS market_klines (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    open DOUBLE PRECISION,
    high DOUBLE PRECISION,
    low DOUBLE PRECISION,
    close DOUBLE PRECISION,
    volume DOUBLE PRECISION,
    PRIMARY KEY (time, symbol)
);

SELECT create_hypertable('market_klines', 'time', if_not_exists => TRUE);

-- TimescaleDB Hypertable for news_sentiment
CREATE TABLE IF NOT EXISTS news_sentiment (
    id SERIAL PRIMARY KEY,
    time TIMESTAMPTZ NOT NULL,
    source VARCHAR(50),
    sentiment_score FLOAT,
    impact_magnitude FLOAT,
    title TEXT
);

SELECT create_hypertable('news_sentiment', 'time', if_not_exists => TRUE);

-- PostgreSQL Standard for users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL
);

-- PostgreSQL Standard for portfolios
CREATE TABLE IF NOT EXISTS portfolios (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    asset VARCHAR(20) NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
