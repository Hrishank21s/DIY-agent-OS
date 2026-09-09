import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, extractToken } from '../middleware/auth.js';
import { ApprovalService } from '../services/approvals.js';
import { TaskService } from '../services/tasks.js';
import { AuthService } from '../services/auth.js';
import { emitApprovalResponded, emitTaskStatus } from '../services/realtime.js';
import { AuditService } from '../services/audit.js';

const approvals = new ApprovalService();
const tasks = new TaskService();
const auth = new AuthService();
const audit = new AuditService();

const respondSchema = z.object({
  approve: z.boolean(),
  note: z.string().optional(),
});

export function approvalRoutes(app: FastifyInstance): void {
  app.get('/api/v1/approvals', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as { status?: string }) || {};
    const list =
      q.status === 'pending'
        ? approvals.listPending()
        : (await import('../db/index.js')).getDb().db
            .prepare('SELECT * FROM approvals ORDER BY requested_at DESC LIMIT 100')
            .all() as Record<string, unknown>[];
    return {
      approvals: list.map(a => ({
        ...a,
        payload: typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload,
      })),
    };
  });

  app.post('/api/v1/approvals/:id/respond', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = respondSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const a = approvals.respond(id, parsed.data.approve, req.user!.id, parsed.data.note);
    if (!a) return reply.code(404).send({ error: 'Approval not found' });

    emitApprovalResponded(id, a.status);

    if (a.task_id) {
      if (a.status === 'approved') {
        tasks.updateStatus(a.task_id, 'queued');
        emitTaskStatus(a.task_id, 'queued');
      } else {
        tasks.updateStatus(a.task_id, 'failed', { error: 'Requires approval was rejected' });
        emitTaskStatus(a.task_id, 'failed');
      }
    }
    audit.record(`approval.${a.status}`, 'approval', { approvalId: id }, req.user!.id, req.ip);
    return { approval: a };
  });

  app.get('/api/v1/approvals/pending/count', { preHandler: requireAuth }, async () => {
    return { count: approvals.countPending() };
  });
}