// ...existing code...
import React from 'react';
import { io } from 'socket.io-client';

let socket = null;

function normalizeIncoming(msg) {
  // normalize different incoming shapes to { t, o, h, l, c } where t is seconds
  try {
    // normalized: { symbol, interval, kline: { openTime(ms), closeTime(ms), open, high, low, close } }
    if (msg && msg.kline) {
      const k = msg.kline;
      const timeSec = Math.floor((k.closeTime || k.openTime) / 1000);
      return { t: timeSec, o: Number(k.open), h: Number(k.high), l: Number(k.low), c: Number(k.close) };
    }
    // Binance raw: { data: { k: { t, T, o, h, l, c } } }
    if (msg && msg.data && msg.data.k) {
      const k = msg.data.k;
      const timeSec = Math.floor((k.T || k.t) / 1000);
      return { t: timeSec, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c) };
    }
    // lightweight shape: { t (sec), o, h, l, c }
    if (msg && msg.t && msg.o !== undefined) {
      return { t: Number(msg.t), o: Number(msg.o), h: Number(msg.h), l: Number(msg.l), c: Number(msg.c) };
    }
  } catch (e) { /* ignore parse errors */ }
  return null;
}

export default function useStore() {
  const [token, setToken] = React.useState(() => {
    try { return localStorage.getItem('token'); } catch (e) { return null; }
  });
  const [price, setPrice] = React.useState(null);

  const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/$/, '');
  const LOGIN_URL = import.meta.env.VITE_LOGIN_URL || `${API_BASE.replace(/\/api\/?$/, '')}/auth/login`;
  // WS base: use VITE_WS_URL or base host of API (strip /api)
  const WS_BASE = (import.meta.env.VITE_WS_URL || API_BASE.replace(/\/api\/?$/, '')).replace(/\/$/, '');

  const login = React.useCallback(async (email, password) => {
    const url = `${LOGIN_URL}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText || 'Login failed');
    }
    const body = await res.json();
    const t = body.token;
    if (!t) throw new Error('No token returned');
    try { localStorage.setItem('token', t); } catch (e) {}
    setToken(t);
    // reconnect socket with token
    connectSocket(t);
    return t;
  }, []);

  const logout = React.useCallback(() => {
    try { localStorage.removeItem('token'); } catch (e) {}
    setToken(null);
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }, []);

  const authFetch = React.useCallback((input, init = {}) => {
    const url = typeof input === 'string' && input.startsWith('http') ? input : `${API_BASE}${input.startsWith('/') ? '' : '/'}${input}`;
    init.headers = { ...(init.headers || {}), 'Content-Type': 'application/json' };
    if (token) init.headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, init);
  }, [token]);

 // ...existing code...
  const connectSocket = React.useCallback((providedToken) => {
    const tok = providedToken !== undefined ? providedToken : token;
    if (socket && socket.connected) return socket;

    const path = '/socket.io';
    // Build URL and append token as query param so Kong can read it during WS handshake
    let url = WS_BASE;
    if (!/^https?:\/\//.test(url)) url = window.location.origin.replace(/\/$/, '');
    const qs = tok ? `?token=${encodeURIComponent(tok)}` : '';
    socket = io(`${url}${qs}`, { path, transports: ['websocket'] });

    socket.on('connect', () => console.log('socket connected', socket.id));
    socket.on('disconnect', (reason) => console.log('socket disconnected', reason));
    socket.on('price_event', (msg) => {
      const n = normalizeIncoming(msg);
      if (n) setPrice(n);
    });
    socket.on('connect_error', (err) => console.error('socket connect_error', err));
    return socket;
  }, [token]);

  // auto-connect / reconnect when token changes
  React.useEffect(() => {
    if (token) {
      connectSocket(token);
    } else {
      // ensure disconnect if logged out
      if (socket) { socket.disconnect(); socket = null; }
    }
    return () => {
      if (socket) { socket.disconnect(); socket = null; }
    };
  }, [token, connectSocket]); // eslint-disable-line
// ...existing code...

  return {
    price,
    connectSocket,
    login,
    logout,
    token,
    authFetch
  };
}