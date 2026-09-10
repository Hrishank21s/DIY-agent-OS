import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { emitApprovalResponded } from './realtime.js';

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
  expires_at?: string | null;
  responded_at?: string | null;
  responded_by?: string | null;
  reviewer_note?: string | null;
}

export interface RespondResult {
  approval: Approval;
  changed: boolean;
}

function dbToApproval(row: Record<string, unknown>): Approval {
  return {
    ...row,
    payload: row.payload ? JSON.parse(row.payload as string) : null,
  } as unknown as Approval;
}

export class ApprovalService {
  create(input: Partial<Approval> & { type: string; description: string; risk_level: string }): Approval {
    const db = getDb();
    const id = nanoid();
    const expiresAt = new Date(Date.now() + config.approvalTimeoutMs).toISOString();
    db.db
      .prepare(
        `INSERT INTO approvals (id, task_id, agent_id, type, description, payload, risk_level, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        id,
        input.task_id || null,
        input.agent_id || null,
        input.type,
        input.description,
        input.payload ? JSON.stringify(input.payload) : null,
        input.risk_level,
        expiresAt,
      );
    return this.get(id)!;
  }

  get(id: string): Approval | null {
    const db = getDb();
    const row = db.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const a = dbToApproval(row);
    if (a.status === 'pending' && this.isExpired(a)) {
      this.expireOne(a.id);
      return this.get(id);
    }
    return a;
  }

  listPending(): Approval[] {
    this.expireStale();
    const db = getDb();
    const rows = db.db
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(dbToApproval);
  }

  respond(id: string, approve: boolean, userId: string, note?: string): RespondResult | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    if (existing.status !== 'pending') {
      return { approval: existing, changed: false };
    }
    db.db
      .prepare(
        "UPDATE approvals SET status = ?, responded_at = datetime('now'), responded_by = ?, reviewer_note = ? WHERE id = ?",
      )
      .run(approve ? 'approved' : 'rejected', userId, note || null, id);
    emitApprovalResponded(id, approve ? 'approved' : 'rejected');
    return { approval: this.get(id)!, changed: true };
  }

  countPending(): number {
    this.expireStale();
    const db = getDb();
    return (db.db.prepare("SELECT COUNT(*) c FROM approvals WHERE status = 'pending'").get() as { c: number }).c;
  }

  private isExpired(a: Approval): boolean {
    if (!a.expires_at) return false;
    return new Date(a.expires_at).getTime() < Date.now();
  }

  private expireOne(id: string): boolean {
    const db = getDb();
    const res = db.db
      .prepare(
        "UPDATE approvals SET status = 'rejected', responded_at = datetime('now'), reviewer_note = 'Expired: no response within the approval window' WHERE id = ? AND status = 'pending'",
      )
      .run(id) as { changes: number };
    if (res.changes > 0) emitApprovalResponded(id, 'rejected');
    return res.changes > 0;
  }

  /**
   * Mark pending approval requests that have passed their expiry as rejected.
   * Returns the associated task ids whose status the caller should reconcile.
   */
  expireStale(): string[] {
    const db = getDb();
    const rows = db.db.prepare("SELECT id, expires_at FROM approvals WHERE status = 'pending'").all() as Record<string, unknown>[];
    const taskIds = new Set<string>();
    for (const row of rows) {
      if (row.expires_at && new Date(row.expires_at as string).getTime() < Date.now()) {
        this.expireOne(row.id as string);
        const task = db.db
          .prepare('SELECT task_id FROM approvals WHERE id = ?')
          .get(row.id as string) as { task_id?: string } | undefined;
        if (task?.task_id) taskIds.add(task.task_id);
      }
    }
    return [...taskIds];
  }
}