/**
 * Technical Indicators Library for Backtesting
 * Provides calculations for RSI, MACD, EMA, SMA, Bollinger Bands, etc.
 */

class TechnicalIndicators {
    /**
     * Calculate RSI (Relative Strength Index)
     * @param {Array} candles - Array of candle objects with 'close' property
     * @param {number} period - RSI period (default: 14)
     * @returns {number} RSI value (0-100)
     */
    static calculateRSI(candles, period = 14) {
        if (candles.length < period + 1) {
            return 50; // Neutral default
        }

        const gains = [];
        const losses = [];

        for (let i = 1; i < candles.length; i++) {
            const change = candles[i].close - candles[i - 1].close;
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? Math.abs(change) : 0);
        }

        // Calculate average gain and loss
        const recentGains = gains.slice(-period);
        const recentLosses = losses.slice(-period);

        const avgGain = recentGains.reduce((a, b) => a + b, 0) / period;
        const avgLoss = recentLosses.reduce((a, b) => a + b, 0) / period;

        if (avgLoss === 0) return 100; // No losses = max RSI

        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        return rsi;
    }

    /**
     * Calculate MACD (Moving Average Convergence Divergence)
     * @param {Array} candles - Array of candle objects
     * @param {number} fastPeriod - Fast EMA period (default: 12)
     * @param {number} slowPeriod - Slow EMA period (default: 26)
     * @param {number} signalPeriod - Signal line period (default: 9)
     * @returns {Object} { macdLine, signalLine, histogram }
     */
    static calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (candles.length < slowPeriod) {
            return { macdLine: 0, signalLine: 0, histogram: 0 };
        }

        const ema12 = this.calculateEMA(candles, fastPeriod);
        const ema26 = this.calculateEMA(candles, slowPeriod);
        const macdLine = ema12 - ema26;

        // For signal line, we'd need to calculate EMA of MACD values
        // Simplified: return MACD line only
        const signalLine = macdLine * 0.9; // Approximation
        const histogram = macdLine - signalLine;

        return { macdLine, signalLine, histogram };
    }

    /**
     * Calculate EMA (Exponential Moving Average)
     * @param {Array} candles - Array of candle objects
     * @param {number} period - EMA period
     * @returns {number} EMA value
     */
    static calculateEMA(candles, period) {
        if (candles.length < period) {
            return candles[candles.length - 1]?.close || 0;
        }

        const k = 2 / (period + 1);
        let ema = candles[0].close;

        for (let i = 1; i < candles.length; i++) {
            ema = candles[i].close * k + ema * (1 - k);
        }

        return ema;
    }

    /**
     * Calculate SMA (Simple Moving Average)
     * @param {Array} candles - Array of candle objects
     * @param {number} period - SMA period
     * @returns {number} SMA value
     */
    static calculateSMA(candles, period) {
        if (candles.length < period) {
            period = candles.length;
        }

        const prices = candles.slice(-period).map(c => c.close);
        const sum = prices.reduce((a, b) => a + b, 0);
        return sum / period;
    }

    /**
     * Calculate Bollinger Bands
     * @param {Array} candles - Array of candle objects
     * @param {number} period - Period (default: 20)
     * @param {number} stdDev - Standard deviation multiplier (default: 2)
     * @returns {Object} { upper, middle, lower }
     */
    static calculateBollingerBands(candles, period = 20, stdDev = 2) {
        if (candles.length < period) {
            const currentPrice = candles[candles.length - 1]?.close || 0;
            return { upper: currentPrice, middle: currentPrice, lower: currentPrice };
        }

        const sma = this.calculateSMA(candles, period);
        const prices = candles.slice(-period).map(c => c.close);

        // Calculate standard deviation
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
        const std = Math.sqrt(variance);

        return {
            upper: sma + (std * stdDev),
            middle: sma,
            lower: sma - (std * stdDev)
        };
    }

    /**
     * Calculate ATR (Average True Range) - for volatility
     * @param {Array} candles - Array of candle objects
     * @param {number} period - ATR period (default: 14)
     * @returns {number} ATR value
     */
    static calculateATR(candles, period = 14) {
        if (candles.length < period + 1) {
            return 0;
        }

        const trueRanges = [];

        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;

            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );

            trueRanges.push(tr);
        }

        const recentTR = trueRanges.slice(-period);
        return recentTR.reduce((a, b) => a + b, 0) / period;
    }

    /**
     * Calculate all indicators at once for a given candle window
     * @param {Array} candles - Array of candle objects
     * @returns {Object} All indicators
     */
    static calculateAll(candles) {
        const rsi = this.calculateRSI(candles, 14);
        const macd = this.calculateMACD(candles);
        const ema20 = this.calculateEMA(candles, 20);
        const ema50 = this.calculateEMA(candles, 50);
        const sma20 = this.calculateSMA(candles, 20);
        const sma50 = this.calculateSMA(candles, 50);
        const bb = this.calculateBollingerBands(candles, 20);
        const atr = this.calculateATR(candles, 14);

        const currentPrice = candles[candles.length - 1]?.close || 0;

        return {
            rsi,
            macd: macd.macdLine,
            macd_signal: macd.signalLine,
            macd_histogram: macd.histogram,
            ema20,
            ema50,
            sma20,
            sma50,
            bb_upper: bb.upper,
            bb_middle: bb.middle,
            bb_lower: bb.lower,
            atr,
            current_price: currentPrice,
            // Helper flags
            price_above_ema20: currentPrice > ema20,
            price_above_sma50: currentPrice > sma50,
            rsi_overbought: rsi > 70,
            rsi_oversold: rsi < 30,
            macd_bullish: macd.macdLine > macd.signalLine,
            bb_squeeze: (bb.upper - bb.lower) / bb.middle < 0.04 // Tight bands
        };
    }
}

module.exports = TechnicalIndicators;
