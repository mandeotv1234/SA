const WebSocket = require('ws');
const EventEmitter = require('events');

const BASE = 'wss://stream.binance.com:9443/stream?streams=';
const axios = require('axios');

// Backfill settings (number of 1m klines to fetch at startup)
const BACKFILL_LIMIT = parseInt(process.env.BACKFILL_LIMIT || '240', 10);

class BinanceClient extends EventEmitter {
  constructor(symbols = ['btcusdt'], interval = '1m') {
    super();
    this.symbols = symbols.map(s => s.replace(/@.*$/,'').toLowerCase());
    this.interval = interval;
    this.ws = null;
    this.backoff = 1000;
    this.maxBackoff = 60000;
    this.shouldStop = false;
  }

  _streamsParam() {
    return this.symbols.map(s => `${s}@kline_${this.interval}`).join('/');
  }

  connect() {
    if (this.shouldStop) return;
    const url = BASE + this._streamsParam();

    // Backfill recent klines via REST API so downstream consumers that start later
    // (like ai-service market cache) have historical context.
    this._backfill().catch(err => {
      console.warn('Backfill failed:', err && err.message ? err.message : err);
    });

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.backoff = 1000;
      this.emit('open');
      console.log('Binance combined WS connected:', this._streamsParam());
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        const data = msg.data || msg;
        if (data && data.e === 'kline' && data.k) {
          const k = data.k;
          const normalized = {
            symbol: String(k.s).toUpperCase(),
            interval: this.interval,
            kline: {
              openTime: Number(k.t),
              closeTime: Number(k.T),
              open: String(k.o),
              high: String(k.h),
              low: String(k.l),
              close: String(k.c),
              volume: String(k.v),
              isFinal: !!k.x
            }
          };
          this.emit('kline', normalized);
        } else {
          this.emit('raw', data);
        }
      } catch (err) {
        console.error('Binance parse error', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.warn('Binance WS closed', code, String(reason));
      this.emit('close', { code, reason });
      this._reconnect();
    });

    this.ws.on('error', (err) => {
      console.error('Binance WS error', err);
      this.emit('error', err);
      // ws 'close' will follow; no immediate reconnect here
    });
  }

  _reconnect() {
    if (this.shouldStop) return;
    setTimeout(() => {
      this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
      console.log('Reconnecting to Binance WS, backoff ms:', this.backoff);
      this.connect();
    }, this.backoff);
  }

  // Fetch recent klines for each symbol and emit them as finalized kline events
  async _backfill() {
    if (!BACKFILL_LIMIT || BACKFILL_LIMIT <= 0) return;
    const REST = 'https://api.binance.com/api/v3/klines';
    for (const s of this.symbols) {
      const symbolUpper = String(s).toUpperCase();
      try {
        const res = await axios.get(REST, {
          params: { symbol: symbolUpper, interval: this.interval, limit: BACKFILL_LIMIT }
        });
        if (Array.isArray(res.data)) {
          // Each item: [openTime, open, high, low, close, volume, closeTime, ...]
          for (const k of res.data) {
            const normalized = {
              symbol: symbolUpper,
              interval: this.interval,
              kline: {
                openTime: Number(k[0]),
                closeTime: Number(k[6]),
                open: String(k[1]),
                high: String(k[2]),
                low: String(k[3]),
                close: String(k[4]),
                volume: String(k[5]),
                isFinal: true
              }
            };
            // emit and allow producer to send
            this.emit('kline', normalized);
          }
          console.log(`Backfilled ${res.data.length} klines for ${symbolUpper}`);
        }
      } catch (err) {
        console.warn(`Failed backfill for ${symbolUpper}:`, err && err.message ? err.message : err);
      }
    }
  }

  updateSymbols(symbols) {
    this.symbols = symbols.map(s => s.replace(/@.*$/,'').toLowerCase());
    this.restart();
  }

  restart() {
    this.close();
    setTimeout(() => this.connect(), 100);
  }

  close() {
    this.shouldStop = true;
    if (this.ws) {
      try { this.ws.terminate(); } catch (e) {}
      this.ws = null;
    }
  }
}

module.exports = BinanceClient;