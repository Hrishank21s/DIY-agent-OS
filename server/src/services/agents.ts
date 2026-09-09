import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

export interface Permission {
  resource: string;
  action: string;
  allowed: number;
  paths?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  system_prompt?: string;
  model?: string | null;
  enabled: number;
  approval_policy: string;
  timeout_seconds?: number | null;
  max_concurrent_tasks?: number | null;
  permissions: Permission[];
}

export class AgentService {
  list(): Agent[] {
    const db = getDb();
    const agents = db.db
      .prepare('SELECT * FROM agents ORDER BY name').all() as Record<string, unknown>[];
    return agents.map(a => this.withPermissions(a));
  }

  get(id: string): Agent | null {
    const db = getDb();
    const row = db.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.withPermissions(row);
  }

  getByName(name: string): Agent | null {
    const db = getDb();
    const row = db.db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.withPermissions(row);
  }

  private withPermissions(row: Record<string, unknown>): Agent {
    const db = getDb();
    const perms = db.db
      .prepare('SELECT resource, action, allowed, paths FROM agent_permissions WHERE agent_id = ?')
      .all(row.id as string) as unknown as Permission[];
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      system_prompt: row.system_prompt as string | undefined,
      model: row.model as string | null | undefined,
      enabled: row.enabled as number,
      approval_policy: row.approval_policy as string,
      timeout_seconds: row.timeout_seconds as number | null | undefined,
      max_concurrent_tasks: row.max_concurrent_tasks as number | null | undefined,
      permissions: perms,
    };
  }

  create(input: Partial<Agent> & { name: string }): Agent {
    const db = getDb();
    const id = nanoid();
    db.db
      .prepare(
        `INSERT INTO agents (id, name, description, system_prompt, model, enabled, approval_policy, timeout_seconds, max_concurrent_tasks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description || null,
        input.system_prompt || null,
        input.model || null,
        input.enabled === undefined ? 1 : input.enabled,
        input.approval_policy || 'always_approve',
        input.timeout_seconds || null,
        input.max_concurrent_tasks || 1,
      );
    this.setPermissions(id, input.permissions || []);
    return this.get(id)!;
  }

  update(id: string, input: Partial<Agent>): Agent | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    const fields = [
      'name',
      'description',
      'system_prompt',
      'model',
      'enabled',
      'approval_policy',
      'timeout_seconds',
      'max_concurrent_tasks',
    ] as const;
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const f of fields) {
      if (input[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push((input[f] as string | number | null) ?? null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      params.push(id);
      db.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    if (input.permissions) {
      this.setPermissions(id, input.permissions);
    }
    const updated = this.get(id);
    if (updated && updated.name !== existing.name) {
      db.db.prepare('UPDATE tasks SET agent_id = ? WHERE agent_id = ?').run(updated.id, updated.id);
    }
    return updated;
  }

  delete(id: string): void {
    const db = getDb();
    db.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }

  setPermissions(agentId: string, perms: Permission[]): void {
    const db = getDb();
    db.db.prepare('DELETE FROM agent_permissions WHERE agent_id = ?').run(agentId);
    const insert = db.db.prepare(
      'INSERT INTO agent_permissions (id, agent_id, resource, action, allowed, paths) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const p of perms) {
      insert.run(nanoid(), agentId, p.resource, p.action, p.allowed, p.paths ?? null);
    }
  }

  can(agent: Agent, resource: string, action: string): boolean {
    const p = agent.permissions.find(p => p.resource === resource && p.action === action);
    if (!p) return false;
    return p.allowed === 1;
  }
}
