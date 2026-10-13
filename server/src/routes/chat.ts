import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { ChatService } from '../services/chat.js';
import { TaskService } from '../services/tasks.js';
import { MemoryService } from '../services/memory.js';

const chat = new ChatService();
const tasks = new TaskService();
const memorySvc = new MemoryService();

const sendSchema = z.object({
  content: z.string().min(1).max(20000),
  projectId: z.string().optional().nullable(),
});

export function chatRoutes(app: FastifyInstance): void {
  app.get('/api/v1/chat/conversations', { preHandler: requireAuth }, async (req) => {
    const query = (req.query as { search?: string; archived?: string }) || {};
    const list = query.search
      ? chat.searchConversations(req.user!.id, query.search)
      : chat.listConversations(req.user!.id, { includeArchived: query.archived === '1' });
    return { conversations: list };
  });

  app.post('/api/v1/chat/conversations', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = z
      .object({ title: z.string().max(500).optional(), projectId: z.string().max(2000).optional().nullable() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const title = (parsed.data.title || '').trim() || 'New conversation';
    const conv = chat.createConversation(req.user!.id, title, parsed.data.projectId || undefined);
    return reply.code(201).send({ conversation: conv });
  });

  app.patch('/api/v1/chat/conversations/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const conv = chat.getOwnedConversation(id, req.user!.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const parsed = z
      .object({
        title: z.string().max(2000).optional(),
        archived: z.boolean().optional(),
        projectId: z.string().max(2000).optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const body = parsed.data;
    if (body.title !== undefined) chat.renameConversation(id, body.title.slice(0, 200));
    if (body.archived !== undefined) chat.archiveConversation(id, body.archived);
    if (body.projectId !== undefined) {
      const { getDb } = await import('../db/index.js');
      getDb().db.prepare('UPDATE conversations SET project_id = ? WHERE id = ?').run(body.projectId || null, id);
    }
    return { conversation: chat.getConversation(id) };
  });

  app.delete('/api/v1/chat/conversations/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const conv = chat.getOwnedConversation(id, req.user!.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    chat.deleteConversation(id);
    return { ok: true };
  });

  app.get('/api/v1/chat/conversations/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const conv = chat.getOwnedConversation(id, req.user!.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    return { messages: chat.getMessages(id), conversation: conv };
  });

  app.post('/api/v1/chat/conversations/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const conv = chat.getOwnedConversation(id, req.user!.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const { content, projectId } = parsed.data;

    const r = chat.send(id, req.user!.id, content, projectId || conv.project_id || undefined);
    const message = chat.getMessage(r.userMsg.id);
    const classified = r.classification;
    if (r.project) return reply.code(201).send({ project: r.project, classified });
    if (classified.kind === 'automation') return reply.code(200).send({ message, reply: r.reply, classified });
    if (r.note) return reply.code(201).send({ message, note: r.note, classified });
    if (r.taskId) return reply.code(201).send({ message, taskId: r.taskId, classified });
    return reply.code(201).send({ message, reply: r.reply, classified });
  });

  app.post('/api/v1/chat/direct', { preHandler: requireAuth }, async (req, reply) => {
    // One-shot chat without conversation persistence (used by tests / API clients)
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const { content, projectId } = parsed.data;
    const task = tasks.create({
      title: content.slice(0, 60),
      description: content,
      prompt: content,
      conversation_id: null,
      project_id: projectId || null,
    });
    return reply.code(201).send({ taskId: task.id });
  });

  // Memory retrieval visible to the user ("why was a memory used")
  app.get('/api/v1/chat/retrieve', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as { q?: string; projectId?: string; limit?: string }) || {};
    const memories = memorySvc.retrieveQuery(q.q || '', { projectId: q.projectId, limit: parseInt(q.limit || '8', 10) });
    return { memories };
  });
}