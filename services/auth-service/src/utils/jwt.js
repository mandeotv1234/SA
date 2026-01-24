const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('crypto');
const { v4: uuidv4 } = require('uuid');

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
  
  // Default to 15 minutes for access tokens (Phase 2 requirement)
  // For now, use 1 hour if not specified
  const expiresIn = opts.expiresIn || process.env.JWT_EXPIRY || 3600;
  
  // Add jti (JWT ID) for token revocation tracking
  const jti = opts.jti || uuidv4();
  
  const tokenPayload = {
    ...payload,
    jti: jti
  };
  
  return jwt.sign(tokenPayload, privateKey, { 
    algorithm: 'RS256', 
    expiresIn: Number(expiresIn), 
    issuer: 'my-app-auth',
    audience: 'api.example.com'
  });
}

function verifyToken(token) {
  const publicKey = fs.readFileSync(PUB_PATH, 'utf8');
  return jwt.verify(token, publicKey, { 
    algorithms: ['RS256'],
    issuer: 'my-app-auth',
    audience: 'api.example.com'
  });
}

function getPublicKeyPem() {
  return fs.readFileSync(PUB_PATH, 'utf8');
}

function decodeToken(token) {
  return jwt.decode(token, { complete: true });
}

module.exports = { signToken, verifyToken, getPublicKeyPem, decodeToken };