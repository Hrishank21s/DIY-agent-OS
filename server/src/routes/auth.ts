import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { AuditService } from '../services/audit.js';
import { getLogger } from '../lib/logger.js';

const log = getLogger();
const auth = new AuthService();
const audit = new AuditService();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(256),
});

export function authRoutes(app: FastifyInstance): void {
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { username, password } = parsed.data;
    const ip = req.ip;
    const result = auth.login(username, password, ip);
    if (!result) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }
    const durationMin = auth.sessionDurationMinutes();
    reply.setCookie('agentos_session', result.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: durationMin * 60,
    });
    return { user: result.user, requiresPasswordChange: result.user.mustChangePassword };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const token = (req.cookies as Record<string, string>)?.agentos_session;
    auth.logout(token);
    reply.clearCookie('agentos_session');
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: req.user };
  });

  app.post('/api/v1/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }
    const user = req.user!;
    const r = auth.changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!r.ok) {
      return reply.code(400).send({ error: r.error });
    }
    // Revoke other sessions for security, keep this one
    return { ok: true };
  });

  app.get('/api/v1/auth/sessions', { preHandler: requireAuth }, async (req) => {
    return { sessions: auth.listSessions(req.user!.id) };
  });

  app.post('/api/v1/auth/sessions/:id/revoke', { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    auth.revokeSession(id, req.user!.id);
    return { ok: true };
  });
}