import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  conversation_id?: string | null;
  project_id?: string | null;
  agent_id?: string | null;
  status: TaskStatus;
  priority: string;
  prompt?: string | null;
  result?: string | null;
  error?: string | null;
  approval_state?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
}

export class TaskService {
  create(input: Partial<Task> & { title: string }): Task {
    const db = getDb();
    const id = nanoid();
    db.db
      .prepare(
        `INSERT INTO tasks (id, title, description, conversation_id, project_id, agent_id, status, priority, prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.description || null,
        input.conversation_id || null,
        input.project_id || null,
        input.agent_id || null,
        input.status || 'queued',
        input.priority || 'normal',
        input.prompt || null,
      );
    return this.get(id)!;
  }

  get(id: string): Task | null {
    const db = getDb();
    const row = db.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return (row as unknown as Task) || null;
  }

  list(filter?: { status?: string; agent_id?: string; project_id?: string; limit?: number; offset?: number }): Task[] {
    const db = getDb();
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: (string | number)[] = [];
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.agent_id) {
      sql += ' AND agent_id = ?';
      params.push(filter.agent_id);
    }
    if (filter?.project_id) {
      sql += ' AND project_id = ?';
      params.push(filter.project_id);
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(filter?.limit || 100, filter?.offset || 0);
    return db.db.prepare(sql).all(...params) as unknown as Task[];
  }

  updateStatus(id: string, status: TaskStatus, extra?: Record<string, unknown>): void {
    const db = getDb();
    const sets = ['status = ?', "updated_at = datetime('now')"];
    const params: (string | number | null)[] = [status];
    if (status === 'running' && !this.get(id)?.started_at) {
      sets.push("started_at = datetime('now')");
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      sets.push("completed_at = datetime('now')");
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || k === 'started_at' || k === 'completed_at' || k === 'updated_at') continue;
        sets.push(`${k} = ?`);
        params.push(v as string | number | null);
      }
    }
    params.push(id);
    db.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  addLog(taskId: string, level: string, message: string, source?: string, meta?: unknown): void {
    const db = getDb();
    db.db
      .prepare('INSERT INTO task_logs (id, task_id, level, message, source, meta) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nanoid(), taskId, level, message, source || null, meta ? JSON.stringify(meta) : null);
  }

  getLogs(taskId: string, limit = 500): unknown[] {
    const db = getDb();
    const rows = db.db
      .prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(taskId, limit) as Record<string, unknown>[];
    return rows.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta as string) : null }));
  }

  claimAvailable(excludeIds: string[] = []): Task | null {
    const db = getDb();
    let sql = "SELECT * FROM tasks WHERE status = 'queued'";
    const params: string[] = [];
    if (excludeIds.length) {
      sql += ` AND id NOT IN (${excludeIds.map(() => '?').join(', ')})`;
      params.push(...excludeIds);
    }
    sql += ' ORDER BY CASE priority WHEN \'high\' THEN 0 WHEN \'normal\' THEN 1 ELSE 2 END, created_at ASC LIMIT 1';
    const row = db.db.prepare(sql).get(...params);
    if (!row) return null;
    return row as unknown as Task;
  }

  /**
   * Recover tasks after server restart: any task stuck in 'running'
   * or 'waiting_for_approval' needs review.
   */
  recoverStaleTasks(): { running: number; waiting: number } {
    const db = getDb();
    const running = (
      db.db.prepare("UPDATE tasks SET status = 'failed', error = 'Server restarted while task was in progress', updated_at = datetime('now') WHERE status = 'running'").run() as { changes: number }
    ).changes;
    const waiting = (
      db.db.prepare("UPDATE tasks SET status = 'paused', updated_at = datetime('now') WHERE status = 'waiting_for_approval'").run() as { changes: number }
    ).changes;
    return { running, waiting };
  }

  countByStatus(): Record<string, number> {
    const db = getDb();
    const rows = db.db.prepare('SELECT status, COUNT(*) c FROM tasks GROUP BY status').all() as { status: string; c: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.c;
    return out;
  }
}
