-- Migration: Add missing columns to news_sentiment table
-- Run this in timescaledb container

-- Add url column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'news_sentiment' AND column_name = 'url'
    ) THEN
        ALTER TABLE news_sentiment ADD COLUMN url TEXT;
    END IF;
END $$;

-- Add raw_score column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'news_sentiment' AND column_name = 'raw_score'
    ) THEN
        ALTER TABLE news_sentiment ADD COLUMN raw_score JSONB;
    END IF;
END $$;

-- Create index on url for deduplication
CREATE INDEX IF NOT EXISTS idx_news_sentiment_url ON news_sentiment(url);

-- Verify columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'news_sentiment';
