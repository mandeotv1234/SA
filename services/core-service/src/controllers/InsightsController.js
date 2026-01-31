const db = require('../config/db');

/**
 * GET /api/v1/insights
 * Query params: start, end, type, symbol, limit
 */
const getInsights = async (req, res) => {
  try {
    const { start, end, type, symbol, limit } = req.query;
    const clauses = [];
    const params = [];
    let idx = 1;

    if (start) {
      clauses.push(`time >= $${idx++}`);
      params.push(new Date(start));
    }
    if (end) {
      clauses.push(`time <= $${idx++}`);
      params.push(new Date(end));
    }
    if (type) {
      clauses.push(`type = $${idx++}`);
      params.push(type);
    }
    if (symbol) {
      clauses.push(`symbol = $${idx++}`);
      params.push(symbol.toUpperCase());
    }

    const lim = Math.min(parseInt(limit || '100', 10) || 100, 2000);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const q = `SELECT time, type, symbol, payload FROM ai_insights ${where} ORDER BY time DESC LIMIT ${lim};`;
    const { rows } = await db.query(q, params);
    res.json({ count: rows.length, rows });
  } catch (err) {
    console.error('Error in getInsights:', err);
    res.status(500).json({ error: 'internal_error' });
  }
};

/**
 * GET /api/v1/insights/latest/:symbol
 * Get the latest prediction for a specific symbol
 */
const getLatestPrediction = async (req, res) => {
  try {
    const { symbol } = req.params;
    const symbolUpper = symbol.toUpperCase();

    const q = `
      SELECT time, type, symbol, payload 
      FROM ai_insights 
      WHERE symbol = $1 AND type = 'aggregated_prediction'
      ORDER BY time DESC 
      LIMIT 1;
    `;

    const { rows } = await db.query(q, [symbolUpper]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'no_prediction_found',
        message: `No prediction available for ${symbolUpper}`
      });
    }

    const result = rows[0];
    res.json({
      symbol: symbolUpper,
      prediction_time: result.time,
      type: result.type,
      data: result.payload
    });
  } catch (err) {
    console.error('Error in getLatestPrediction:', err);
    res.status(500).json({ error: 'internal_error' });
  }
};

module.exports = { getInsights, getLatestPrediction };
