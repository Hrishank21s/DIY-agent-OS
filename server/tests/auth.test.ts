import { describe, it, expect } from 'vitest';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { AuthService } from '../src/services/auth.js';

describe('AuthService', () => {
  it('logs in with bootstrap credentials', () => {
    const db = getDb();
    seed(db);
    const auth = new AuthService();
    const r = auth.login('admin', 'admin123');
    expect(r).not.toBeNull();
    expect(r!.user.mustChangePassword).toBe(true);
  });

  it('rejects wrong password', () => {
    getDb();
    seed(getDb());
    const auth = new AuthService();
    expect(auth.login('admin', 'wrongpass')).toBeNull();
  });

  it('validates a session token', () => {
    getDb();
    seed(getDb());
    const auth = new AuthService();
    const r = auth.login('admin', 'admin123')!;
    const user = auth.validate(r.token);
    expect(user).not.toBeNull();
    expect(user!.username).toBe('admin');
  });

  it('rejects invalid/expired tokens', () => {
    getDb();
    seed(getDb());
    const auth = new AuthService();
    expect(auth.validate('garbage-token')).toBeNull();
    expect(auth.validate(undefined)).toBeNull();
  });

  it('logout revokes the session', () => {
    getDb();
    seed(getDb());
    const auth = new AuthService();
    const r = auth.login('admin', 'admin123')!;
    expect(auth.validate(r.token)).not.toBeNull();
    auth.logout(r.token);
    expect(auth.validate(r.token)).toBeNull();
  });

  it('rejects short new passwords', () => {
    getDb();
    seed(getDb());
    const auth = new AuthService();
    const r = auth.login('admin', 'admin123')!;
    const res = auth.changePassword(r.user.id, 'admin123', 'short');
    expect(res.ok).toBe(false);
  });

  it('changes password and updates must_change', () => {
    getDb();
    seed(getDb());
    const auth = new AuthService();
    const r = auth.login('admin', 'admin123')!;
    const res = auth.changePassword(r.user.id, 'admin123', 'newpass123');
    expect(res.ok).toBe(true);
    // old password no longer valid
    expect(auth.login('admin', 'admin123')).toBeNull();
    expect(auth.login('admin', 'newpass123')).not.toBeNull();
  });
});
