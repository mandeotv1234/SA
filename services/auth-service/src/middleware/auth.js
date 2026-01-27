const { verifyToken } = require('../utils/jwt');
const TokenBlacklist = require('../services/TokenBlacklist');

async function authMiddleware(req, res, next) {
  const h = req.headers['authorization'];
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: {
        code: 'TOKEN_MISSING',
        message: 'No authentication token provided',
        timestamp: new Date().toISOString()
      }
    });
  }
  
  const token = h.slice(7);
  
  try {
    // Verify JWT signature and expiration
    const payload = verifyToken(token);
    
    // Check if token is blacklisted
    if (payload.jti) {
      const isBlacklisted = await TokenBlacklist.isBlacklisted(payload.jti);
      if (isBlacklisted) {
        return res.status(401).json({
          error: {
            code: 'TOKEN_REVOKED',
            message: 'Token has been revoked',
            timestamp: new Date().toISOString()
          }
        });
      }
    }
    
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
          timestamp: new Date().toISOString(),
          details: err.message
        }
      });
    }
    
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Token signature verification failed',
        timestamp: new Date().toISOString(),
        details: err.message
      }
    });
  }
}

module.exports = authMiddleware;