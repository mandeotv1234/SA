import { create } from 'zustand';
import { io } from 'socket.io-client';

const getGatewayUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    try {
      const u = new URL(import.meta.env.VITE_API_URL);
      return u.origin;
    } catch (e) { }
  }
  return 'http://localhost:8000';
};

const GATEWAY = getGatewayUrl();
const API_BASE = `${GATEWAY}/api`;
const AUTH_BASE = `${GATEWAY}/auth`;
const WS_BASE = import.meta.env.VITE_WS_URL || GATEWAY;

function normalizeIncoming(msg) {
  try {
    if (msg && msg.kline) {
      const k = msg.kline;
      // Use openTime (Start of Candle) to align with Historical Data and prevent "thin" separated candles
      const timeSec = Math.floor((k.openTime || k.t) / 1000);
      const close = Number(k.close);
      const open = Number(k.open);
      const volume = Number(k.volume || k.v);
      return {
        t: timeSec,
        o: open,
        h: Number(k.high),
        l: Number(k.low),
        c: close,
        value: volume,
        color: close >= open ? '#089981' : '#f23645'
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

const useStore = create((set, get) => ({
  token: localStorage.getItem('token') || null,
  isVip: localStorage.getItem('isVip') === 'true',
  currentSymbol: 'BTCUSDT',
  price: null,
  socket: null,
  marketState: {},
  supportedSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT', 'ADAUSDT', 'XRPUSDT'],

  setSymbol: (symbol) => {
    set({ currentSymbol: symbol, price: null });
  },

  setIsVip: (isVip) => {
    localStorage.setItem('isVip', String(isVip));
    set({ isVip: !!isVip });
  },

  connectSocket: () => {
    const { token, socket, supportedSymbols } = get();
    if (socket && socket.connected) return;

    let url = WS_BASE;
    if (!/^https?:\/\//.test(url)) url = window.location.origin.replace(/\/$/, '');
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';

    const newSocket = io(`${url}${qs}`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      supportedSymbols.forEach(s => newSocket.emit('subscribe', s));
    });

    newSocket.on('price_event', (msg) => {
      const n = normalizeIncoming(msg);
      if (!n) return;

      const sym = msg.symbol.toUpperCase();
      const change = ((n.c - n.o) / n.o) * 100;

      set(state => ({
        marketState: {
          ...state.marketState,
          [sym]: { price: n.c, change: change }
        },
        price: sym === state.currentSymbol ? n : state.price
      }));
    });

    set({ socket: newSocket });
  },

  register: async (email, password, isVip) => {
    const res = await fetch(`${AUTH_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, is_vip: isVip })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText || 'Registration failed');
    }
    await get().login(email, password);
  },

  login: async (email, password) => {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();

    localStorage.setItem('token', data.token);
    localStorage.setItem('isVip', String(data.is_vip));

    set({ token: data.token, isVip: !!data.is_vip });

    const { socket } = get();
    if (socket) socket.disconnect();
    get().connectSocket();
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('isVip');
    const { socket } = get();
    if (socket) socket.disconnect();
    set({ token: null, isVip: false, socket: null });
  },

  authFetch: async (endpoint, options = {}) => {
    const { token } = get();
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
  }
}));

export default useStore;