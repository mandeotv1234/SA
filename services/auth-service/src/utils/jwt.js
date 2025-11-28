const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('crypto');

const KEYS_DIR = path.join(__dirname, '..', '..', 'keys');
const PRIV_PATH = path.join(KEYS_DIR, 'private.pem');
const PUB_PATH = path.join(KEYS_DIR, 'public.pem');

function ensureKeys() {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(PRIV_PATH) || !fs.existsSync(PUB_PATH)) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(PRIV_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUB_PATH, publicKey, { mode: 0o644 });
  }
}

ensureKeys();

function signToken(payload, opts = {}) {
  const privateKey = fs.readFileSync(PRIV_PATH, 'utf8');
  const expiresIn = opts.expiresIn || process.env.JWT_EXPIRY || 3600;
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn: Number(expiresIn), issuer: 'my-app-auth' });
}

function verifyToken(token) {
  const publicKey = fs.readFileSync(PUB_PATH, 'utf8');
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
}

function getPublicKeyPem() {
  return fs.readFileSync(PUB_PATH, 'utf8');
}

module.exports = { signToken, verifyToken, getPublicKeyPem };