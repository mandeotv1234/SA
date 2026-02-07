-- Migration: Add Backtesting Tables
-- This migration adds tables for storing AI prediction history and backtest results

BEGIN;

-- Table 1: AI Predictions History (TimescaleDB Hypertable)
-- Stores historical AI predictions for backtesting
CREATE TABLE IF NOT EXISTS ai_predictions (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    
    -- Prediction outputs
    direction_1h VARCHAR(20),           -- UP, DOWN, SIDEWAYS
    direction_24h VARCHAR(20),
    confidence_1h FLOAT,                -- 0-100
    confidence_24h FLOAT,
    target_price_1h FLOAT,
    target_price_24h FLOAT,
    expected_return_1h FLOAT,           -- Expected return percentage
    expected_return_24h FLOAT,
    volatility VARCHAR(20),             -- LOW, MEDIUM, HIGH
    
    -- Analysis metadata
    primary_driver VARCHAR(50),         -- TECHNICAL, NEWS, SENTIMENT, etc.
    market_sentiment VARCHAR(20),       -- BULLISH, BEARISH, NEUTRAL
    market_sentiment_score FLOAT,
    
    -- Full prediction data (JSON)
    raw_data JSONB,
    
    PRIMARY KEY (time, symbol)
);

-- Create hypertable for time-series optimization
SELECT create_hypertable('ai_predictions', 'time', if_not_exists => TRUE);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ai_predictions_symbol_time ON ai_predictions (symbol, time DESC);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_confidence ON ai_predictions (symbol, confidence_1h DESC) WHERE confidence_1h IS NOT NULL;


-- Table 2: Backtest Results
-- Stores backtest execution results and performance metrics
CREATE TABLE IF NOT EXISTS backtest_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Strategy configuration
    strategy_name VARCHAR(255) NOT NULL,
    strategy_config JSONB NOT NULL,     -- Full strategy definition (conditions, logic, etc.)
    
    -- Backtest parameters
    symbol VARCHAR(20) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    initial_capital FLOAT DEFAULT 10000,
    
    -- Performance metrics
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    win_rate FLOAT,                     -- Percentage
    
    total_profit FLOAT DEFAULT 0,
    total_loss FLOAT DEFAULT 0,
    net_profit FLOAT DEFAULT 0,
    net_profit_percent FLOAT,           -- ROI percentage
    
    max_drawdown FLOAT,                 -- Maximum equity drawdown percentage
    max_drawdown_duration INTEGER,      -- Duration in minutes
    
    sharpe_ratio FLOAT,                 -- Risk-adjusted return
    profit_factor FLOAT,                -- Total profit / Total loss
    
    avg_win FLOAT,                      -- Average winning trade
    avg_loss FLOAT,                     -- Average losing trade
    largest_win FLOAT,
    largest_loss FLOAT,
    
    avg_trade_duration INTEGER,         -- Average trade duration in minutes
    
    -- Detailed results (JSON)
    trades JSONB,                       -- Array of all trades with entry/exit details
    equity_curve JSONB,                 -- Equity progression over time
    
    -- Execution metadata
    execution_time_ms INTEGER,          -- How long backtest took to run
    data_points_analyzed INTEGER        -- Number of candles analyzed
);

-- Create indexes for querying backtest results
CREATE INDEX IF NOT EXISTS idx_backtest_user_created ON backtest_results (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_symbol ON backtest_results (symbol);
CREATE INDEX IF NOT EXISTS idx_backtest_performance ON backtest_results (win_rate DESC, net_profit DESC);


-- Table 3: Backtest Strategy Templates (Optional - for saving/sharing strategies)
CREATE TABLE IF NOT EXISTS strategy_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    strategy_config JSONB NOT NULL,
    
    -- Stats from backtests using this strategy
    times_used INTEGER DEFAULT 0,
    avg_win_rate FLOAT,
    
    is_public BOOLEAN DEFAULT FALSE     -- Allow sharing with other users
);

CREATE INDEX IF NOT EXISTS idx_strategy_templates_user ON strategy_templates (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_templates_public ON strategy_templates (is_public, avg_win_rate DESC) WHERE is_public = TRUE;

COMMIT;
