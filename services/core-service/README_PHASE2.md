# Core Service - Phase 2 Updates

## Overview

Phase 2 implementation adds data consistency and gap detection recovery capabilities to the WebSocket load balancing architecture.

## What's New

### 1. Database Schema Enhancements

- Added `sequence` column to `klines` and `market_klines` tables
- Created indexes for efficient sequence-based queries
- Added `sequence_tracker` table for global sequence management
- Implemented `get_next_sequence()` function for atomic sequence generation

### 2. MarketDataConsumerV2

- Enhanced Kafka consumer that saves sequence numbers to database
- Backward compatible with messages without sequences
- Improved error handling and logging
- Located at: `src/consumers/MarketDataConsumerV2.js`

### 3. Missed Data Recovery API

- New endpoint: `GET /api/v1/klines/missed`
- Retrieves missed klines data for gap recovery
- Full input validation and error handling
- Efficient database queries with proper indexing

## Quick Start

### 1. Apply Database Migrations

```bash
# Apply klines migration
docker exec -i project-timescaledb-1 psql -U postgres -d your_database \
  < migrations/002_add_sequence_numbers.sql

# Apply market_klines migration
docker exec -i project-timescaledb-1 psql -U postgres -d your_database \
  < migrations/003_update_market_klines_schema.sql
```

### 2. Update Consumer (Optional)

Edit `src/index.js`:

```javascript
// Change from:
const startMarketConsumer = require("./consumers/MarketDataConsumer");

// To:
const startMarketConsumer = require("./consumers/MarketDataConsumerV2");
```

### 3. Restart Service

```bash
docker-compose restart core-service
```

### 4. Verify

```bash
# Check if sequences are being saved
docker exec -it project-timescaledb-1 psql -U postgres -d your_database -c "
SELECT symbol, sequence, time
FROM market_klines
WHERE sequence IS NOT NULL
ORDER BY sequence DESC
LIMIT 10;
"

# Test API
curl "http://localhost:8000/api/v1/klines/missed?symbol=BTCUSDT&fromSeq=100&toSeq=150"
```

## API Documentation

### GET /api/v1/klines/missed

Retrieve missed klines data for gap recovery.

**Parameters:**

- `symbol` (required): Trading pair symbol (e.g., BTCUSDT)
- `fromSeq` (required): Starting sequence number (exclusive)
- `toSeq` (required): Ending sequence number (inclusive)
- `limit` (optional): Maximum records to return (default: 100, max: 1000)

**Example Request:**

```bash
curl "http://localhost:8000/api/v1/klines/missed?symbol=BTCUSDT&fromSeq=100&toSeq=150" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Example Response:**

```json
{
  "symbol": "BTCUSDT",
  "fromSeq": 100,
  "toSeq": 150,
  "count": 2,
  "data": [
    {
      "seq": 101,
      "symbol": "BTCUSDT",
      "timestamp": 1704067200000,
      "kline": {
        "t": 1704067200000,
        "T": 1704067260000,
        "s": "BTCUSDT",
        "o": 50000.0,
        "h": 50100.0,
        "l": 49900.0,
        "c": 50050.0,
        "v": 10.5
      }
    }
  ]
}
```

**Error Responses:**

- `400`: Invalid parameters (missing symbol, invalid range, etc.)
- `500`: Internal server error

See full API documentation: `docs/MISSED_DATA_API.md`

## File Structure

```
services/core-service/
├── migrations/
│   ├── 001_add_news_columns.sql
│   ├── 002_add_sequence_numbers.sql          [NEW - Phase 2]
│   └── 003_update_market_klines_schema.sql   [NEW - Phase 2]
├── src/
│   ├── consumers/
│   │   ├── MarketDataConsumer.js             [Original]
│   │   └── MarketDataConsumerV2.js           [NEW - Phase 2]
│   ├── controllers/
│   │   └── MarketController.js               [UPDATED - Phase 2]
│   └── routes/
│       └── marketRoutes.js                   [UPDATED - Phase 2]
├── docs/
│   ├── MISSED_DATA_API.md                    [NEW - Phase 2]
│   └── PHASE2_DEPLOYMENT.md                  [NEW - Phase 2]
└── README_PHASE2.md                          [This file]
```

## Architecture

### Data Flow with Sequence Numbers

```
Binance WebSocket
    ↓
Stream Ingester → Kafka (market_data)
    ↓
Stream Service (adds sequence number)
    ↓
Redis Pub/Sub (broadcasts with sequence)
    ↓
    ├─→ Frontend (detects gaps, calls API)
    └─→ Core Service (saves to DB with sequence)
            ↓
        market_klines table
            ↓
        Missed Data API ←─── Frontend (gap recovery)
```

### Sequence Number Management

1. **Stream Service** generates sequence numbers:
   - Uses Redis counter for atomic increments
   - Persists to Redis for restart recovery
   - Broadcasts via Redis Pub/Sub

2. **Core Service** saves sequences:
   - MarketDataConsumerV2 extracts sequence from messages
   - Saves to database with kline data
   - Provides API for gap recovery

3. **Frontend** detects and recovers gaps:
   - Tracks last seen sequence per symbol
   - Detects gap when new seq > last + 1
   - Calls Missed Data API to recover

## Database Schema

### market_klines Table (Updated)

```sql
CREATE TABLE market_klines (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    open DOUBLE PRECISION,
    high DOUBLE PRECISION,
    low DOUBLE PRECISION,
    close DOUBLE PRECISION,
    volume DOUBLE PRECISION,
    sequence BIGINT,              -- NEW: Global sequence number
    PRIMARY KEY (time, symbol)
);

