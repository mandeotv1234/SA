import React, { useState } from 'react';
import useStore from '../store';
import { Activity, ArrowRight } from 'lucide-react';

const styles = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: 'linear-gradient(135deg, var(--bg-dark) 0%, #0a0b0f 100%)',
    position: 'relative',
    overflow: 'hidden',
  },
  pageBg: {
    position: 'absolute',
    top: '-50%',
    left: '-50%',
    width: '200%',
    height: '200%',
    background:
      'radial-gradient(circle, rgba(56, 97, 251, 0.1) 0%, transparent 70%)',
    animation: 'rotate 20s linear infinite',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: 'var(--bg-panel)',
    padding: '40px',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
    textAlign: 'center',
    boxShadow:
      '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 100px rgba(56, 97, 251, 0.1)',
    position: 'relative',
    zIndex: 1,
    backdropFilter: 'blur(10px)',
  },
  logoContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logoIcon: {
    color: 'var(--accent-blue)',
    filter: 'drop-shadow(0 0 8px rgba(56, 97, 251, 0.5))',
  },
  logoText: {
    fontWeight: '700',
    fontSize: '28px',
    letterSpacing: '-0.5px',
    color: 'var(--text-primary)',
  },
  title: {
    fontSize: '20px',
    fontWeight: '700',
    marginBottom: '32px',
    textAlign: 'center',
    color: 'var(--text-primary)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  formGroup: {
    textAlign: 'left',
  },
  hint: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    opacity: 0.6,
    marginTop: '8px',
  },
  hintText: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
  },
  error: {
    backgroundColor: 'rgba(246, 70, 93, 0.15)',
    border: '1px solid rgba(246, 70, 93, 0.5)',
    color: 'var(--accent-red)',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '14px',
    textAlign: 'center',
    fontWeight: '500',
  },
  buttonInner: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '8px',
  },
  footer: {
    marginTop: '24px',
    textAlign: 'center',
    fontSize: '13px',
    color: 'var(--text-secondary)',
  },
  switchBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--accent-blue)',
    cursor: 'pointer',
    fontWeight: '600',
    textDecoration: 'none',
    transition: 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)',
    padding: '2px 4px',
    borderRadius: '4px',
  },
};

export default function Login() {
  const { login, register } = useStore();
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const validatePassword = (pwd) => {
    // Tối thiểu 8 ký tự, 1 hoa, 1 thường, 1 số, 1 ký tự đặc biệt
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    return regex.test(pwd);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (mode === 'register') {
      if (!validatePassword(password)) {
        setError('Mật khẩu phải có ít nhất 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Mật khẩu xác nhận không khớp.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email.trim().toLowerCase(), password);
      } else {
        await register(email.trim().toLowerCase(), password);
      }
    } catch (err) {
      // Dịch một số lỗi phổ biến từ backend nếu cần
      const errMsg = err.message || 'Thao tác thất bại';
      if (errMsg.includes('User already exists')) setError('Email này đã được đăng ký.');
      else if (errMsg.includes('Invalid credentials')) setError('Email hoặc mật khẩu không đúng.');
      else setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.pageBg} />
      <div style={styles.card}>
        <div style={styles.logoContainer}>
          <div style={styles.logo}>
            <Activity style={styles.logoIcon} size={36} />
            <span style={styles.logoText}>TradeAI</span>
          </div>
        </div>

        <h2 style={styles.title}>
          {mode === 'login' ? 'Đăng nhập vào tài khoản' : 'Tạo tài khoản mới'}
        </h2>

        <form onSubmit={submit} style={styles.form}>
          <div style={styles.formGroup}>
            <label className='login-label'>Email</label>
            <input
              type='email'
              required
              className='login-input'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder='email@example.com'
            />
          </div>
          <div style={styles.formGroup}>
            <label className='login-label'>Mật khẩu</label>
            <input
              type='password'
              required
              className='login-input'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='••••••••'
            />
          </div>

          {mode === 'register' && (
            <div style={styles.formGroup}>
              <label className='login-label'>Xác nhận mật khẩu</label>
              <input
                type='password'
                required
                className='login-input'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder='••••••••'
              />
            </div>
          )}

          {mode === 'register' && (
            <div style={styles.hint}>
              <span style={styles.hintText}>
                Tài khoản tiêu chuẩn (Có thể nâng cấp bên trong)
              </span>
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button
            type='submit'
            disabled={loading}
            className='login-btn'
            style={styles.buttonInner}
          >
            {loading
              ? 'Đang xử lý...'
              : mode === 'login'
                ? 'Đăng Nhập'
                : 'Đăng Ký'}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <div style={styles.footer}>
          {mode === 'login'
            ? "Chưa có tài khoản? "
            : 'Đã có tài khoản? '}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            style={styles.switchBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(56, 97, 251, 0.1)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {mode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập ngay'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
