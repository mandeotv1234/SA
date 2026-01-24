import { create } from 'zustand';
import { io } from 'socket.io-client';
import GapDetector from './utils/GapDetector';
import GapRecovery from './utils/GapRecovery';

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
  user: null, // Add user state
  currentSymbol: 'BTCUSDT',

  // Gap detection state
  isRecovering: false,
  gapStats: {},
  recoveryProgress: null,

  // Helper to decode token
  decodeUser: (token) => {
    try {
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return { id: payload.sub, email: payload.sub, role: payload.role };
    } catch (e) {
      console.error('Failed to decode token', e);
      return null;
    }
  },

  // Init user from stored token
  init: () => {
    const token = localStorage.getItem('token');
    if (token) {
      const user = get().decodeUser(token);
      set({ user });
    }
  },

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

  // Process message with gap detection
  processMessageWithGapDetection: async (msg, onMessage, isRecovered = false) => {
    if (!msg || !msg.symbol || !msg.seq) {
      console.warn('[Store] Invalid message:', msg);
      return;
    }

    const symbol = msg.symbol.toUpperCase();

    // Detect gaps for live messages only
    if (!isRecovered) {
      const gap = GapDetector.detectGap(symbol, msg.seq);

      if (gap) {
        console.warn(`[Store] Gap detected for ${symbol}:`, gap);

        // Recover gap asynchronously
        set({ isRecovering: true });

        try {
          await GapRecovery.recoverGap(
            gap,
            get().token,
            (recoveredMsg) => {
              // Process recovered message
              if (onMessage) onMessage(recoveredMsg, true);
            },
            (progress) => {
              set({ recoveryProgress: progress });
            }
          );

          // Update gap stats
          const stats = GapDetector.getStats(symbol);
          set((state) => ({
            gapStats: { ...state.gapStats, [symbol]: stats }
          }));
        } catch (error) {
          console.error('[Store] Gap recovery failed:', error);
        } finally {
          set({ isRecovering: false, recoveryProgress: null });
        }
      }

      // Update last seen sequence
      GapDetector.setLastSeq(symbol, msg.seq);
    }

    // Process current message
    if (onMessage) onMessage(msg, isRecovered);
  },

  // Get gap statistics for a symbol
  getGapStats: (symbol) => {
    return GapDetector.getStats(symbol);
  },

  // Clear gap tracking for a symbol
  clearGapTracking: (symbol) => {
    GapDetector.clearSeq(symbol);
    GapDetector.clearStats(symbol);
    set((state) => {
      const newStats = { ...state.gapStats };
      delete newStats[symbol];
      return { gapStats: newStats };
    });
  },

  // call init on create
  connectSocket: () => {
    // DISABLED: Each chart now manages its own Socket.IO connection
    // This global socket was for the old Chart component
    console.log('[Store] Global socket connection disabled - charts manage their own connections');

    // Still decode user if needed
    if (!get().user && get().token) {
      set({ user: get().decodeUser(get().token) });
    }

    // Don't create socket connection anymore
    // MultiTimeframeChart components handle their own Socket.IO connections
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

    const user = get().decodeUser(data.token);
    set({ token: data.token, isVip: !!data.is_vip, user });

    const { socket } = get();
    if (socket) socket.disconnect();
    get().connectSocket();
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('isVip');
    const { socket } = get();
    if (socket) socket.disconnect();
    set({ token: null, isVip: false, socket: null, user: null });
  },

  authFetch: async (endpoint, options = {}) => {
    const { token } = get();
    let url = endpoint;
    if (!endpoint.startsWith('http')) {
      if (endpoint.startsWith('/auth')) {
        url = `${GATEWAY}${endpoint}`;
      } else if (endpoint.startsWith('/v1/investments')) {
        url = `${GATEWAY}/invest-api${endpoint}`;
      } else {
        url = `${API_BASE}${endpoint}`;
      }
    }
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
  }
}));

export default useStore;