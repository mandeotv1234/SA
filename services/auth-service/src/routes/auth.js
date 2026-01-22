const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, getPublicKeyPem } = require('../utils/jwt');

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

  try {
    const r = await pool.query('SELECT id, email, password, is_vip FROM users WHERE lower(email) = lower($1) LIMIT 1', [normEmail]);
    const row = r.rows[0];
    if (!row) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    // Include is_vip in the token
    const token = signToken({
      sub: row.id,
      email: row.email,
      is_vip: !!row.is_vip
    });
    res.json({ token, is_vip: !!row.is_vip });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

router.get('/public-key', (req, res) => {
  res.type('text/plain').send(getPublicKeyPem());
});

// Get current user info (requires JWT)
router.get('/me', async (req, res) => {
  try {
    // Kong JWT plugin adds the JWT payload to headers
    // We need to decode the Authorization header to get the actual user ID
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Decode JWT payload (middle part of token)
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const userId = payload.sub; // 'sub' contains user ID

      if (!userId) {
        return res.status(401).json({ error: 'invalid_token' });
      }

      const r = await pool.query('SELECT id, email, is_vip, created_at FROM users WHERE id = $1 LIMIT 1', [userId]);
      const user = r.rows[0];

      if (!user) {
        return res.status(404).json({ error: 'user_not_found' });
      }

      res.json({ user: { id: user.id, email: user.email, is_vip: !!user.is_vip, created_at: user.created_at } });
    } catch (decodeError) {
      console.error('JWT decode error:', decodeError);
      return res.status(401).json({ error: 'invalid_token' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;