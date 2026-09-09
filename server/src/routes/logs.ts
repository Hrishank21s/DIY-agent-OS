import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { AuditService } from '../services/audit.js';

const audit = new AuditService();

export function logsRoutes(app: FastifyInstance): void {
  app.get('/api/v1/logs', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as Record<string, string>) || {};
    const db = getDb();
    const category = q.category;
    const limit = parseInt(q.limit || '100', 10);
    const offset = parseInt(q.offset || '0', 10);
    let sql = 'SELECT * FROM task_logs WHERE 1=1';
    const params: (string | number)[] = [];
    if (category) {
      sql += ' AND source = ?';
      params.push(category);
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = db.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return {
      logs: rows.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta as string) : null })),
      categories: ['app', 'agent', 'task', 'command', 'auth', 'approval', 'automation', 'system', 'memory', 'note', 'project'],
    };
  });

  app.get('/api/v1/logs/audit', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as Record<string, string>) || {};
    return { logs: audit.list(parseInt(q.limit || '100', 10), q.category) };
  });

  app.get('/api/v1/logs/commands', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as Record<string, string>) || {};
    const db = getDb();
    const limit = parseInt(q.limit || '100', 10);
    const rows = db.db
      .prepare('SELECT * FROM command_logs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return { commands: rows.map(r => ({ ...r, args: r.args ? JSON.parse(r.args as string) : [] })) };
  });
}