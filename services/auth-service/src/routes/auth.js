const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, getPublicKeyPem, verifyToken } = require('../utils/jwt');
const TokenBlacklist = require('../services/TokenBlacklist');
const AuditLogger = require('../utils/AuditLogger');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(express.json());

// Register using email + password + optional is_vip
router.post('/register', async (req, res) => {
  const { email, password, is_vip } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  // basic email normalization
  const normEmail = String(email).trim().toLowerCase();
  const isVip = !!is_vip;

  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      'INSERT INTO users(email, password, is_vip) VALUES($1,$2, $3) RETURNING id, email, created_at, is_vip',
      [normEmail, hash, isVip]
    );
    const user = r.rows[0];
    res.json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'email_exists' });
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Login using email + password
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const normEmail = String(email).trim().toLowerCase();
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';

  try {
    const r = await pool.query('SELECT id, email, password, is_vip FROM users WHERE lower(email) = lower($1) LIMIT 1', [normEmail]);
    const row = r.rows[0];
    
    if (!row) {
      // Log failed authentication attempt
      AuditLogger.logAuthAttempt(null, normEmail, ipAddress, userAgent, false, 'user_not_found');
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) {
      // Log failed authentication attempt
      AuditLogger.logAuthAttempt(row.id, normEmail, ipAddress, userAgent, false, 'invalid_password');
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // Include is_vip in the token
    const token = signToken({
      sub: row.id,
      email: row.email,
      is_vip: !!row.is_vip
    });
    
    // Log successful authentication
    AuditLogger.logAuthAttempt(row.id, row.email, ipAddress, userAgent, true);
    
    res.json({ token, is_vip: !!row.is_vip });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Logout - revoke current token
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.jti) {
      return res.status(400).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token does not contain JTI',
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // Calculate TTL based on token expiration
    const now = Math.floor(Date.now() / 1000);
    const ttl = user.exp - now;
    
    if (ttl > 0) {
      // Add token to blacklist
      await TokenBlacklist.addToBlacklist(user.jti, ttl);
      
      // Log token revocation
      AuditLogger.logTokenRevocation(user.jti, user.sub, 'user_logout');
    }
    
    res.json({ 
      message: 'Logged out successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to logout',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.get('/public-key', (req, res) => {
  res.type('text/plain').send(getPublicKeyPem());
});

// Get current user info (requires JWT)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    // authMiddleware already validated token and checked blacklist
    // req.user contains the decoded JWT payload
    const userId = req.user.sub;

    if (!userId) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    const r = await pool.query('SELECT id, email, is_vip, created_at FROM users WHERE id = $1 LIMIT 1', [userId]);
    const user = r.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Issue a new token with updated claims
    const newToken = signToken({
      sub: user.id,
      email: user.email,
      is_vip: !!user.is_vip
    });

    res.json({
      user: { id: user.id, email: user.email, is_vip: !!user.is_vip, created_at: user.created_at },
      token: newToken // Return fresh token
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;