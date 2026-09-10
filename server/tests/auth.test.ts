import { describe, it, expect } from 'vitest';
import { getDb } from '../src/db/index.js';
import { seed, isValidBootstrapPassword, resetBootstrapUser } from '../src/db/seed.js';
import { AuthService } from '../src/services/auth.js';
import { hashToken } from '../src/lib/password.js';

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

  it('password change revokes other sessions but keeps the current one', () => {
    const db = getDb();
    seed(db);
    resetBootstrapUser(db);
    const auth = new AuthService();
    const a = auth.login('admin', 'admin123')!;
    const b = auth.login('admin', 'admin123')!;
    expect(auth.validate(a.token)).not.toBeNull();
    expect(auth.validate(b.token)).not.toBeNull();
    const res = auth.changePassword(a.user.id, 'admin123', 'newpass123', hashToken(a.token));
    expect(res.ok).toBe(true);
    expect(auth.validate(a.token)).not.toBeNull();
    expect(auth.validate(b.token)).toBeNull();
  });

  it('classifies weak bootstrap passwords', () => {
    expect(isValidBootstrapPassword('admin123')).toBe(false);
    expect(isValidBootstrapPassword('short')).toBe(false);
    expect(isValidBootstrapPassword('')).toBe(false);
    expect(isValidBootstrapPassword('correct-horse-battery-staple')).toBe(true);
  });

  it('resetBootstrapUser restores the bootstrap credentials', () => {
    const db = getDb();
    seed(db);
    const auth = new AuthService();
    db.db.prepare("UPDATE users SET password_hash = 'x' WHERE username = 'admin'").run();
    expect(auth.login('admin', 'admin123')).toBeNull();
    resetBootstrapUser(db);
    expect(auth.login('admin', 'admin123')).not.toBeNull();
  });
});
