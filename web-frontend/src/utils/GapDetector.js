/**
 * GapDetector - Utility for detecting and tracking sequence gaps
 * 
 * Tracks last seen sequence number per symbol in localStorage
 * Detects gaps when new sequence > last + 1
 */

class GapDetector {
    /**
     * Get last seen sequence number for a symbol
     * @param {string} symbol - Trading pair symbol (e.g., BTCUSDT)
     * @returns {number} Last seen sequence number (0 if none)
     */
    static getLastSeq(symbol) {
        const key = `lastSeq_${symbol}`;
        const value = localStorage.getItem(key);
        return value ? parseInt(value, 10) : 0;
    }

    /**
     * Set last seen sequence number for a symbol
     * @param {string} symbol - Trading pair symbol
     * @param {number} seq - Sequence number to save
     */
    static setLastSeq(symbol, seq) {
        const key = `lastSeq_${symbol}`;
        localStorage.setItem(key, seq.toString());
    }

    /**
     * Detect gap between last seen and current sequence
     * @param {string} symbol - Trading pair symbol
     * @param {number} currentSeq - Current sequence number
     * @returns {Object|null} Gap info or null if no gap
     */
    static detectGap(symbol, currentSeq) {
        const lastSeq = this.getLastSeq(symbol);

        // First message for this symbol
        if (lastSeq === 0) {
            return null;
        }

        // Gap detected: current sequence is more than 1 ahead
        if (currentSeq > lastSeq + 1) {
            return {
                symbol,
                fromSeq: lastSeq,
                toSeq: currentSeq - 1,
                gapSize: currentSeq - lastSeq - 1,
                detectedAt: Date.now()
            };
        }

        // No gap
        return null;
    }

    /**
     * Clear sequence tracking for a symbol
     * @param {string} symbol - Trading pair symbol
     */
    static clearSeq(symbol) {
        const key = `lastSeq_${symbol}`;
        localStorage.removeItem(key);
    }

    /**
     * Clear all sequence tracking
     */
    static clearAll() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('lastSeq_')) {
                localStorage.removeItem(key);
            }
        });
    }

    /**
     * Get all tracked symbols with their last sequences
     * @returns {Object} Map of symbol -> last sequence
     */
    static getAllTracked() {
        const tracked = {};
        const keys = Object.keys(localStorage);

        keys.forEach(key => {
            if (key.startsWith('lastSeq_')) {
                const symbol = key.replace('lastSeq_', '');
                tracked[symbol] = parseInt(localStorage.getItem(key), 10);
            }
        });

        return tracked;
    }

    /**
     * Check if sequence is continuous (no gap)
     * @param {string} symbol - Trading pair symbol
     * @param {number} currentSeq - Current sequence number
     * @returns {boolean} True if continuous, false if gap
     */
    static isContinuous(symbol, currentSeq) {
        const lastSeq = this.getLastSeq(symbol);

        if (lastSeq === 0) return true; // First message

        return currentSeq === lastSeq + 1;
    }

    /**
     * Get gap statistics for a symbol
     * @param {string} symbol - Trading pair symbol
     * @returns {Object} Gap statistics
     */
    static getStats(symbol) {
        const statsKey = `gapStats_${symbol}`;
        const stats = localStorage.getItem(statsKey);

        if (!stats) {
            return {
                totalGaps: 0,
                totalMissed: 0,
                totalRecovered: 0,
                lastGap: null
            };
        }

        return JSON.parse(stats);
    }

    /**
     * Update gap statistics
     * @param {string} symbol - Trading pair symbol
     * @param {Object} gap - Gap information
     * @param {number} recovered - Number of messages recovered
     */
    static updateStats(symbol, gap, recovered = 0) {
        const stats = this.getStats(symbol);

        stats.totalGaps += 1;
        stats.totalMissed += gap.gapSize;
        stats.totalRecovered += recovered;
        stats.lastGap = {
            fromSeq: gap.fromSeq,
            toSeq: gap.toSeq,
            gapSize: gap.gapSize,
            recovered: recovered,
            detectedAt: gap.detectedAt
        };

        const statsKey = `gapStats_${symbol}`;
        localStorage.setItem(statsKey, JSON.stringify(stats));
    }

    /**
     * Clear gap statistics for a symbol
     * @param {string} symbol - Trading pair symbol
     */
    static clearStats(symbol) {
        const statsKey = `gapStats_${symbol}`;
        localStorage.removeItem(statsKey);
    }
}

export default GapDetector;
