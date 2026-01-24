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
  user: null, // Add user state
  currentSymbol: 'BTCUSDT',

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

  // call init on create
  connectSocket: () => {
    // Ensure user is set
    if (!get().user && get().token) {
      set({ user: get().decodeUser(get().token) });
    }

    const { token, socket, supportedSymbols } = get();
    // ... existing connectSocket code ...

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

      // Join user room for notifications
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (payload && payload.sub) {
            console.log('Joining user room:', payload.sub);
            newSocket.emit('join_user_room', payload.sub);
          }
        } catch (e) {
          console.error('Failed to decode token for socket join', e);
        }
      }
    });

    newSocket.on('vip_update', async (data) => {
      console.log('Received VIP update:', data);
      if (data.isVip) {
        try {
          // Fetch fresh token with VIP claim
          const res = await get().authFetch('/auth/me');
          if (res.ok) {
            const responseData = await res.json();
            if (responseData.token) {
              console.log('Token refreshed with VIP status');
              localStorage.setItem('token', responseData.token);
              localStorage.setItem('isVip', 'true');
              set({ token: responseData.token, isVip: true });
            }
          }
        } catch (e) {
          console.error('Failed to refresh VIP token', e);
        }

        get().setIsVip(true);
      }
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