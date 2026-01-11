const db = require('../config/db');
const axios = require('axios');

// Helper to fetch from Binance
async function fetchBinanceKlines(symbol, interval = '1m', limit = 1000, endTime = null) {
  try {
    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    if (endTime) {
      url += `&endTime=${endTime}`;
    }
    const res = await axios.get(url);
    // Binance: [Open Time, Open, High, Low, Close, Volume, Close Time, ...]
    return res.data.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      value: parseFloat(k[5]), // Volume
      color: parseFloat(k[4]) >= parseFloat(k[1]) ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 54, 69, 0.5)' // Volume Color
    }));
  } catch (e) {
    console.error("Binance API Error:", e.message);
    return [];
  }
}

exports.getKlines = async (req, res) => {
  const { symbol = 'BTCUSDT', limit = 1000, interval = '1m', end } = req.query;
  const sym = symbol.toUpperCase();

  try {
    // 1. Pagination / History Request
    if (end) {
      // 'end' is unix timestamp (seconds). Binance needs milliseconds.
      const endTimeMs = (Math.floor(Number(end)) * 1000) - 1;
      const data = await fetchBinanceKlines(sym, interval, limit, endTimeMs);

      if (data.length > 0) {
        return res.json(data);
      }

      console.warn(`[MarketController] Binance history empty for ${sym} @ ${end}, checking DB...`);
      // Fallback: Continue to DB query below, but apply 'end' filter
      // (We need to modify the DB query logic to handle 'end' param if we fall through, 
      //  or just duplicate the DB query here for simplicity)

      try {
        const result = await db.query(
          `SELECT time, open, high, low, close FROM market_klines 
           WHERE symbol = $1 AND time < to_timestamp($3)
           ORDER BY time DESC LIMIT $2`,
          [sym, limit, Number(end)]
        );
        const dbRows = result.rows.reverse().map(row => ({
          time: Math.floor(new Date(row.time).getTime() / 1000),
          open: parseFloat(row.open),
          high: parseFloat(row.high),
          low: parseFloat(row.low),
          close: parseFloat(row.close),
          value: 0,
          color: 'rgba(255, 255, 255, 0.2)'
        }));
        return res.json(dbRows);
      } catch (e) { console.error("DB History Fetch Error", e); }

      return res.json([]);
    }

    // 2. Latest Data Request
    // We prioritize Binance here to ensure we get Volume data which is crucial for the new UI.
    console.log(`[MarketController] Fetching ${sym} from Binance (Latest)...`);
    const binanceData = await fetchBinanceKlines(sym, interval, limit);

    if (binanceData.length > 0) {
      return res.json(binanceData);
    }

    console.warn(`[MarketController] Binance returned empty for ${sym}, falling back to DB...`);

    // 3. Fallback to DB if Binance fails or returns empty
    let dbRows = [];
    try {
      const result = await db.query(
        `SELECT time, open, high, low, close FROM market_klines WHERE symbol = $1 ORDER BY time DESC LIMIT $2`,
        [sym, limit]
      );
      // Format DB rows to match API response structure
      dbRows = result.rows.reverse().map(row => ({
        time: Math.floor(new Date(row.time).getTime() / 1000),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        value: 0, // No volume in DB fallback
        color: 'rgba(255, 255, 255, 0.2)'
      }));
    } catch (e) { console.error("DB Fetch Error", e.message); }

    res.json(dbRows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};