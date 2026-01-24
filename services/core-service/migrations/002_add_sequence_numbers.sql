-- Migration: Add sequence numbers for gap detection and recovery
-- Purpose: Enable clients to detect missed messages and request recovery

-- Add sequence number column to klines table
ALTER TABLE klines ADD COLUMN IF NOT EXISTS sequence BIGINT;

-- Create index for efficient sequence-based queries
CREATE INDEX IF NOT EXISTS idx_klines_symbol_sequence ON klines (symbol, sequence)
WHERE
    sequence IS NOT NULL;

-- Create sequence tracking table for global sequence management
CREATE TABLE IF NOT EXISTS sequence_tracker (
    id SERIAL PRIMARY KEY,
    last_sequence BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial record
INSERT INTO
    sequence_tracker (last_sequence)
VALUES (0) ON CONFLICT DO NOTHING;

-- Function to get next sequence atomically
CREATE OR REPLACE FUNCTION get_next_sequence()
RETURNS BIGINT AS $$
DECLARE
    next_seq BIGINT;
BEGIN
    UPDATE sequence_tracker
    SET last_sequence = last_sequence + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
    RETURNING last_sequence INTO next_seq;

    RETURN next_seq;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON COLUMN klines.sequence IS 'Global sequence number for gap detection and recovery';

COMMENT ON
TABLE sequence_tracker IS 'Tracks global sequence numbers for all market data';

COMMENT ON FUNCTION get_next_sequence () IS 'Atomically generates next sequence number';