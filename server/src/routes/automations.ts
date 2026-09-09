import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { AutomationService } from '../services/automations.js';
import { emitAutomationEvent } from '../services/realtime.js';

const automations = new AutomationService();

const automationSchema = z.object({
  name: z.string().min(1).max(200),
  prompt: z.string().min(1).max(20000),
  agent_id: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  schedule_type: z.enum(['one_time', 'recurring', 'cron', 'interval']),
  schedule_value: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
});

export function automationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/automations', { preHandler: requireAuth }, async (req) => {
    const q = (req.query as { enabled?: string }) || {};
    return { automations: automations.list({ enabled: q.enabled ? q.enabled === '1' : undefined }) };
  });

  app.get('/api/v1/automations/:id', { preHandler: requireAuth }, async (req, reply) => {
    const a = automations.get((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'Automation not found' });
    return { automation: a, runs: automations.runs(a.id) };
  });

  app.post('/api/v1/automations', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = automationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    const a = automations.create({
      name: parsed.data.name,
      prompt: parsed.data.prompt,
      agent_id: parsed.data.agent_id,
      project_id: parsed.data.project_id,
      schedule_type: parsed.data.schedule_type,
      schedule_value: parsed.data.schedule_value,
      enabled: parsed.data.enabled === undefined ? 1 : parsed.data.enabled ? 1 : 0,
    });
    emitAutomationEvent({ action: 'create', automationId: a.id });
    return reply.code(201).send({ automation: a });
  });

  app.put('/api/v1/automations/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = automationSchema.partial({ name: true, prompt: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const a = automations.update(id, {
      name: parsed.data.name,
      prompt: parsed.data.prompt,
      agent_id: parsed.data.agent_id,
      project_id: parsed.data.project_id,
      schedule_type: parsed.data.schedule_type,
      schedule_value: parsed.data.schedule_value,
      enabled: parsed.data.enabled === undefined ? undefined : parsed.data.enabled ? 1 : 0,
    });
    if (!a) return reply.code(404).send({ error: 'Automation not found' });
    return { automation: a };
  });

  app.post('/api/v1/automations/:id/toggle', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const a = automations.get(id);
    if (!a) return reply.code(404).send({ error: 'Automation not found' });
    const enabled = a.enabled ? 0 : 1;
    const updated = automations.update(id, { enabled });
    return { automation: updated };
  });

  app.post('/api/v1/automations/:id/trigger-now', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const a = automations.get(id);
    if (!a) return reply.code(404).send({ error: 'Automation not found' });
    const taskId = automations.trigger(a);
    emitAutomationEvent({ action: 'trigger', automationId: id, taskId });
    return { taskId, automation: automations.get(id) };
  });

  app.delete('/api/v1/automations/:id', { preHandler: requireAuth }, async (req, reply) => {
    automations.delete((req.params as { id: string }).id);
    return { ok: true };
  });
}