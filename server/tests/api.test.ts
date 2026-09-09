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

async function req(method: string, path: string, body?: unknown, cookies?: string) {
  const res = await srv.app.inject({
    method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: path.startsWith('/') ? path : `/${path}`,
    payload: body,
    headers: cookies ? { cookie: cookies } : {},
  });
  return { status: res.statusCode, json: res.json(), cookie: res.cookies };
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
    cookieHeader = r.cookie.map(c => `${c.name}=${c.value}`).join(';');
  });

  it('reads tasks when authenticated', async () => {
    const r = await req('GET', '/api/v1/tasks', undefined, cookieHeader);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.tasks)).toBe(true);
  });

  it('changes password then old login fails', async () => {
    const r = await req('POST', '/api/v1/auth/change-password', { currentPassword: 'admin123', newPassword: 'newpass456' }, cookieHeader);
    expect(r.status).toBe(200);
    // old password now fails
    const oldLogin = await req('POST', '/api/v1/auth/login', { username: 'admin', password: 'admin123' });
    expect(oldLogin.status).toBe(401);
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
});
