const db = require('../config/db');

// TradingView Lightweight Charts yêu cầu mảng object đã sort theo time:
// [{ time: 16424252, open: 10, high: 15, low: 5, close: 12 },...]
exports.getKlines = async (req, res) => {
  const { symbol = 'BTCUSDT', limit = 1000, start, end } = req.query;

  try {
    const sym = symbol.toUpperCase();

    // If start/end provided prefer time-range query, otherwise fall back to latest N candles
    let text, values;
    if (start || end) {
      const clauses = ['symbol = $1'];
      values = [sym];
      let idx = 2;
      if (start) {
        const s = isNaN(Number(start)) ? new Date(start) : new Date(Number(start) * 1000);
        clauses.push(`time >= $${idx++}`);
        values.push(s);
      }
      if (end) {
        const e = isNaN(Number(end)) ? new Date(end) : new Date(Number(end) * 1000);
        clauses.push(`time <= $${idx++}`);
        values.push(e);
      }
      text = `SELECT time, open, high, low, close FROM market_klines WHERE ${clauses.join(' AND ')} ORDER BY time ASC LIMIT $${idx}`;
      values.push(limit);
    } else {
      text = `SELECT time, open, high, low, close FROM market_klines WHERE symbol = $1 ORDER BY time DESC LIMIT $2`;
      values = [sym, limit];
    }

    const result = await db.query(text, values);

    // if query returned DESC (latest N) we need to reverse to ASC
    let rows = result.rows;
    if (!start && !end) rows = rows.reverse();

    const formattedData = rows.map(row => ({
      time: Math.floor(new Date(row.time).getTime() / 1000),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
    }));

    res.json(formattedData);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};