const db = require('../config/db');

// TradingView Lightweight Charts yêu cầu mảng object đã sort theo time:
// [{ time: 16424252, open: 10, high: 15, low: 5, close: 12 },...]
exports.getKlines = async (req, res) => {
  const { symbol = 'BTCUSDT', limit = 1000 } = req.query;

  try {
    // Lấy N nến mới nhất
    const text = `
      SELECT time, open, high, low, close 
      FROM market_klines 
      WHERE symbol = $1 
      ORDER BY time DESC 
      LIMIT $2
    `;
    const values = [symbol.toUpperCase(), limit];
    
    const result = await db.query(text, values);

    // Dữ liệu lấy ra đang là mới nhất -> cũ nhất (DESC).
    // TradingView cần cũ nhất -> mới nhất (ASC).
    // Cần reverse lại mảng.
    const formattedData = result.rows.map(row => ({
      // TimescaleDB trả về Date object, convert sang UNIX timestamp (giây)
      time: Math.floor(new Date(row.time).getTime() / 1000), 
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
    })).reverse();

    res.json(formattedData);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};