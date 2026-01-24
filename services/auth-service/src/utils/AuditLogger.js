const fs = require('fs');
const path = require('path');

class AuditLogger {
  constructor() {
    // Create logs directory if it doesn't exist
    this.logsDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Log structured event to console and file
   * @param {Object} event - Event object
   */
  _log(event) {
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event
    });

    // Log to console
    console.log(logEntry);

    // Log to file (append)
    const logFile = path.join(this.logsDir, 'audit.log');
    fs.appendFileSync(logFile, logEntry + '\n');
  }

  /**
   * Log authentication attempt
   * @param {string} userId - User ID (if known)
   * @param {string} email - User email
   * @param {string} ipAddress - IP address
   * @param {string} userAgent - User agent
   * @param {boolean} success - Whether authentication succeeded
   * @param {string} reason - Failure reason (if applicable)
   */
  logAuthAttempt(userId, email, ipAddress, userAgent, success, reason = null) {
    this._log({
      event_type: success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
      severity: success ? 'INFO' : 'WARNING',
      user_id: userId,
      email: email,
      ip_address: ipAddress,
      user_agent: userAgent,
      success: success,
      reason: reason
    });
  }

  /**
   * Log token revocation
   * @param {string} jti - JWT ID
   * @param {string} userId - User ID
   * @param {string} reason - Revocation reason
   * @param {string} adminId - Admin ID (if revoked by admin)
   */
  logTokenRevocation(jti, userId, reason, adminId = null) {
    this._log({
      event_type: 'TOKEN_REVOKED',
      severity: 'WARNING',
      jti: jti,
      user_id: userId,
      reason: reason,
      admin_id: adminId
    });
  }

  /**
   * Log security event
   * @param {string} eventType - Type of security event
   * @param {string} severity - Severity level (INFO, WARNING, CRITICAL)
   * @param {Object} metadata - Additional metadata
   */
  logSecurityEvent(eventType, severity, metadata) {
    this._log({
      event_type: eventType,
      severity: severity,
      ...metadata
    });
  }

  /**
   * Log direct access attempt (potential security breach)
   * @param {string} ipAddress - IP address
   * @param {string} path - Requested path
   * @param {Object} headers - Request headers
   */
  logDirectAccessAttempt(ipAddress, path, headers) {
    this._log({
      event_type: 'DIRECT_ACCESS_ATTEMPT',
      severity: 'CRITICAL',
      ip_address: ipAddress,
      path: path,
      headers: headers,
      blocked: true
    });
  }

  /**
   * Log account lockout
   * @param {string} userId - User ID
   * @param {string} email - User email
   * @param {string} ipAddress - IP address
   * @param {number} attemptCount - Number of failed attempts
   * @param {Date} lockedUntil - When the account will be unlocked
   */
  logAccountLockout(userId, email, ipAddress, attemptCount, lockedUntil) {
    this._log({
      event_type: 'ACCOUNT_LOCKED',
      severity: 'CRITICAL',
      user_id: userId,
      email: email,
      ip_address: ipAddress,
      attempt_count: attemptCount,
      locked_until: lockedUntil.toISOString()
    });
  }
}

module.exports = new AuditLogger();
