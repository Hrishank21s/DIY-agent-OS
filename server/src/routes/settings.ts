import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { SettingsService } from '../services/settings.js';
import { AuthService } from '../services/auth.js';
import { TrustedPathsService } from '../services/trusted-paths.js';
import { getLogger } from '../lib/logger.js';

const settings = new SettingsService();
const auth = new AuthService();
const trustedPaths = new TrustedPathsService();
const log = getLogger();

const updateAuthSchema = z.object({
  username: z.string().max(64).optional(),
  newPassword: z.string().min(8).max(256).optional(),
  sessionDurationMinutes: z.number().int().min(5).max(10080).optional(),
});

const updateGeneralSchema = z.object({
  server_name: z.string().max(200).optional(),
  timezone: z.string().max(100).optional(),
});

const updateOpencodeSchema = z.object({
  opencode_path: z.string().max(2000).optional(),
  model: z.string().max(200).optional(),
  working_dir: z.string().max(2000).optional(),
  task_timeout_ms: z.number().int().min(5000).max(86400000).optional(),
});

const securitySchema = z.object({
  trusted_paths: z.array(z.string()).optional(),
  login_rate_limit: z.number().int().min(1).max(1000).optional(),
  login_failed_attempts: z.number().int().min(1).max(100).optional(),
  login_lockout_minutes: z.number().int().min(1).max(10080).optional(),
  session_rate_limit: z.number().int().min(1).max(10000).optional(),
  memory_importance_threshold: z.number().min(0).max(1).optional(),
  approval_rules: z.record(z.union([z.string(), z.array(z.string())])).optional(),
});

export function settingsRoutes(app: FastifyInstance): void {
  app.get('/api/v1/settings', { preHandler: requireAuth }, async (req) => {
    if (req.user!.id) {
      // Only admins (single user bootstrap) access all settings
    }
    return { settings: settings.getAll(), trustedPaths: trustedPaths.list() };
  });

  app.put('/api/v1/settings/auth', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = updateAuthSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    if (parsed.data.username) {
      const r = auth.updateUsername(req.user!.id, parsed.data.username);
      if (!r.ok) return reply.code(400).send({ error: r.error });
    }
    if (parsed.data.newPassword) {
      const r = auth.resetPassword(req.user!.id, parsed.data.newPassword);
      if (!r.ok) return reply.code(400).send({ error: r.error });
    }
    if (parsed.data.sessionDurationMinutes) {
      auth.setSessionDuration(parsed.data.sessionDurationMinutes);
    }
    return { ok: true };
  });

  app.put('/api/v1/settings/general', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = updateGeneralSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) settings.set(k, v);
    }
    return { ok: true };
  });

  app.put('/api/v1/settings/opencode', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = updateOpencodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) settings.set(k, typeof v === 'number' ? String(v) : v);
    }
    log.info('settings', 'OpenCode settings updated');
    return { ok: true };
  });

  app.put('/api/v1/settings/security', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = securitySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    if (parsed.data.trusted_paths) {
      trustedPaths.setList(parsed.data.trusted_paths);
    }
    if (parsed.data.login_rate_limit !== undefined) {
      settings.set('login_rate_limit', String(parsed.data.login_rate_limit));
    }
    if (parsed.data.login_failed_attempts !== undefined) {
      settings.set('login_failed_attempts', String(parsed.data.login_failed_attempts));
    }
    if (parsed.data.login_lockout_minutes !== undefined) {
      settings.set('login_lockout_minutes', String(parsed.data.login_lockout_minutes));
    }
    if (parsed.data.session_rate_limit !== undefined) {
      settings.set('session_rate_limit', String(parsed.data.session_rate_limit));
    }
    if (parsed.data.memory_importance_threshold !== undefined) {
      settings.set('memory_importance_threshold', String(parsed.data.memory_importance_threshold));
    }
    if (parsed.data.approval_rules) {
      settings.set('approval_rules', JSON.stringify(parsed.data.approval_rules));
    }
    return { ok: true };
  });
}