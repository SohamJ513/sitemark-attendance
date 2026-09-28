import { useState } from 'react';
import { api, getUser, saveSession, clearSession } from './api.js';
import Employee from './Employee.jsx';
import Admin from './Admin.jsx';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token, user } = await api.login(email, password);
      saveSession(token, user);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card login" onSubmit={submit}>
        <h1>SiteMark</h1>
        <p className="muted">On-site attendance for the field team</p>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(getUser());

  const logout = () => {
    if (!window.confirm('Log out of SiteMark?')) return;
    clearSession();
    setUser(null);
  };

  if (!user) return <Login onLogin={setUser} />;

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 3c-3.6 0-6.4 2.8-6.4 6.3C5.6 14 12 21 12 21s6.4-7 6.4-11.7C18.4 5.8 15.6 3 12 3z" stroke="currentColor" strokeWidth="1.6"/><path d="M9.3 10.2l1.8 1.8 3.4-3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span className="brand-name">SiteMark</span>
        </div>
        <div className="who">
          <span className="avatar">{initials}</span>
          <span className="who-text">
            <strong>{user.name}</strong>
            <span className="role-tag">{user.role}</span>
          </span>
        </div>
        <button className="btn logout" onClick={logout}>Log out</button>
      </header>
      {user.role === 'admin' ? <Admin /> : <Employee />}
    </>
  );
}