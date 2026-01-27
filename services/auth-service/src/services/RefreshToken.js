const { pool } = require('../db');
const crypto = require('crypto');

class RefreshToken {
  /**
   * Create a new refresh token for a user
   * @param {string} userId - User ID
   * @param {string} ipAddress - Client IP address
   * @param {string} userAgent - Client user agent
   * @returns {Promise<{token: string, expiresAt: Date}>}
   */
  async createRefreshToken(userId, ipAddress, userAgent) {
    // Generate random refresh token (256 bits = 32 bytes)
    const token = crypto.randomBytes(32).toString('hex');
    
    // Hash token for storage (never store plain tokens)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Refresh token expiry from ENV (default 7 days)
    const refreshTokenDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '7', 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + refreshTokenDays);
    
    // Store in database
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, expiresAt, ipAddress, userAgent]
    );
    
    console.log(`Refresh token created for user ${userId}`);
    
    return {
      token: token, // Return plain token to client
      expiresAt: expiresAt
    };
  }

  /**
   * Validate a refresh token
   * @param {string} token - Plain refresh token
   * @returns {Promise<Object|null>} Token record or null if invalid
   */
  async validateRefreshToken(token) {
    if (!token) {
      return null;
    }
    
    // Hash token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const result = await pool.query(
      `SELECT * FROM refresh_tokens 
       WHERE token_hash = $1 
       AND expires_at > NOW() 
       AND is_revoked = FALSE
       LIMIT 1`,
      [tokenHash]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0];
  }

  /**
   * Update last_used timestamp for a refresh token
   * @param {string} tokenHash - Token hash
   * @returns {Promise<void>}
   */
  async updateLastUsed(tokenHash) {
    await pool.query(
      `UPDATE refresh_tokens 
       SET last_used_at = NOW() 
       WHERE token_hash = $1`,
      [tokenHash]
    );
  }

  /**
   * Revoke a specific refresh token
   * @param {string} token - Plain refresh token
   * @param {string} reason - Revocation reason
   * @returns {Promise<boolean>} True if revoked
   */
  async revokeRefreshToken(token, reason = 'user_logout') {
    if (!token) {
      return false;
    }
    
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const result = await pool.query(
      `UPDATE refresh_tokens 
       SET is_revoked = TRUE, 
           revoked_at = NOW(), 
           revoked_reason = $2
       WHERE token_hash = $1 
       AND is_revoked = FALSE
       RETURNING id`,
      [tokenHash, reason]
    );
    
    if (result.rowCount > 0) {
      console.log(`Refresh token revoked: ${reason}`);
      return true;
    }
    
    return false;
  }

  /**
   * Revoke a refresh token by hash (used for rotation)
   * @param {string} tokenHash - Token hash
   * @param {string} reason - Revocation reason
   * @returns {Promise<boolean>} True if revoked
   */
  async revokeRefreshTokenByHash(tokenHash, reason = 'token_rotation') {
    const result = await pool.query(
      `UPDATE refresh_tokens 
       SET is_revoked = TRUE, 
           revoked_at = NOW(), 
           revoked_reason = $2
       WHERE token_hash = $1 
       AND is_revoked = FALSE
       RETURNING id`,
      [tokenHash, reason]
    );
    
    return result.rowCount > 0;
  }

  /**
   * Revoke all refresh tokens for a user
   * @param {string} userId - User ID
   * @param {string} reason - Revocation reason
   * @returns {Promise<number>} Number of tokens revoked
   */
  async revokeAllUserTokens(userId, reason = 'security_incident') {
    const result = await pool.query(
      `UPDATE refresh_tokens 
       SET is_revoked = TRUE, 
           revoked_at = NOW(), 
           revoked_reason = $2
       WHERE user_id = $1 
       AND is_revoked = FALSE
       RETURNING id`,
      [userId, reason]
    );
    
    console.log(`Revoked ${result.rowCount} refresh tokens for user ${userId}`);
    
    return result.rowCount;
  }

  /**
   * Check if a token has been used before (for replay attack detection)
   * @param {string} token - Plain refresh token
   * @returns {Promise<boolean>} True if token was already used and revoked
   */
  async isTokenReused(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const result = await pool.query(
      `SELECT is_revoked, revoked_reason FROM refresh_tokens 
       WHERE token_hash = $1 
       LIMIT 1`,
      [tokenHash]
    );
    
    if (result.rows.length === 0) {
      return false;
    }
    
    const tokenRecord = result.rows[0];
    
    // If token is revoked with rotation reason, it means it was used before
    return tokenRecord.is_revoked && tokenRecord.revoked_reason === 'token_rotation';
  }

  /**
   * Clean up expired refresh tokens (maintenance)
   * @returns {Promise<number>} Number of tokens deleted
   */
  async cleanupExpiredTokens() {
    const result = await pool.query(
      `DELETE FROM refresh_tokens 
       WHERE expires_at < NOW() OR is_revoked = TRUE
       RETURNING id`
    );
    
    if (result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} expired/revoked refresh tokens`);
    }
    
    return result.rowCount;
  }
}

module.exports = new RefreshToken();
