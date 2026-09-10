import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { AgentService, type Permission } from '../services/agents.js';

const agents = new AgentService();

const permissionSchema = z.object({
  resource: z.string(),
  action: z.string(),
  allowed: z.number().int().min(0).max(1).default(1),
  paths: z.string().nullable().optional(),
});

const agentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  system_prompt: z.string().max(20000).optional(),
  model: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
  approval_policy: z.enum(['safe', 'low', 'medium', 'high', 'always_require_approval', 'always_approve']).optional(),
  timeout_seconds: z.number().int().min(10).max(86400).optional(),
  max_concurrent_tasks: z.number().int().min(1).max(20).optional(),
  permissions: z.array(permissionSchema).optional(),
});

export function agentRoutes(app: FastifyInstance): void {
  app.get('/api/v1/agents', { preHandler: requireAuth }, async () => {
    return { agents: agents.list() };
  });

  app.get('/api/v1/agents/:id', { preHandler: requireAuth }, async (req, reply) => {
    const a = agents.get((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'Agent not found' });
    return { agent: a };
  });

  app.post('/api/v1/agents', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = agentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    const input = parsed.data;
    if (agents.getByName(input.name)) {
      return reply.code(409).send({ error: `Agent '${input.name}' already exists` });
    }
    const perms = (input.permissions || []).map(p => ({
      resource: p.resource,
      action: p.action,
      allowed: p.allowed,
      paths: p.paths,
    })) as Permission[];
    const agent = agents.create({
      name: input.name,
      description: input.description,
      system_prompt: input.system_prompt,
      model: input.model,
      enabled: input.enabled === undefined ? 1 : input.enabled ? 1 : 0,
      approval_policy: input.approval_policy || 'always_require_approval',
      timeout_seconds: input.timeout_seconds,
      max_concurrent_tasks: input.max_concurrent_tasks,
      permissions: perms,
    });
    return reply.code(201).send({ agent });
  });

  app.put('/api/v1/agents/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = agents.get(id);
    if (!existing) return reply.code(404).send({ error: 'Agent not found' });
    const parsed = agentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const input = parsed.data;
    if (input.name && input.name !== existing.name && agents.getByName(input.name)) {
      return reply.code(409).send({ error: `Agent '${input.name}' already exists` });
    }
    const agent = agents.update(id, {
      name: input.name,
      description: input.description,
      system_prompt: input.system_prompt,
      model: input.model,
      enabled: input.enabled === undefined ? undefined : input.enabled ? 1 : 0,
      approval_policy: input.approval_policy,
      timeout_seconds: input.timeout_seconds,
      max_concurrent_tasks: input.max_concurrent_tasks,
      permissions: input.permissions as Permission[] | undefined,
    });
    return { agent };
  });

  app.delete('/api/v1/agents/:id', { preHandler: requireAuth }, async (req) => {
    const id = (req.params as { id: string }).id;
    agents.delete(id);
    return { ok: true };
  });
}