import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { TaskService } from '../services/tasks.js';
import { TaskQueue } from '../workers/task-queue.js';
import { AgentService } from '../services/agents.js';

const tasks = new TaskService();
const agents = new AgentService();

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional(),
  project_id: z.string().optional().nullable(),
  agent_id: z.string().optional().nullable(),
  agent_name: z.string().optional().nullable(),
  prompt: z.string().max(20000).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

export function taskRoutes(app: FastifyInstance, getQueue: () => TaskQueue): void {
  app.get('/api/v1/tasks', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as { status?: string; project_id?: string; agent_id?: string; limit?: string }) || {};
    const list = tasks.list({
      status: q.status,
      project_id: q.project_id,
      agent_id: q.agent_id,
      limit: parseInt(q.limit || '100', 10),
    });
    return { tasks: list };
  });

  app.get('/api/v1/tasks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const task = tasks.get((req.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const logs = tasks.getLogs(task.id);
    return { task, logs };
  });

  app.post('/api/v1/tasks', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    const input = parsed.data;
    let agentId = input.agent_id;
    if (!agentId && input.agent_name) {
      const a = agents.getByName(input.agent_name);
      if (a) agentId = a.id;
    }
    const task = tasks.create({
      title: input.title,
      description: input.description,
      project_id: input.project_id || null,
      agent_id: agentId || null,
      prompt: input.prompt || input.description,
      priority: input.priority || 'normal',
    });
    return reply.code(201).send({ task });
  });

  app.patch('/api/v1/tasks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body as { status?: string; prompt?: string; priority?: string }) || {};
    const existing = tasks.get(id);
    if (!existing) return reply.code(404).send({ error: 'Task not found' });

    if (body.status === 'cancel') {
      const queue = getQueue();
      queue.cancel(id);
      return { task: tasks.get(id) };
    }
    if (body.status === 'retry') {
      const queue = getQueue();
      queue.retry(id);
      return { task: tasks.get(id) };
    }
    if (body.status === 'queued' && existing.status === 'paused') {
      tasks.updateStatus(id, 'queued');
      return { task: tasks.get(id) };
    }
    if (body.prompt) {
      tasks.updateStatus(id, existing.status, { prompt: body.prompt });
    }
    if (body.priority) {
      const db = (await import('../db/index.js')).getDb();
      db.db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(body.priority, id);
    }
    return { task: tasks.get(id) };
  });

  app.delete('/api/v1/tasks/:id', { preHandler: requireAuth }, async (req) => {
    const id = (req.params as { id: string }).id;
    const queue = getQueue();
    queue.cancel(id);
    const db = (await import('../db/index.js')).getDb();
    db.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return { ok: true };
  });

  app.post('/api/v1/tasks/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const id = (req.params as { id: string }).id;
    getQueue().cancel(id);
    return { task: tasks.get(id) };
  });

  app.post('/api/v1/tasks/:id/retry', { preHandler: requireAuth }, async (req) => {
    const id = (req.params as { id: string }).id;
    getQueue().retry(id);
    return { task: tasks.get(id) };
  });
}