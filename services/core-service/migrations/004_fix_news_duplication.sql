-- Migration: Remove duplicates via Temp Table (Faster for TimescaleDB)

BEGIN;

-- 1. Create temp table with unique records
CREATE TABLE news_sentiment_temp AS
SELECT DISTINCT ON (time, url) *
FROM news_sentiment;

-- 2. Truncate original table (this clears all chunks)
TRUNCATE TABLE news_sentiment;

-- 3. Insert back unique records
INSERT INTO news_sentiment
SELECT * FROM news_sentiment_temp;

-- 4. Drop temp table
DROP TABLE news_sentiment_temp;

-- 5. Create Unique Index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_news_time_url ON news_sentiment (time, url);

COMMIT;
