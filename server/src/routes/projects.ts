import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { ProjectService } from '../services/projects.js';
import { TaskService } from '../services/tasks.js';

const projects = new ProjectService();
const tasks = new TaskService();

const projectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  root_dir: z.string().max(2000).optional().nullable(),
  instructions: z.string().max(20000).optional().nullable(),
});

export function projectRoutes(app: FastifyInstance): void {
  app.get('/api/v1/projects', { preHandler: requireAuth }, async () => {
    return { projects: projects.list() };
  });

  app.get('/api/v1/projects/:id', { preHandler: requireAuth }, async (req, reply) => {
    const p = projects.get((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: 'Project not found' });
    const taskList = tasks.list({ project_id: p.id, limit: 50 });
    return { project: p, ...projects.context(p.id), tasks: taskList };
  });

  app.post('/api/v1/projects', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    if (projects.getByName(parsed.data.name)) {
      return reply.code(409).send({ error: 'Project already exists' });
    }
    const p = projects.create({ ...parsed.data, root_dir: parsed.data.root_dir || null, instructions: parsed.data.instructions || null });
    return reply.code(201).send({ project: p });
  });

  app.put('/api/v1/projects/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const p = projects.update(id, parsed.data);
    if (!p) return reply.code(404).send({ error: 'Project not found' });
    return { project: p };
  });

  app.delete('/api/v1/projects/:id', { preHandler: requireAuth }, async (req) => {
    projects.delete((req.params as { id: string }).id);
    return { ok: true };
  });
}