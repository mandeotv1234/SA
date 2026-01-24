-- Migration: Update market_klines table to add sequence column
-- Purpose: Align market_klines table with klines table for sequence number support

-- Add sequence column to market_klines if it doesn't exist
ALTER TABLE market_klines ADD COLUMN IF NOT EXISTS sequence BIGINT;

-- Create index for efficient sequence-based queries on market_klines
CREATE INDEX IF NOT EXISTS idx_market_klines_symbol_sequence ON market_klines (symbol, sequence)
WHERE
    sequence IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN market_klines.sequence IS 'Global sequence number for gap detection and recovery (from stream-service)';