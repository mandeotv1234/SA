const { verifyToken } = require('../utils/jwt');

function authMiddleware(req, res, next) {
  const h = req.headers['authorization'];
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'missing_token' });
  const token = h.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', detail: err.message });
  }
}

module.exports = authMiddleware;