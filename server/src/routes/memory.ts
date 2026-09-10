import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { MemoryService, type MemoryType } from '../services/memory.js';
import { emitMemoryEvent } from '../services/realtime.js';

const memory = new MemoryService();

const memoryTypes: MemoryType[] = [
  'USER_PREFERENCE',
  'PROJECT_FACT',
  'PROJECT_DECISION',
  'TECHNICAL_DECISION',
  'WORKFLOW',
  'IMPORTANT_CONTEXT',
  'REFERENCE',
  'GOAL',
];

const createSchema = z.object({
  content: z.string().min(1).max(20000),
  type: z.enum(memoryTypes as unknown as [string, ...string[]]),
  importance: z.number().min(0).max(1).default(0.5),
  project_id: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
});

export function memoryRoutes(app: FastifyInstance): void {
  app.get('/api/v1/memory', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as Record<string, string>) || {};
    const list = memory.list({
      projectId: q.project_id,
      type: q.type as MemoryType | undefined,
      importanceMin: q.importance_min ? parseFloat(q.importance_min) : undefined,
      limit: parseInt(q.limit || '100', 10),
    });
    return { memories: list };
  });

  app.get('/api/v1/memory/search', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as Record<string, string>) || {};
    const results = memory.retrieveQuery(q.q || '', {
      projectId: q.project_id,
      limit: parseInt(q.limit || '10', 10),
      importanceMin: q.importance_min ? parseFloat(q.importance_min) : undefined,
    });
    for (const r of results) memory.touch(r.id);
    return { memories: results };
  });

  app.get('/api/v1/memory/:id', { preHandler: requireAuth }, async (req, reply) => {
    const m = memory.get((req.params as { id: string }).id);
    if (!m) return reply.code(404).send({ error: 'Memory not found' });
    return { memory: m };
  });

  app.post('/api/v1/memory', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    const m = memory.create({ ...parsed.data, type: parsed.data.type as MemoryType });
    emitMemoryEvent({ action: 'create', memoryId: m.id });
    return reply.code(201).send({ memory: m });
  });

  app.put('/api/v1/memory/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = createSchema.partial({ content: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const m = memory.update(id, { ...parsed.data, type: parsed.data.type as MemoryType | undefined });
    if (!m) return reply.code(404).send({ error: 'Memory not found' });
    return { memory: m };
  });

  app.delete('/api/v1/memory/:id', { preHandler: requireAuth }, async (req) => {
    memory.delete((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get('/api/v1/memory/stats/count', { preHandler: requireAuth }, async () => {
    return { count: memory.count() };
  });
}