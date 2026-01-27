const { getRedisClient } = require('../config/redis');

class TokenBlacklist {
  /**
   * Add a token's JTI to the blacklist
   * @param {string} jti - JWT ID
   * @param {number} ttl - Time to live in seconds (should match token expiration)
   * @returns {Promise<void>}
   */
  async addToBlacklist(jti, ttl) {
    if (!jti) {
      throw new Error('JTI is required');
    }
    
    const redis = await getRedisClient();
    const key = `blacklist:${jti}`;
    
    // Set the value to "1" with TTL
    await redis.setEx(key, ttl, '1');
    console.log(`Token ${jti} added to blacklist with TTL ${ttl}s`);
  }

  /**
   * Check if a token's JTI is blacklisted
   * @param {string} jti - JWT ID
   * @returns {Promise<boolean>} - True if blacklisted
   */
  async isBlacklisted(jti) {
    if (!jti) {
      return false;
    }
    
    const redis = await getRedisClient();
    const key = `blacklist:${jti}`;
    const value = await redis.get(key);
    
    return value === '1';
  }

  /**
   * Remove a token from the blacklist (for testing)
   * @param {string} jti - JWT ID
   * @returns {Promise<void>}
   */
  async removeFromBlacklist(jti) {
    if (!jti) {
      return;
    }
    
    const redis = await getRedisClient();
    const key = `blacklist:${jti}`;
    await redis.del(key);
    console.log(`Token ${jti} removed from blacklist`);
  }

  /**
   * Add all active tokens for a user to the blacklist
   * @param {string} userId - User ID
   * @param {Array<{jti: string, exp: number}>} tokens - Array of token info
   * @returns {Promise<void>}
   */
  async addUserTokensToBlacklist(userId, tokens) {
    if (!tokens || tokens.length === 0) {
      return;
    }

    const redis = await getRedisClient();
    const now = Math.floor(Date.now() / 1000);

    for (const token of tokens) {
      const ttl = token.exp - now;
      if (ttl > 0) {
        await this.addToBlacklist(token.jti, ttl);
      }
    }

    console.log(`Added ${tokens.length} tokens for user ${userId} to blacklist`);
  }
}

module.exports = new TokenBlacklist();
