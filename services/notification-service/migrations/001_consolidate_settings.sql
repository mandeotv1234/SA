-- Migration: Improve notification settings schema
-- From: Multiple rows per user (one per symbol)
-- To: Single row per user with JSON/Array

-- Create new table
CREATE TABLE IF NOT EXISTS user_notification_settings_v2 (
    user_id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    prediction_symbols TEXT[] DEFAULT '{}', -- PostgreSQL array of symbols
    investment_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Migrate existing data
INSERT INTO user_notification_settings_v2 (user_id, email, prediction_symbols, investment_enabled, updated_at)
SELECT 
    user_id,
    MAX(email) as email,
    ARRAY_AGG(symbol) FILTER (WHERE type = 'PREDICTION' AND enabled = TRUE) as prediction_symbols,
    BOOL_OR(type = 'INVESTMENT' AND enabled = TRUE) as investment_enabled,
    MAX(updated_at) as updated_at
FROM user_preferences
GROUP BY user_id;

-- Backup old table
ALTER TABLE user_preferences RENAME TO user_preferences_backup;

-- Rename new table
ALTER TABLE user_notification_settings_v2 RENAME TO user_preferences;

-- Create index
CREATE INDEX IF NOT EXISTS idx_user_email ON user_preferences(email);
