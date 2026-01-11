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

module.exports = router;