import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import cron from 'cron-parser';
import { TaskService } from './tasks.js';

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  agent_id?: string | null;
  project_id?: string | null;
  schedule_type: string; // 'one_time' | 'recurring' | 'cron' | 'interval'
  schedule_value: string;
  enabled: number;
  last_run_at?: string | null;
  next_run_at?: string | null;
  status?: string | null;
  created_at: string;
  updated_at: string;
}

export class AutomationService {
  private tasks: TaskService;

  constructor() {
    this.tasks = new TaskService();
  }

  create(input: Partial<Automation> & { name: string; prompt: string; schedule_type: string; schedule_value: string }): Automation {
    const db = getDb();
    const id = nanoid();
    const next = this.computeNext(input.schedule_type, input.schedule_value);
    db.db
      .prepare(
        `INSERT INTO automations (id, name, prompt, agent_id, project_id, schedule_type, schedule_value, enabled, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.prompt,
        input.agent_id || null,
        input.project_id || null,
        input.schedule_type,
        input.schedule_value,
        input.enabled === undefined ? 1 : input.enabled,
        next,
      );
    return this.get(id)!;
  }

  get(id: string): Automation | null {
    const db = getDb();
    return (db.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as unknown as Automation) || null;
  }

  list(filter?: { enabled?: boolean }): Automation[] {
    const db = getDb();
    let sql = 'SELECT * FROM automations WHERE 1=1';
    const params: (string | number)[] = [];
    if (filter?.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(filter.enabled ? 1 : 0);
    }
    sql += ' ORDER BY name';
    return db.db.prepare(sql).all(...params) as unknown as Automation[];
  }

  update(id: string, input: Partial<Automation>): Automation | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    const fields = ['name', 'prompt', 'agent_id', 'project_id', 'schedule_type', 'schedule_value', 'enabled'] as const;
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const f of fields) {
      if (input[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push((input[f] as string | number | null) ?? null);
      }
    }
    // Recompute next run if schedule changed
    const st = input.schedule_type || existing.schedule_type;
    const sv = input.schedule_value || existing.schedule_value;
    if (input.schedule_type || input.schedule_value) {
      sets.push('next_run_at = ?');
      params.push(this.computeNext(st, sv));
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      params.push(id);
      db.db.prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.get(id);
  }

  delete(id: string): void {
    const db = getDb();
    db.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
  }

  computeNext(type: string, value: string, from = new Date()): string | null {
    try {
      if (type === 'one_time') {
        const t = Date.parse(value);
        return isNaN(t) ? null : new Date(t).toISOString();
      }
      if (type === 'interval') {
        const secs = parseInt(value, 10);
        if (!secs) return null;
        return new Date(from.getTime() + secs * 1000).toISOString();
      }
      if (type === 'cron') {
        const interval = cron.parseExpression(value, { currentDate: from });
        return interval.next().toISOString();
      }
      if (type === 'recurring') {
        // value like 'daily:08:00' or 'weekly:9:00' or 'daily'
        const [freq, ...rest] = value.split(':');
        const now = new Date(from);
        if (freq === 'daily') {
          const [h = 8, m = 0] = rest.length ? rest[0].split(':').map(Number) : [8, 0];
          const next = new Date(now);
          next.setHours(h, m, 0, 0);
          if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
          return next.toISOString();
        }
        if (freq === 'weekly') {
          const [dow = 1, hm = '09:00'] = rest.length ? rest : [1, '09:00'];
          const [h, m] = String(hm).split(':').map(Number);
          const next = new Date(now);
          next.setHours(h, m, 0, 0);
          while (next.getDay() !== Number(dow) || next.getTime() <= now.getTime()) {
            next.setDate(next.getDate() + 1);
          }
          return next.toISOString();
        }
        if (freq === 'hourly') {
          const next = new Date(now.getTime() + 60 * 60 * 1000);
          return next.toISOString();
        }
        return null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find automations whose next_run_at has passed and schedule their task.
   */
  triggerDue(): string[] {
    const db = getDb();
    const due = db.db
      .prepare("SELECT * FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
      .all() as unknown as Automation[];
    const triggered: string[] = [];
    for (const a of due) {
      const taskId = this.trigger(a);
      triggered.push(taskId);
    }
    return triggered;
  }

  trigger(a: Automation): string {
    const db = getDb();
    const runId = nanoid();
    const task = this.tasks.create({
      title: `Automation: ${a.name}`,
      description: `Triggered by automation '${a.name}'`,
      agent_id: a.agent_id || null,
      project_id: a.project_id || null,
      prompt: a.prompt,
    });
    db.db
      .prepare(
        'INSERT INTO automation_runs (id, automation_id, task_id, status) VALUES (?, ?, ?, ?)',
      )
      .run(runId, a.id, task.id, 'queued');
    const next = this.computeNext(a.schedule_type, a.schedule_value);
    db.db
      .prepare(
        "UPDATE automations SET last_run_at = datetime('now'), next_run_at = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(next, a.id);
    return task.id;
  }

  runs(automationId: string, limit = 50): unknown[] {
    const db = getDb();
    return db.db
      .prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY triggered_at DESC LIMIT ?')
      .all(automationId, limit);
  }
}