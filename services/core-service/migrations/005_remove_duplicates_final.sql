-- Migration: Remove duplicates by keeping only the latest entry per URL
-- And enforcing uniqueness via index (time, url)

BEGIN;

-- 1. Create temp table to store unique records (Key: URL)
-- Keeping the latest entry (ORDER BY time DESC)
CREATE TABLE news_sentiment_dedup AS
SELECT DISTINCT ON (url) *
FROM news_sentiment
ORDER BY url, time DESC;

-- 2. Clear the main table (Removes all chunks data)
TRUNCATE TABLE news_sentiment;

-- 3. Restore unique records
INSERT INTO news_sentiment
SELECT * FROM news_sentiment_dedup;

-- 4. Drop temporary table
DROP TABLE news_sentiment_dedup;

-- 5. Re-create Unique Index (Required for Hypertable constraints)
-- Note: TimescaleDB requires 'time' column in unique constraints on hypertables.
DROP INDEX IF EXISTS idx_unique_news_time_url;
CREATE UNIQUE INDEX idx_unique_news_time_url ON news_sentiment (time, url);

COMMIT;
