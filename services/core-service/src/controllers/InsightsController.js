const db = require('../config/db');

/**
 * GET /api/v1/insights
 * Query params: start, end, type, limit
 */
const getInsights = async (req, res) => {
  try {
    const { start, end, type, limit } = req.query;
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

    const lim = Math.min(parseInt(limit || '100', 10) || 100, 2000);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const q = `SELECT time, type, payload FROM ai_insights ${where} ORDER BY time DESC LIMIT ${lim};`;
    const { rows } = await db.query(q, params);
    res.json({ count: rows.length, rows });
  } catch (err) {
    console.error('Error in getInsights:', err);
    res.status(500).json({ error: 'internal_error' });
  }
};

module.exports = { getInsights };
