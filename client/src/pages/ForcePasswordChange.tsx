import { FormEvent, useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { api } from '../api/client';
import { InlineError } from '../components/Ui';

export default function ForcePasswordChange() {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      await api.post<{ ok: boolean }>('/auth/change-password', {
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      if (user) {
        setUser({ ...user, mustChangePassword: false });
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">A</div>
          <div className="auth-title">Change password required</div>
          <div className="auth-sub">Your password must be changed before you can continue.</div>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">Current password</span>
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">New password</span>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          <label className="field">
            <span className="field-label">Confirm new password</span>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </label>
          {error && <InlineError message={error} />}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Updating...' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}