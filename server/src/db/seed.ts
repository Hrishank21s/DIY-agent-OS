import { nanoid } from 'nanoid';
import { hashPassword } from '../lib/password.js';
import type { Db } from './index.js';

export function seed(db: Db): void {
  bootstrapAdmin(db);
  ensureDefaultAgents(db);
  seedSettings(db);
}

function bootstrapAdmin(db: Db): void {
  const existing = db.db
    .prepare('SELECT id FROM users LIMIT 1')
    .get() as { id: string } | undefined;
  if (existing) return;

  const id = nanoid();
  const hash = hashPassword('admin123');
  db.db
    .prepare(
      'INSERT INTO users (id, username, password_hash, must_change_password) VALUES (?, ?, ?, 1)',
    )
    .run(id, 'admin', hash);
}

interface SeedAgent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string | null;
  approval_policy: string;
  perms: {
    files: string;
    shell: string;
    git: string;
    network: string;
    system: string;
    scheduler: string;
    memory: string;
  };
}

function ensureDefaultAgents(db: Db): void {
  const count = (
    db.db.prepare('SELECT COUNT(*) as c FROM agents').get() as { c: number }
  ).c;
  if (count > 0) return;

  const agents: SeedAgent[] = [
    {
      id: nanoid(),
      name: 'General',
      description: 'Balanced permissions for everyday tasks',
      system_prompt:
        'You are the General agent in AgentOS. You have balanced file, shell, and network access. Be helpful and concise.',
      model: null,
      approval_policy: 'always_approve',
      perms: { files: 'rw', shell: 'r', git: 'rw', network: 'r', system: 'n', scheduler: 'n', memory: 'rw' },
    },
    {
      id: nanoid(),
      name: 'Coder',
      description: 'Strong filesystem and terminal access for coding',
      system_prompt:
        'You are the Coder agent in AgentOS. You have strong filesystem and terminal access. Write clean, well-tested code.',
      model: null,
      approval_policy: 'always_approve',
      perms: { files: 'rwx', shell: 'rwx', git: 'rw', network: 'r', system: 'n', scheduler: 'n', memory: 'r' },
    },
    {
      id: nanoid(),
      name: 'Research',
      description: 'Web and network access plus notes and memory',
      system_prompt:
        'You are the Research agent in AgentOS. You focus on web research, gathering information, and storing notes and memories.',
      model: null,
      approval_policy: 'always_approve',
      perms: { files: 'r', shell: 'n', git: 'n', network: 'rwx', system: 'n', scheduler: 'n', memory: 'rwx' },
    },
    {
      id: nanoid(),
      name: 'Automation',
      description: 'Scheduler, shell, and filesystem for automation tasks',
      system_prompt:
        'You are the Automation agent in AgentOS. You create and manage automated jobs, schedules, and workflows.',
      model: null,
      approval_policy: 'always_approve',
      perms: { files: 'rw', shell: 'rw', git: 'r', network: 'r', system: 'n', scheduler: 'rwx', memory: 'rw' },
    },
    {
      id: nanoid(),
      name: 'System',
      description: 'System administration capabilities',
      system_prompt:
        'You are the System agent in AgentOS. You handle system administration, services, and configuration. All dangerous actions require approval.',
      model: null,
      approval_policy: 'always_approve',
      perms: { files: 'rwx', shell: 'rwx', git: 'rw', network: 'r', system: 'rwx', scheduler: 'rw', memory: 'rw' },
    },
  ];

  const insertAgent = db.db.prepare(
    `INSERT INTO agents (id, name, description, system_prompt, model, enabled, approval_policy, timeout_seconds, max_concurrent_tasks)
     VALUES (@id, @name, @description, @system_prompt, @model, 1, @approval_policy, 3600, 1)`,
  );
  const insertPerm = db.db.prepare(
    `INSERT OR REPLACE INTO agent_permissions (id, agent_id, resource, action, allowed, paths)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const a of agents) {
    insertAgent.run({
      id: a.id,
      name: a.name,
      description: a.description,
      system_prompt: a.system_prompt,
      model: a.model,
      approval_policy: a.approval_policy,
    });
    const p = a.perms;
    const rows: [string, string, string, string, number, string | null][] = [];
    if (p.files && p.files !== 'n') {
      const r = p.files.includes('r'), w = p.files.includes('w'), x = p.files.includes('x');
      if (r) rows.push([nanoid(), a.id, 'files', 'read', 1, null]);
      if (w) rows.push([nanoid(), a.id, 'files', 'write', 1, null]);
      if (x) rows.push([nanoid(), a.id, 'files', 'delete', 1, null]);
    }
    if (p.shell && p.shell !== 'n') {
      const w = p.shell.includes('w') || p.shell.includes('x');
      rows.push([nanoid(), a.id, 'shell', w ? 'execute' : 'read', 1, null]);
    }
    if (p.git && p.git !== 'n') {
      rows.push([nanoid(), a.id, 'git', 'status', 1, null]);
      rows.push([nanoid(), a.id, 'git', 'diff', 1, null]);
      rows.push([nanoid(), a.id, 'git', 'commit', 1, null]);
      rows.push([nanoid(), a.id, 'git', 'branch', 1, null]);
      if (p.git.includes('push')) rows.push([nanoid(), a.id, 'git', 'push', 0, null]);
    }
    if (p.network && p.network !== 'n') {
      rows.push([nanoid(), a.id, 'network', 'access', 1, null]);
    }
    if (p.system && p.system !== 'n') {
      rows.push([nanoid(), a.id, 'system', 'install', 1, null]);
      rows.push([nanoid(), a.id, 'system', 'configure', 1, null]);
      rows.push([nanoid(), a.id, 'system', 'services', 1, null]);
    }
    if (p.scheduler && p.scheduler !== 'n') {
      rows.push([nanoid(), a.id, 'scheduler', 'create', 1, null]);
      rows.push([nanoid(), a.id, 'scheduler', 'modify', 1, null]);
      if (p.scheduler.includes('x')) rows.push([nanoid(), a.id, 'scheduler', 'delete', 1, null]);
    }
    if (p.memory && p.memory !== 'n') {
      if (p.memory.includes('r')) rows.push([nanoid(), a.id, 'memory', 'read', 1, null]);
      if (p.memory.includes('w')) rows.push([nanoid(), a.id, 'memory', 'write', 1, null]);
      if (p.memory.includes('x')) rows.push([nanoid(), a.id, 'memory', 'delete', 1, null]);
    }
    for (const r of rows) insertPerm.run(...r);
  }
}

function seedSettings(db: Db): void {
  const defaults: [string, string][] = [
    ['server_name', 'AgentOS'],
    ['port', '3000'],
    ['host', '0.0.0.0'],
    ['timezone', 'UTC'],
    ['session_duration_minutes', '480'],
    ['opencode_path', ''],
    ['model', 'opencode/big-pickle'],
    ['working_dir', ''],
    ['task_timeout_ms', '600000'],
    ['worker_concurrency', '2'],
    ['login_rate_limit', '10'],
    ['session_rate_limit', '100'],
    ['memory_auto_extract', '1'],
    ['memory_importance_threshold', '0.3'],
  ];
  const upsert = db.db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO NOTHING`,
  );
  for (const [k, v] of defaults) upsert.run(k, v);
}

export { ensureDefaultAgents, seedSettings };
