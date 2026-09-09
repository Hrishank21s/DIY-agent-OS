import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Approval {
  id: string;
  task_id?: string | null;
  agent_id?: string | null;
  type: string;
  description: string;
  payload?: unknown;
  risk_level: string;
  status: ApprovalStatus;
  requested_at: string;
  responded_at?: string | null;
  responded_by?: string | null;
  reviewer_note?: string | null;
}

export class ApprovalService {
  create(input: Partial<Approval> & { type: string; description: string; risk_level: string }): Approval {
    const db = getDb();
    const id = nanoid();
    db.db
      .prepare(
        `INSERT INTO approvals (id, task_id, agent_id, type, description, payload, risk_level, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        id,
        input.task_id || null,
        input.agent_id || null,
        input.type,
        input.description,
        input.payload ? JSON.stringify(input.payload) : null,
        input.risk_level,
      );
    return this.get(id)!;
  }

  get(id: string): Approval | null {
    const db = getDb();
    const row = db.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!row) return null;
    const a = row as Record<string, unknown>;
    return { ...a, payload: a.payload ? JSON.parse(a.payload as string) : null } as unknown as Approval;
  }

  listPending(): Approval[] {
    const db = getDb();
    const rows = db.db
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(a => ({ ...a, payload: a.payload ? JSON.parse(a.payload as string) : null }) as unknown as Approval);
  }

  respond(id: string, approve: boolean, userId: string, note?: string): Approval | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing || existing.status !== 'pending') return existing;
    db.db
      .prepare(
        "UPDATE approvals SET status = ?, responded_at = datetime('now'), responded_by = ?, reviewer_note = ? WHERE id = ?",
      )
      .run(approve ? 'approved' : 'rejected', userId, note || null, id);
    return this.get(id);
  }

  countPending(): number {
    const db = getDb();
    return (db.db.prepare("SELECT COUNT(*) c FROM approvals WHERE status = 'pending'").get() as { c: number }).c;
  }
}
