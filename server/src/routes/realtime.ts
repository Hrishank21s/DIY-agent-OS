import type { FastifyInstance } from 'fastify';
import { requireAuth, extractToken } from '../middleware/auth.js';
import { AuthService } from '../services/auth.js';
import { hub } from '../services/realtime.js';

const authService = new AuthService();

export function realtimeRoutes(app: FastifyInstance): void {
  // Server-Sent Events for live updates. Auth via query token fallback for
  // EventSource (which can't set headers).
  app.get('/api/v1/realtime/events', async (req, reply) => {
    let token = extractToken(req);
    if (!token) {
      const q = req.query as Record<string, string>;
      token = q.token;
    }
    const user = authService.validate(token);
    if (!user) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    const send = (evt: { type: string; [k: string]: unknown }) => {
      try {
        reply.raw.write(`event: ${evt.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch {
        // client disconnected
      }
    };

    // Send initial snapshot
    send({ type: 'hello', ts: Date.now() });

    const unsubscribe = hub.subscribe(evt => send(evt));

    req.raw.on('close', () => {
      unsubscribe();
      reply.raw.end();
    });
  });
}