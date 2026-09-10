import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, type AuthedUser } from '../services/auth.js';

const auth = new AuthService();

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

const PASSWORD_CHANGE_FREE_ROUTES = new Set([
  'GET:/api/v1/auth/me',
  'POST:/api/v1/auth/change-password',
  'POST:/api/v1/auth/logout',
]);

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(req);
  const user = auth.validate(token);
  if (!user) {
    await reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  if (user.mustChangePassword) {
    const url = req.routeOptions?.url ?? req.url.split('?')[0];
    const key = `${req.method}:${url}`;
    if (!PASSWORD_CHANGE_FREE_ROUTES.has(key)) {
      await reply
        .code(403)
        .send({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
      return;
    }
  }
  req.user = user;
}

export function extractToken(req: FastifyRequest): string | undefined {
  const cookie = (req.cookies as Record<string, string> | undefined)?.['agentos_session'];
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}