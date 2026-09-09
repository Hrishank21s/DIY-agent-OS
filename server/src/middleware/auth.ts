import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, type AuthedUser } from '../services/auth.js';

const auth = new AuthService();

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(req);
  const user = auth.validate(token);
  if (!user) {
    await reply.code(401).send({ error: 'Unauthorized' });
    return;
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