import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer, type ServerInstance } from '../src/index.js';

let srv: ServerInstance;
let cookieHeader: string;

beforeAll(async () => {
  srv = await buildServer({ dataDir: process.env.AGENTOS_DATA_DIR });
  await srv.app.ready();
});

afterAll(async () => {
  await srv.app.close();
});

async function req(method: string, path: string, body?: unknown, cookies?: string, headers?: Record<string, string>) {
  const res = await srv.app.inject({
    method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: path.startsWith('/') ? path : `/${path}`,
    payload: body,
    headers: { ...(cookies ? { cookie: cookies } : {}), ...(headers || {}) },
  });
  return { status: res.statusCode, json: res.json(), cookie: res.cookies, headers: res.headers };
}

describe('API integration', () => {
  it('health endpoint works', async () => {
    const r = await req('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
  });

  it('rejects unauthenticated access', async () => {
    const r = await req('GET', '/api/v1/tasks');
    expect(r.status).toBe(401);
  });

  it('logs in and sets session cookie', async () => {
    const r = await req('POST', '/api/v1/auth/login', { username: 'admin', password: 'admin123' });
    expect(r.status).toBe(200);
    expect(r.json.requiresPasswordChange).toBe(true);
    expect(r.cookie.length).toBeGreaterThan(0);
    const setCookie = String(r.headers['set-cookie'] || '');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/^.*SameSite=strict/i);
    // test suite runs in development mode -> cookie must NOT be secure-only
    expect(setCookie).not.toMatch(/Secure/i);
    cookieHeader = r.cookie.map(c => `${c.name}=${c.value}`).join(';');
  });

  it('blocks other routes until password is changed', async () => {
    const blocked = await req('GET', '/api/v1/tasks', undefined, cookieHeader);
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const me = await req('GET', '/api/v1/auth/me', undefined, cookieHeader);
    expect(me.status).toBe(200);
    expect(me.json.user.mustChangePassword).toBe(true);
  });

  it('changes password then old login fails', async () => {
    const r = await req('POST', '/api/v1/auth/change-password', { currentPassword: 'admin123', newPassword: 'newpass456' }, cookieHeader);
    expect(r.status).toBe(200);
    // old password now fails
    const oldLogin = await req('POST', '/api/v1/auth/login', { username: 'admin', password: 'admin123' });
    expect(oldLogin.status).toBe(401);
  });

  it('reads tasks after password change', async () => {
    const r = await req('GET', '/api/v1/tasks', undefined, cookieHeader);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.tasks)).toBe(true);
  });

  it('password change revokes other sessions but keeps the current one', async () => {
    const login1 = await req('POST', '/api/v1/auth/login', { username: 'admin', password: 'newpass456' });
    const login2 = await req('POST', '/api/v1/auth/login', { username: 'admin', password: 'newpass456' });
    const c1 = login1.cookie.map(c => `${c.name}=${c.value}`).join(';');
    const c2 = login2.cookie.map(c => `${c.name}=${c.value}`).join(';');
    expect((await req('GET', '/api/v1/auth/me', undefined, c1)).status).toBe(200);
    expect((await req('GET', '/api/v1/auth/me', undefined, c2)).status).toBe(200);
    const r = await req('POST', '/api/v1/auth/change-password', { currentPassword: 'newpass456', newPassword: 'anotherpass789' }, c1);
    expect(r.status).toBe(200);
    expect((await req('GET', '/api/v1/auth/me', undefined, c1)).status).toBe(200);
    expect((await req('GET', '/api/v1/auth/me', undefined, c2)).status).toBe(401);
    // restore the password for later tests and reuse c1's surviving session
    await req('POST', '/api/v1/auth/change-password', { currentPassword: 'anotherpass789', newPassword: 'newpass456' }, c1);
    cookieHeader = c1;
  });

  it('creates a project', async () => {
    const r = await req('POST', '/api/v1/projects', { name: 'TestProject', description: 'test' }, cookieHeader);
    expect(r.status).toBe(201);
    expect(r.json.project.name).toBe('TestProject');
  });

  it('creates a note', async () => {
    const r = await req('POST', '/api/v1/notes', { title: 'NoteA', content: 'hello', note_type: 'personal' }, cookieHeader);
    expect(r.status).toBe(201);
    expect(r.json.note.title).toBe('NoteA');
  });

  it('creates a memory', async () => {
    const r = await req(
      'POST',
      '/api/v1/memory',
      { content: 'Zero downtime deploys required for production', type: 'TECHNICAL_DECISION', importance: 0.8 },
      cookieHeader,
    );
    expect(r.status).toBe(201);
  });

  it('creates an agent', async () => {
    const r = await req(
      'POST',
      '/api/v1/agents',
      {
        name: 'TestAgent',
        system_prompt: 'You are a test agent',
        approval_policy: 'medium',
        permissions: [{ resource: 'files', action: 'read', allowed: 1 }],
      },
      cookieHeader,
    );
    expect(r.status).toBe(201);
    expect(r.json.agent.name).toBe('TestAgent');
  });

  it('creates an automation', async () => {
    const r = await req(
      'POST',
      '/api/v1/automations',
      { name: 'Auto', prompt: 'Run something', schedule_type: 'interval', schedule_value: '3600' },
      cookieHeader,
    );
    expect(r.status).toBe(201);
    expect(r.json.automation.next_run_at).toBeTruthy();
  });

  it('creates a task via API', async () => {
    const r = await req('POST', '/api/v1/tasks', { title: 'API task', prompt: 'Just reply ok', priority: 'normal' }, cookieHeader);
    expect(r.status).toBe(201);
    expect(r.json.task.status).toBe('queued');
    await srv.queue.cancel(r.json.task.id);
  });

  it('approvals endpoint returns list', async () => {
    const r = await req('GET', '/api/v1/approvals', undefined, cookieHeader);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.approvals)).toBe(true);
  });

  it('settings endpoint returns settings', async () => {
    const r = await req('GET', '/api/v1/settings', undefined, cookieHeader);
    expect(r.status).toBe(200);
    expect(r.json.settings).toBeTruthy();
  });

  it('system status endpoint works', async () => {
    const r = await req('GET', '/api/v1/system/status', undefined, cookieHeader);
    expect(r.status).toBe(200);
    expect(r.json.server).toBe('ONLINE');
  });

  it('another user cannot access admin conversations (IDOR blocked)', async () => {
    const conv = await req('POST', '/api/v1/chat/conversations', { title: 'Admin private' }, cookieHeader);
    expect(conv.status).toBe(201);
    const convId = conv.json.conversation.id;

    const { getDb } = await import('../src/db/index.js');
    const { hashPassword } = await import('../src/lib/password.js');
    const db = getDb();
    db.db
      .prepare('INSERT INTO users (id, username, password_hash, must_change_password) VALUES (?, ?, ?, 0)')
      .run('user-other', 'otheruser', hashPassword('otherpass123'));

    const otherLogin = await req('POST', '/api/v1/auth/login', { username: 'otheruser', password: 'otherpass123' });
    expect(otherLogin.status).toBe(200);
    const otherCookie = otherLogin.cookie.map(c => `${c.name}=${c.value}`).join(';');

    const getMsgs = await req('GET', `/api/v1/chat/conversations/${convId}/messages`, undefined, otherCookie);
    expect(getMsgs.status).toBe(404);
    const patch = await req('PATCH', `/api/v1/chat/conversations/${convId}`, { title: 'Hijacked' }, otherCookie);
    expect(patch.status).toBe(404);
    const del = await req('DELETE', `/api/v1/chat/conversations/${convId}`, undefined, otherCookie);
    expect(del.status).toBe(404);
    // admin can still see it, and title is unchanged
    const adminMsgs = await req('GET', `/api/v1/chat/conversations/${convId}/messages`, undefined, cookieHeader);
    expect(adminMsgs.status).toBe(200);
    expect(adminMsgs.json.conversation.title).toBe('Admin private');
  });

  it('rejects cross-origin state-changing requests', async () => {
    const r = await req('POST', '/api/v1/projects', { name: 'EvilProject' }, cookieHeader, {
      origin: 'https://evil.example.com',
    });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Cross-origin request rejected');
    // a read with the same origin header is not state-changing and is allowed
    const read = await req('GET', '/api/v1/tasks', undefined, cookieHeader, {
      origin: 'https://evil.example.com',
    });
    expect(read.status).toBe(200);
  });

  it('allows loopback or missing origins for state-changing requests', async () => {
    const missing = await req('POST', '/api/v1/projects', { name: 'ApiProjectNoOrigin' }, cookieHeader);
    expect(missing.status).toBe(201);
    const loopback = await req('POST', '/api/v1/notes', { title: 'LoopbackNote', content: 'x' }, cookieHeader, {
      origin: 'http://localhost:5173',
    });
    expect(loopback.status).toBe(201);
  });

  it('allows state-changing requests from a configured LAN origin', async () => {
    // AGENTOS_PUBLIC_ORIGIN=http://lan-agentos.example:3000 is set in setup.ts;
    // a non-loopback LAN origin must be allowed once explicitly configured.
    const r = await req('POST', '/api/v1/projects', { name: 'LanProject' }, cookieHeader, {
      origin: 'http://lan-agentos.example:3000',
    });
    expect(r.status).toBe(201);
  });
});
