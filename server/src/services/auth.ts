import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword, hashToken, generateToken } from '../lib/password.js';
import { AuditService } from './audit.js';

const audit = new AuditService();

export interface AuthedUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

export class AuthService {
  login(username: string, password: string, ip?: string): { token: string; user: AuthedUser } | null {
    const db = getDb();
    const row = db.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;
    if (!row) {
      audit.record('login.failed', 'auth', { username }, undefined, ip);
      return null;
    }
    if (!verifyPassword(row.password_hash as string, password)) {
      audit.record('login.failed', 'auth', { username }, row.id as string, ip);
      return null;
    }
    const token = generateToken();
    const durationMin = this.sessionDurationMinutes();
    const expiresAt = new Date(Date.now() + durationMin * 60_000).toISOString();
    db.db
      .prepare(
        'INSERT INTO sessions (id, user_id, token_hash, expires_at, ip) VALUES (?, ?, ?, ?, ?)',
      )
      .run(nanoid(), row.id as string, hashToken(token), expiresAt, ip || null);
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
