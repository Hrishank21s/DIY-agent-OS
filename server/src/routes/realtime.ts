import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { hub } from '../services/realtime.js';

export function realtimeRoutes(app: FastifyInstance): void {
  // Server-Sent Events for live updates. Auth relies on the SameSite session
  // cookie, which EventSource sends automatically for same-origin requests.
  // requireAuth also enforces the forced-password-change gate.
  app.get('/api/v1/realtime/events', { preHandler: requireAuth }, async (req, reply) => {
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