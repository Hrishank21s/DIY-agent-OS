import { describe, it, expect } from 'vitest';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { hashPassword, verifyPassword, hashToken } from '../src/lib/password.js';

describe('Database', () => {
  it('runs migrations and seeds default data', () => {
    const db = getDb();
    seed(db);
    const users = db.db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
    expect(users.c).toBe(1);
    const admin = db.db.prepare("SELECT * FROM users WHERE username='admin'").get() as {
      username: string;
      must_change_password: number;
    };
    expect(admin.username).toBe('admin');
    expect(admin.must_change_password).toBe(1);
  });

  it('seeds default agents with permissions', () => {
    const db = getDb();
    seed(db);
    const agents = db.db.prepare('SELECT COUNT(*) c FROM agents').get() as { c: number };
    expect(agents.c).toBe(5);
    const perms = db.db.prepare('SELECT COUNT(*) c FROM agent_permissions').get() as { c: number };
    expect(perms.c).toBeGreaterThan(0);
  });

  it('uses WAL mode', () => {
    const db = getDb();
    const row = db.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode.toLowerCase()).toBe('wal');
  });
});

describe('Password hashing', () => {
  it('hashes and verifies passwords', () => {
    const h = hashPassword('correct horse battery staple');
    expect(h).toContain('scrypt$');
    expect(verifyPassword(h, 'correct horse battery staple')).toBe(true);
    expect(verifyPassword(h, 'wrong')).toBe(false);
  });

  it('never stores plaintext', () => {
    const h = hashPassword('secret');
    expect(h.includes('secret')).toBe(false);
  });

  it('hashes tokens with sha256', () => {
    const t = 'some-token-value';
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashToken(t));
    expect(h).not.toBe(t);
  });
});
