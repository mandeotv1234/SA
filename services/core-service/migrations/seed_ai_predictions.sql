-- Seed fake AI predictions for testing backtest functionality
INSERT INTO ai_predictions (time, symbol, direction_1h, confidence_1h, volatility)
SELECT 
    generate_series(
        '2026-01-01 00:00:00'::timestamp, 
        '2026-02-08 23:00:00'::timestamp, 
        '1 hour'::interval
    ) as time,
    'BTCUSDT' as symbol,
    CASE WHEN random() > 0.5 THEN 'UP' ELSE 'DOWN' END as direction_1h,
    (random() * 0.4 + 0.6) as confidence_1h, -- Generate confident predictions (0.6 - 1.0)
    CASE 
        WHEN random() < 0.3 THEN 'LOW'
        WHEN random() < 0.7 THEN 'MEDIUM'
        ELSE 'HIGH'
    END as volatility
ON CONFLICT (time, symbol) DO NOTHING;

INSERT INTO ai_predictions (time, symbol, direction_1h, confidence_1h, volatility)
SELECT 
    generate_series(
        '2026-01-01 00:00:00'::timestamp, 
        '2026-02-08 23:00:00'::timestamp, 
        '1 hour'::interval
    ) as time,
    'ETHUSDT' as symbol,
    CASE WHEN random() > 0.5 THEN 'UP' ELSE 'DOWN' END as direction_1h,
    (random() * 0.4 + 0.6) as confidence_1h,
    CASE 
        WHEN random() < 0.3 THEN 'LOW'
        WHEN random() < 0.7 THEN 'MEDIUM'
        ELSE 'HIGH'
    END as volatility
ON CONFLICT (time, symbol) DO NOTHING;
