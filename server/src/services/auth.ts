import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword, hashToken, generateToken } from '../lib/password.js';
import { AuditService } from './audit.js';
import { SettingsService } from './settings.js';

const audit = new AuditService();
const settings = new SettingsService();
// Verify against a costly dummy hash when a username does not exist so
// response timing leaks nothing about whether the account is real (#16).
const DUMMY_HASH = hashPassword(generateToken());

export const LOGIN_FAIL_WINDOW_MINUTES = 15;

/** How many failed attempts lock an account for a while (#12). */
function lockoutPolicy(): { threshold: number; lockoutMinutes: number } {
  return {
    threshold: settings.getNumber('login_failed_attempts', 5),
    lockoutMinutes: settings.getNumber('login_lockout_minutes', 15),
  };
}

export interface AuthedUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

export interface LoginResult {
  token: string;
  user: AuthedUser;
}

function pruneSessions(userId: string, keep = 50): void {
  const db = getDb();
  // Purge expired sessions for everyone once in a while.
  db.db.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')').run();
  // Keep only the most recent `keep` sessions per user so the table never
  // grows unbounded through repeat logins (#17).
  db.db
    .prepare(
      `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
         SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
    )
    .run(userId, userId, keep);
}

export class AuthService {
  login(username: string, password: string, ip?: string): LoginResult | null {
    const db = getDb();
    const row = db.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;

    // Brute-force guard: replay a failed attempt against a real budget BEFORE
    // any verification work so attackers cannot probe the policy by timing.
    if (this.isLockedOut(username, ip)) {
      audit.record('login.locked', 'auth', { username }, row?.id as string | undefined, ip);
      return null;
    }

    // Two branches verify against *something* in both cases (timing-equalized):
    // missing user -> dummy hash; present user -> their real hash.
    const hash = row ? (row.password_hash as string) : DUMMY_HASH;
    const ok = verifyPassword(hash, password);

    if (!row || !ok) {
      this.recordAttempt(username, ip, false);
      audit.record('login.failed', 'auth', { username }, row?.id as string | undefined, ip);
      return null;
    }

    this.recordAttempt(username, ip, true);
    const token = generateToken();
    const durationMin = this.sessionDurationMinutes();
    const expiresAt = new Date(Date.now() + durationMin * 60_000).toISOString();
    db.db
      .prepare(
        'INSERT INTO sessions (id, user_id, token_hash, expires_at, ip) VALUES (?, ?, ?, ?, ?)',
      )
      .run(nanoid(), row.id as string, hashToken(token), expiresAt, ip || null);
    pruneSessions(row.id as string);
    audit.record('login.success', 'auth', { username }, row.id as string, ip);
    return {
      token,
      user: {
        id: row.id as string,
        username: row.username as string,
        mustChangePassword: (row.must_change_password as number) === 1,
      },
    };
  }

  private recordAttempt(username: string, ip?: string, success = false): void {
    const db = getDb();
    db.db
      .prepare('INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)')
      .run(username, ip || null, success ? 1 : 0);
    if (success) {
      // A successful login clears the failure run for that username+ip.
      db.db.prepare('DELETE FROM login_attempts WHERE username = ? AND success = 0').run(username);
    }
  }

  isLockedOut(username: string, _ip?: string): boolean {
    const { threshold, lockoutMinutes } = lockoutPolicy();
    if (threshold <= 0) return false;
    const db = getDb();
    const since = new Date(Date.now() - LOGIN_FAIL_WINDOW_MINUTES * 60_000).toISOString();
    const row = db.db
      .prepare(
        `SELECT COUNT(*) AS c FROM login_attempts
         WHERE username = ? AND success = 0 AND created_at > ?`,
      )
      .get(username, since) as { c: number };
    const failedNow = (row?.c ?? 0) >= threshold;
    if (!failedNow) return false;
    const recent = db.db
      .prepare(
        `SELECT MAX(created_at) AS m FROM login_attempts
         WHERE username = ? AND success = 0 AND created_at > ?`,
      )
      .get(username, since) as { m: string | null };
    if (recent?.m) {
      const lockedUntil = new Date(new Date(recent.m).getTime() + lockoutMinutes * 60_000);
      if (lockedUntil.getTime() > Date.now()) return true;
      // The failure window elapsed; forgive the run.
      db.db.prepare('DELETE FROM login_attempts WHERE username = ? AND success = 0').run(username);
    }
    return false;
  }

  sessionDurationMinutes(): number {
    const db = getDb();
    const row = db.db
      .prepare("SELECT value FROM settings WHERE key = 'session_duration_minutes'")
      .get() as { value: string } | undefined;
    const v = row ? parseInt(row.value, 10) : 480;
    return Number.isFinite(v) && v > 0 ? v : 480;
  }

  validate(token?: string): AuthedUser | null {
    if (!token) return null;
    const db = getDb();
    const th = hashToken(token);
    const row = db.db
      .prepare(
        `SELECT s.user_id, u.username, u.must_change_password, s.expires_at, s.revoked
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(th) as Record<string, unknown> | undefined;
    if (!row || (row.revoked as number) === 1) return null;
    if (new Date(row.expires_at as string).getTime() < Date.now()) return null;
    db.db
      .prepare('UPDATE sessions SET last_used_at = datetime(\'now\') WHERE token_hash = ?')
      .run(th);
    return {
      id: row.user_id as string,
      username: row.username as string,
      mustChangePassword: (row.must_change_password as number) === 1,
    };
  }

  logout(token?: string): void {
    if (!token) return;
    const db = getDb();
    db.db.prepare('UPDATE sessions SET revoked = 1 WHERE token_hash = ?').run(hashToken(token));
  }

  changePassword(userId: string, currentPassword: string, newPassword: string, keepTokenHash?: string): { ok: boolean; error?: string } {
    const db = getDb();
    const row = db.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'User not found' };
    if (!verifyPassword(row.password_hash as string, currentPassword)) {
      return { ok: false, error: 'Current password is incorrect' };
    }
    if (newPassword.length < 8) {
      return { ok: false, error: 'New password must be at least 8 characters' };
    }
    const nh = hashPassword(newPassword);
    db.db
      .prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime(\'now\') WHERE id = ?')
      .run(nh, userId);
    if (keepTokenHash) {
      db.db
        .prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND token_hash != ? AND revoked = 0')
        .run(userId, keepTokenHash);
    } else {
      db.db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(userId);
    }
    audit.record('auth.password_changed', 'auth', {}, userId);
    return { ok: true };
  }

  resetPassword(userId: string, newPassword: string): { ok: boolean; error?: string } {
    if (newPassword.length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters' };
    }
    const db = getDb();
    const nh = hashPassword(newPassword);
    db.db
      .prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime(\'now\') WHERE id = ?')
      .run(nh, userId);
    db.db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(userId);
    audit.record('auth.admin_password_reset', 'auth', {}, userId);
    return { ok: true };
  }

  updateUsername(userId: string, username: string): { ok: boolean; error?: string } {
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) {
      return { ok: false, error: 'Username must be 3-64 chars (letters, numbers, . _ -)' };
    }
    const db = getDb();
    const conflict = db.db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
    if (conflict) return { ok: false, error: 'Username already taken' };
    db.db
      .prepare('UPDATE users SET username = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(username, userId);
    audit.record('auth.username_changed', 'auth', {}, userId);
    return { ok: true };
  }

  setSessionDuration(minutes: number): void {
    const db = getDb();
    db.db
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')')
      .run('session_duration_minutes', String(minutes));
  }

  listSessions(userId: string): unknown[] {
    const db = getDb();
    return db.db
      .prepare(
        'SELECT id, created_at, expires_at, ip, user_agent, last_used_at, revoked FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
      )
      .all(userId);
  }

  revokeSession(id: string, userId: string): void {
    const db = getDb();
    db.db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  }
}
