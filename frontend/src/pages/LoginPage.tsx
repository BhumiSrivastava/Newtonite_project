import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useToast } from '../ToastContext';

const DEMO_USERS = [
  { username: 'alice_admin', role: 'Admin', teams: 'Platform Eng, Customer Support' },
  { username: 'bob_lead', role: 'Lead', teams: 'Platform Eng, Customer Support' },
  { username: 'carol_member', role: 'Member', teams: 'Platform Engineering' },
  { username: 'dave_member', role: 'Member', teams: 'Platform Engineering' },
  { username: 'eve_viewer', role: 'Viewer', teams: 'Platform Engineering' },
  { username: 'frank_lead', role: 'Lead', teams: 'Customer Support, Payments' },
  { username: 'hank_admin', role: 'Admin', teams: 'Payments, Compliance' },
  { username: 'iris_member', role: 'Member', teams: 'Payments, Compliance' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const { addToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    try {
      await login(username, password);
      addToast('success', 'Welcome back!');
    } catch (err: any) {
      addToast('error', err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (user: string) => {
    setLoading(true);
    try {
      await login(user, 'password123');
      addToast('success', `Logged in as ${user}`);
    } catch (err: any) {
      addToast('error', err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-title">Operations Under Pressure</div>
        <div className="login-subtitle">Internal ops dashboard — sign in to continue</div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className="form-input"
              type="text"
              placeholder="Enter username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="form-input"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button id="login-submit" className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 28 }}>
          <div className="form-label" style={{ marginBottom: 10 }}>Quick Login (Demo Users)</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {DEMO_USERS.map(u => (
              <button
                key={u.username}
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: 12, padding: '6px 10px' }}
                onClick={() => quickLogin(u.username)}
                disabled={loading}
                id={`quick-login-${u.username}`}
              >
                <span className="badge badge-role" style={{ minWidth: 56 }}>{u.role}</span>
                <span style={{ fontWeight: 600 }}>{u.username}</span>
                <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto', fontSize: 11 }}>
                  {u.teams}
                </span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
            All passwords: <code style={{ color: 'var(--accent-primary-hover)' }}>password123</code>
          </div>
        </div>
      </div>
    </div>
  );
}
