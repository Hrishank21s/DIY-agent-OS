import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

export class AuditService {
  record(
    action: string,
    category: string,
    detail?: Record<string, unknown>,
    userId?: string,
    ip?: string,
  ): void {
    try {
      const db = getDb();
      db.db
        .prepare(
          'INSERT INTO audit_logs (id, user_id, action, category, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(nanoid(), userId || null, action, category, detail ? JSON.stringify(detail) : null, ip || null);
    } catch (err) {
      console.error('Failed to write audit log', err);
    }
  }

  list(limit = 100, category?: string, userId?: string): unknown[] {
    const db = getDb();
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: (string | number)[] = [];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = db.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({
      ...r,
      detail: r.detail ? JSON.parse(r.detail as string) : null,
    }));
  }
}
