const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, getPublicKeyPem } = require('../utils/jwt');

const router = express.Router();
router.use(express.json());

// Register using email + password (store bcrypt hash in column `password`)
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  // basic email normalization
  const normEmail = String(email).trim().toLowerCase();

  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      'INSERT INTO users(email, password) VALUES($1,$2) RETURNING id, email, created_at',
      [normEmail, hash]
    );
    const user = r.rows[0];
    res.json({ user });
  } catch (err) {
    // duplicate key code 23505
    if (err.code === '23505') return res.status(409).json({ error: 'email_exists' });
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Login using email + password (compare bcrypt against column `password`)
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const normEmail = String(email).trim().toLowerCase();

  try {
    const r = await pool.query('SELECT id, email, password FROM users WHERE lower(email) = lower($1) LIMIT 1', [normEmail]);
    const row = r.rows[0];
    if (!row) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken({ sub: row.id, email: row.email });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

router.get('/public-key', (req, res) => {
  res.type('text/plain').send(getPublicKeyPem());
});

module.exports = router;