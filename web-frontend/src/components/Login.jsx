import React, { useState } from 'react';
import useStore from '../store';
import { Activity, ArrowRight } from 'lucide-react';

export default function Login() {
  const { login, register } = useStore();
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isVip, setIsVip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email.trim().toLowerCase(), password);
      } else {
        await register(email.trim().toLowerCase(), password, isVip);
      }
    } catch (err) {
      setError(err.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity style={{ color: 'var(--accent-blue)' }} size={32} />
            <span style={{ fontWeight: 'bold', fontSize: 24, letterSpacing: '-0.5px', color: 'white' }}>TradeAI</span>
          </div>
        </div>

        <h2 style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 24, textAlign: 'center' }}>
          {mode === 'login' ? 'Sign in to your account' : 'Create an account'}
        </h2>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="login-label">Email</label>
            <input
              type="email"
              required
              className="login-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="login-label">Password</label>
            <input
              type="password"
              required
              className="login-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {mode === 'register' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="isVip"
                checked={isVip}
                onChange={e => setIsVip(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="isVip" style={{ fontSize: 13, color: 'var(--accent-yellow)', cursor: 'pointer', fontWeight: 'bold' }}>
                Register as VIP (Demo)
              </label>
            </div>
          )}

          {error && (
            <div style={{
              backgroundColor: 'rgba(127, 29, 29, 0.2)',
              border: '1px solid rgba(127, 29, 29, 0.5)',
              color: '#f87171',
              padding: 8,
              borderRadius: 4,
              fontSize: 14,
              textAlign: 'center'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="login-btn"
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
          >
            {loading ? 'Processing...' : (mode === 'login' ? 'Sign in' : 'Create Account')}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>
          {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 'bold', textDecoration: 'underline' }}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}