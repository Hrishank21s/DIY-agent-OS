import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { ApprovalService } from '../src/services/approvals.js';
import { TaskService } from '../src/services/tasks.js';
import { AgentService } from '../src/services/agents.js';
import { MemoryService } from '../src/services/memory.js';
import { AutomationService } from '../src/services/automations.js';

describe('ApprovalService', () => {
  beforeAll(() => {
    seed(getDb());
  });

  it('creates a pending approval', () => {
    const svc = new ApprovalService();
    const a = svc.create({ type: 'command', description: 'rm -rf /x', risk_level: 'high', payload: { argv: ['rm', '-rf', '/x'] } });
    expect(a.status).toBe('pending');
    expect(a.payload).toEqual({ argv: ['rm', '-rf', '/x'] });
  });

  it('lists pending approvals', () => {
    const svc = new ApprovalService();
    svc.create({ type: 'command', description: 'sudo x', risk_level: 'high' });
    expect(svc.listPending().length).toBeGreaterThan(0);
  });

  it('approve updates status', () => {
    const svc = new ApprovalService();
    const a = svc.create({ type: 'command', description: 'danger', risk_level: 'high' });
    const responded = svc.respond(a.id, true, 'admin', 'ok');
    expect(responded!.status).toBe('approved');
    expect(responded!.responded_by).toBe('admin');
  });

  it('reject updates status', () => {
    const svc = new ApprovalService();
    const a = svc.create({ type: 'command', description: 'danger', risk_level: 'high' });
    const responded = svc.respond(a.id, false, 'admin');
    expect(responded!.status).toBe('rejected');
  });

  it('cannot double-respond', () => {
    const svc = new ApprovalService();
    const a = svc.create({ type: 'command', description: 'x', risk_level: 'high' });
    svc.respond(a.id, true, 'admin');
    const again = svc.respond(a.id, false, 'admin');
    expect(again!.status).toBe('approved');
  });
});

describe('TaskService', () => {
  beforeAll(() => seed(getDb()));

  it('creates tasks and claims queued ones by priority', () => {
    const svc = new TaskService();
    svc.create({ title: 'low', priority: 'low' });
    svc.create({ title: 'high', priority: 'high' });
    const claimed = svc.claimAvailable();
    expect(claimed).not.toBeNull();
    expect(claimed!.title).toBe('high');
  });

  it('recoverStaleTasks marks running as failed', () => {
    const svc = new TaskService();
    const t = svc.create({ title: 'running task' });
    svc.updateStatus(t.id, 'running');
    const { running, waiting } = svc.recoverStaleTasks();
    expect(running).toBeGreaterThan(0);
    expect(svc.get(t.id)!.status).toBe('failed');
  });

  it('excludes already-running task ids when claiming (prevents double-execution)', () => {
    const svc = new TaskService();
    const existing = svc.list({ status: 'queued' }).map(t => t.id);
    const inFlight = svc.create({ title: 'in-flight' });
    const next = svc.create({ title: 'next' });
    const claim = svc.claimAvailable([inFlight.id, ...existing]);
    expect(claim!.id).toBe(next.id);
  });

  it('writes and reads task logs', () => {
    const svc = new TaskService();
    const t = svc.create({ title: 'logged task' });
    svc.addLog(t.id, 'info', 'hello log');
    const logs = svc.getLogs(t.id);
    expect(logs.length).toBe(1);
    expect((logs[0] as { message: string }).message).toBe('hello log');
  });
});

describe('AgentService', () => {
  beforeAll(() => seed(getDb()));

  it('checks permissions', () => {
    const svc = new AgentService();
    const coder = svc.getByName('Coder')!;
    expect(svc.can(coder, 'files', 'read')).toBe(true);
    expect(svc.can(coder, 'files', 'write')).toBe(true);
    expect(svc.can(coder, 'network', 'access')).toBe(true);
  });

  it('creates custom agents that persist', () => {
    const svc = new AgentService();
    const agent = svc.create({
      name: 'CustomTest',
      description: 'for tests',
      permissions: [{ resource: 'files', action: 'read', allowed: 1 }],
    });
    const fetched = svc.get(agent.id)!;
    expect(fetched.name).toBe('CustomTest');
    expect(fetched.permissions).toHaveLength(1);
    expect(svc.can(fetched, 'files', 'read')).toBe(true);
  });
});

describe('MemoryService', () => {
  beforeAll(() => seed(getDb()));

  it('stores and retrieves by FTS relevance', () => {
    const svc = new MemoryService();
    svc.create({ content: 'TableTrackr production uses zero-downtime deployments with blue-green', type: 'TECHNICAL_DECISION', importance: 0.9, project_id: 'p1' });
    svc.create({ content: 'Favorite color is blue', type: 'USER_PREFERENCE', importance: 0.5 });
    const results = svc.retrieveQuery('zero-downtime deployment TableTrackr', { projectId: 'p1', limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('zero-downtime');
  });

  it('extracts memory types from text', () => {
    const svc = new MemoryService();
    expect(svc.extractType('We are building Project X')).toBe('PROJECT_FACT');
    expect(svc.extractType('I always prefer dark mode')).toBe('USER_PREFERENCE');
  });

  it('does not blindly duplicate', () => {
    const svc = new MemoryService();
    svc.create({ content: 'Unique fact 42', type: 'PROJECT_FACT', importance: 0.9 });
    const dup = svc.retrieveQuery('Unique fact 42', { limit: 5 });
    expect(dup.length).toBeGreaterThan(0);
  });
});

describe('AutomationService', () => {
  beforeAll(() => seed(getDb()));

  it('computes next run for cron', () => {
    const svc = new AutomationService();
    const next = svc.computeNext('cron', '0 9 * * 1', new Date('2026-01-05T00:00:00Z'));
    expect(next).toBeTruthy();
  });

  it('creates automation and triggers a task', () => {
    const svc = new AutomationService();
    const a = svc.create({ name: 'Daily', prompt: 'Do X', schedule_type: 'interval', schedule_value: '3600' });
    expect(a.next_run_at).toBeTruthy();
    const taskId = svc.trigger(a);
    const tasks = new TaskService();
    expect(tasks.get(taskId)).not.toBeNull();
  });
});
