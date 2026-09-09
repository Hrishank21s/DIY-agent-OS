import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { ChatService } from '../services/chat.js';
import { TaskService } from '../services/tasks.js';
import { ProjectService } from '../services/projects.js';
import { MemoryService } from '../services/memory.js';
import { NoteService } from '../services/notes.js';
import { emitChatEvent } from '../services/realtime.js';

const chat = new ChatService();
const tasks = new TaskService();
const projects = new ProjectService();
const memorySvc = new MemoryService();
const notes = new NoteService();

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
    const body = (req.body as { title?: string; projectId?: string }) || {};
    const title = (body.title || '').trim() || 'New conversation';
    const conv = chat.createConversation(req.user!.id, title, body.projectId);
    return reply.code(201).send({ conversation: conv });
  });

  app.patch('/api/v1/chat/conversations/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const conv = chat.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const body = (req.body as { title?: string; archived?: boolean; projectId?: string }) || {};
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
    chat.deleteConversation(id);
    return { ok: true };
  });

  app.get('/api/v1/chat/conversations/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const conv = chat.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    return { messages: chat.getMessages(id), conversation: conv };
  });

  app.post('/api/v1/chat/conversations/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const conv = chat.getConversation(id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const { content, projectId } = parsed.data;

    // Record the user message
    const userMsg = chat.addMessage(id, 'user', content, { projectId: projectId || null });

    const projected = projectId || conv.project_id || undefined;
    const classification = chat.classify(content);
    const meta = { kind: classification.kind, reason: classification.reason };

    if (classification.kind === 'memory') {
      chat.maybeExtractMemory(req.user!.id, content, id, projected);
      chat.addMessage(id, 'agent', "Got it. I've saved that to long-term memory.", meta);
      return reply.code(201).send({
        message: chat.getMessage(userMsg.id),
        reply: "Got it. I've saved that to long-term memory.",
        classified: classification,
      });
    }

    if (classification.kind === 'note') {
      const noteTitle = (classification.extracted || 'Note').slice(0, 100);
      const note = notes.create({
        title: noteTitle,
        content: classification.extracted || '',
        note_type: 'personal',
        project_id: projected || null,
      });
      chat.addMessage(id, 'agent', `Note created: ${note.title}`, meta);
      return reply.code(201).send({ message: chat.getMessage(userMsg.id), note, classified: classification });
    }

    if (classification.kind === 'project') {
      const pname = (classification.extracted || 'New Project').slice(0, 100);
      const existing = projects.getByName(pname);
      const project = existing || projects.create({ name: pname, description: content });
      chat.addMessage(id, 'agent', `Project ready: ${project.name}`, meta);
      return reply.code(201).send({ project, classified: classification });
    }

    if (classification.kind === 'automation') {
      return reply.code(200).send({
        message: chat.getMessage(userMsg.id),
        reply: 'I can schedule this. Please open the Automations panel or use the JSON API to set the schedule, prompt, and agent.',
        classified: classification,
      });
    }

    // Default: create a task (task execution or conversational handled as task)
    const task = tasks.create({
      title: classification.title || content.slice(0, 60),
      description: content,
      conversation_id: id,
      project_id: projected || null,
      prompt: content,
    });
    chat.addMessage(id, 'system', 'Task queued', { taskId: task.id }, task.id);
    emitChatEvent(id, { type: 'task', taskId: task.id });

    // An assistant placeholder message that will be updated by the worker
    chat.addMessage(
      id,
      'agent',
      `⏳ Task queued — the agent will process: "${content.slice(0, 120)}"`,
      { taskId: task.id, status: 'queued' },
      task.id,
    );

    return reply.code(201).send({
      message: chat.getMessage(userMsg.id),
      taskId: task.id,
      classified: classification,
    });
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
    for (const m of memories) memorySvc.touch(m.id);
    return { memories };
  });
}