-- NEW: Index for efficient sequence queries
CREATE INDEX idx_market_klines_symbol_sequence
ON market_klines (symbol, sequence)
WHERE sequence IS NOT NULL;
```

### sequence_tracker Table (New)

```sql
CREATE TABLE sequence_tracker (
    id SERIAL PRIMARY KEY,
    last_sequence BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration

### Environment Variables

No new environment variables required. Existing configuration works with Phase 2.

### Using MarketDataConsumerV2

To enable sequence number saving, update `src/index.js`:

```javascript
const startMarketConsumer = require("./consumers/MarketDataConsumerV2");
```

**Note**: If you keep using the original `MarketDataConsumer`, sequence numbers will be NULL in the database, but the system will still work (just without gap recovery capability).

## Monitoring

### Check Sequence Numbers

```sql
-- Count records with sequences
SELECT
  symbol,
  COUNT(*) as total_records,
  COUNT(sequence) as with_sequence,
  MIN(sequence) as min_seq,
  MAX(sequence) as max_seq
FROM market_klines
GROUP BY symbol;

-- Check for gaps
SELECT
  symbol,
  MAX(sequence) - MIN(sequence) + 1 - COUNT(*) as gap_count
FROM market_klines
WHERE sequence IS NOT NULL
GROUP BY symbol;
```

### Check API Performance

```sql
-- Query performance
EXPLAIN ANALYZE
SELECT * FROM market_klines
WHERE symbol = 'BTCUSDT'
  AND sequence > 100
  AND sequence <= 150
  AND sequence IS NOT NULL;

-- Should use: Index Scan using idx_market_klines_symbol_sequence
```

### Check Logs

```bash
# Core service logs
docker logs -f project-core-service-1

# Look for:
# [MarketDataConsumerV2] Saved X klines with sequences
# [MarketController] Fetching missed klines: BTCUSDT fromSeq:100 toSeq:150
```

## Troubleshooting

### Sequences are NULL in database

**Cause**: MarketDataConsumer (old version) is being used

**Solution**:

1. Update `src/index.js` to use `MarketDataConsumerV2`
2. Restart: `docker-compose restart core-service`
3. Verify: Check logs for "MarketDataConsumerV2"

### API returns empty array

**Cause**: No data with sequences in database yet

**Solution**:

1. Wait 1-2 minutes for data to flow through system
2. Check: `SELECT COUNT(*) FROM market_klines WHERE sequence IS NOT NULL;`
3. If still 0, check stream-service is sending sequences

### API returns 500 error

**Cause**: Database schema not updated or query error

**Solution**:

1. Verify migrations applied: `\d market_klines` in psql
2. Check logs: `docker logs project-core-service-1`
3. Verify sequence column exists

### Slow API response

**Cause**: Index not created or not being used

**Solution**:

1. Check index exists: `\d market_klines`
2. Check query plan: `EXPLAIN ANALYZE SELECT ...`
3. Recreate index if needed

## Performance

### Expected Metrics

- API response time: < 100ms (for ranges up to 100 records)
- Database query time: < 50ms (with proper indexing)
- Sequence write overhead: < 5% (minimal impact)

### Optimization Tips

1. **Use indexes**: Ensure `idx_market_klines_symbol_sequence` exists
2. **Limit range**: Keep `toSeq - fromSeq` under 1000
3. **Cache results**: Consider Redis caching for frequently requested ranges (future)
4. **Monitor queries**: Use `pg_stat_statements` to track slow queries

## Testing

### Unit Tests

Tests are optional for this phase. See `docs/MISSED_DATA_API.md` for manual testing examples.

### Integration Testing

```bash
# 1. Apply migrations
docker exec -i project-timescaledb-1 psql -U postgres -d your_database < migrations/002_add_sequence_numbers.sql
docker exec -i project-timescaledb-1 psql -U postgres -d your_database < migrations/003_update_market_klines_schema.sql

# 2. Restart service
docker-compose restart core-service

# 3. Wait for data
sleep 120

# 4. Test API
curl "http://localhost:8000/api/v1/klines/missed?symbol=BTCUSDT&fromSeq=100&toSeq=150"

# 5. Verify response
# Should return JSON with data array
```

## Rollback

If issues occur:

```bash
# 1. Stop service
docker-compose stop core-service

# 2. Restore database (if you have backup)
docker exec -i project-timescaledb-1 psql -U postgres -d your_database < backup_before_phase2.sql

# 3. Revert code changes (if any)
# Edit src/index.js back to MarketDataConsumer

# 4. Restart
docker-compose start core-service
```

## Documentation

- **API Documentation**: `docs/MISSED_DATA_API.md`
- **Deployment Guide**: `docs/PHASE2_DEPLOYMENT.md`
- **Quick Start**: `../../.kiro/specs/websocket-load-balancing/QUICK_START_PHASE2.md`
- **Phase 2 Summary**: `../../.kiro/specs/websocket-load-balancing/PHASE2_SUMMARY.md`

## Support

For issues or questions:

1. Check logs: `docker logs project-core-service-1`
2. Check database: `docker exec -it project-timescaledb-1 psql -U postgres`
3. Review troubleshooting section above
4. See full deployment guide: `docs/PHASE2_DEPLOYMENT.md`

## Next Steps

1. ✅ Deploy Phase 2 (this phase)
2. 🔄 Frontend integration for gap detection
3. 📋 Consider Phase 2.2 enhancements (caching, rate limiting)
4. 📋 Prepare for Phase 4 (Production deployment)
