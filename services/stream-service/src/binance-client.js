const WebSocket = require('ws');
const EventEmitter = require('events');

const BASE = 'wss://stream.binance.com:9443/stream?streams=';

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