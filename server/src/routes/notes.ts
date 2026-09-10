import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { NoteService } from '../services/notes.js';

const notes = new NoteService();

const noteSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().max(100000).optional(),
  note_type: z.enum(['personal', 'project', 'technical', 'research', 'ideas', 'instructions', 'reference']).optional(),
  project_id: z.string().optional().nullable(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  tags: z.string().optional().nullable(),
});

export function noteRoutes(app: FastifyInstance): void {
  app.get('/api/v1/notes', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as Record<string, string>) || {};
    const list = notes.list({
      project_id: q.project_id,
      archived: q.archived ? true : undefined,
      search: q.search,
      limit: parseInt(q.limit || '100', 10),
    });
    return { notes: list };
  });

  app.get('/api/v1/notes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const n = notes.get((req.params as { id: string }).id);
    if (!n) return reply.code(404).send({ error: 'Note not found' });
    return { note: n };
  });

  app.post('/api/v1/notes', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const n = notes.create({
      title: parsed.data.title,
      content: parsed.data.content,
      note_type: parsed.data.note_type || 'personal',
      project_id: parsed.data.project_id,
      pinned: parsed.data.pinned ? 1 : 0,
      archived: parsed.data.archived ? 1 : 0,
      tags: parsed.data.tags,
    });
    return reply.code(201).send({ note: n });
  });

  app.put('/api/v1/notes/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const n = notes.update(id, {
      title: parsed.data.title,
      content: parsed.data.content,
      note_type: parsed.data.note_type,
      project_id: parsed.data.project_id,
      pinned: parsed.data.pinned === undefined ? undefined : parsed.data.pinned ? 1 : 0,
      archived: parsed.data.archived === undefined ? undefined : parsed.data.archived ? 1 : 0,
      tags: parsed.data.tags,
    });
    if (!n) return reply.code(404).send({ error: 'Note not found' });
    return { note: n };
  });

  app.delete('/api/v1/notes/:id', { preHandler: requireAuth }, async (req) => {
    notes.delete((req.params as { id: string }).id);
    return { ok: true };
  });
}