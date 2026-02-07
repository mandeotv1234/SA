/**
 * Technical Indicators Calculation Utilities
 * Tính toán các chỉ báo kỹ thuật: SMA, EMA, RSI, MACD, Bollinger Bands
 */

/**
 * Simple Moving Average (SMA)
 * @param {Array} data - Array of candle data with 'close' property
 * @param {number} period - Period for SMA (e.g., 20, 50, 200)
 * @returns {Array} Array of {time, value} for line series
 */
export function calculateSMA(data, period) {
    if (!data || data.length < period) return [];

    const result = [];

    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        const avg = sum / period;
        result.push({
            time: data[i].time,
            value: avg
        });
    }

    return result;
}

/**
 * Exponential Moving Average (EMA)
 * @param {Array} data - Array of candle data with 'close' property
 * @param {number} period - Period for EMA (e.g., 12, 26, 50)
 * @returns {Array} Array of {time, value} for line series
 */
export function calculateEMA(data, period) {
    if (!data || data.length < period) return [];

    const result = [];
    const multiplier = 2 / (period + 1);

    // Start with SMA for first value
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i].close;
    }
    let ema = sum / period;

    result.push({
        time: data[period - 1].time,
        value: ema
    });

    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
        ema = (data[i].close - ema) * multiplier + ema;
        result.push({
            time: data[i].time,
            value: ema
        });
    }

    return result;
}

/**
 * Relative Strength Index (RSI)
 * @param {Array} data - Array of candle data with 'close' property
 * @param {number} period - Period for RSI (typically 14)
 * @returns {Array} Array of {time, value} for line series
 */
export function calculateRSI(data, period = 14) {
    if (!data || data.length < period + 1) return [];

    const result = [];
    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) {
            gains += change;
        } else {
            losses -= change;
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate RSI
    for (let i = period; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        result.push({
            time: data[i].time,
            value: rsi
        });
    }

    return result;
}

/**
 * Bollinger Bands
 * @param {Array} data - Array of candle data with 'close' property
 * @param {number} period - Period for moving average (typically 20)
 * @param {number} stdDev - Number of standard deviations (typically 2)
 * @returns {Object} {upper: [], middle: [], lower: []}
 */
export function calculateBollingerBands(data, period = 20, stdDev = 2) {
    if (!data || data.length < period) return { upper: [], middle: [], lower: [] };

    const upper = [];
    const middle = [];
    const lower = [];

    for (let i = period - 1; i < data.length; i++) {
        // Calculate SMA
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        const sma = sum / period;

        // Calculate standard deviation
        let variance = 0;
        for (let j = 0; j < period; j++) {
            variance += Math.pow(data[i - j].close - sma, 2);
        }
        const std = Math.sqrt(variance / period);

        const time = data[i].time;
        middle.push({ time, value: sma });
        upper.push({ time, value: sma + stdDev * std });
        lower.push({ time, value: sma - stdDev * std });
    }

    return { upper, middle, lower };
}

/**
 * MACD (Moving Average Convergence Divergence)
 * @param {Array} data - Array of candle data with 'close' property
 * @param {number} fastPeriod - Fast EMA period (typically 12)
 * @param {number} slowPeriod - Slow EMA period (typically 26)
 * @param {number} signalPeriod - Signal line period (typically 9)
 * @returns {Object} {macd: [], signal: [], histogram: []}
 */
export function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!data || data.length < slowPeriod) return { macd: [], signal: [], histogram: [] };

    const fastEMA = calculateEMA(data, fastPeriod);
    const slowEMA = calculateEMA(data, slowPeriod);

    // Calculate MACD line
    const macdLine = [];
    const startIndex = slowPeriod - fastPeriod;

    for (let i = 0; i < slowEMA.length; i++) {
        const time = slowEMA[i].time;
        const fastValue = fastEMA[i + startIndex].value;
        const slowValue = slowEMA[i].value;
        macdLine.push({
            time,
            value: fastValue - slowValue
        });
    }

    // Calculate signal line (EMA of MACD)
    const signalLine = calculateEMA(macdLine, signalPeriod);

    // Calculate histogram
    const histogram = [];
    for (let i = 0; i < signalLine.length; i++) {
        const macdValue = macdLine[i + (macdLine.length - signalLine.length)].value;
        const signalValue = signalLine[i].value;
        histogram.push({
            time: signalLine[i].time,
            value: macdValue - signalValue,
            color: macdValue >= signalValue ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
        });
    }

    return {
        macd: macdLine,
        signal: signalLine,
        histogram
    };
}
