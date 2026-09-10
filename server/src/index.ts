import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { config, isAllowedOrigin, isLoopbackHost } from './config.js';
import { getDb, clearDbSingleton } from './db/index.js';
import { seed } from './db/seed.js';
import { initLogger, getLogger } from './lib/logger.js';
import { AuditService } from './services/audit.js';
import { TaskService } from './services/tasks.js';
import { AgentService } from './services/agents.js';
import { SettingsService } from './services/settings.js';
import { ApprovalService } from './services/approvals.js';
import { AutomationService } from './services/automations.js';
import { TaskQueue } from './workers/task-queue.js';
import { Scheduler } from './scheduler/index.js';

import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { taskRoutes } from './routes/tasks.js';
import { agentRoutes } from './routes/agents.js';
import { memoryRoutes } from './routes/memory.js';
import { noteRoutes } from './routes/notes.js';
import { projectRoutes } from './routes/projects.js';
import { automationRoutes } from './routes/automations.js';
import { approvalRoutes } from './routes/approvals.js';
import { settingsRoutes } from './routes/settings.js';
import { systemRoutes } from './routes/system.js';
import { logsRoutes } from './routes/logs.js';
import { realtimeRoutes } from './routes/realtime.js';

export interface ServerInstance {
  app: FastifyInstance;
  queue: TaskQueue;
  scheduler: Scheduler;
  startedAt: Date;
}

export async function buildServer(opts?: { dataDir?: string }): Promise<ServerInstance> {
  if (opts?.dataDir) {
    process.env.AGENTOS_DATA_DIR = opts.dataDir;
  }

  const audit = new AuditService();
  initLogger(e =>
    audit.record(e.message, e.category as string, { level: e.level } as Record<string, unknown>),
  );
  const log = getLogger();

  const db = getDb();
  seed(db);

  const tasks = new TaskService();
  const agents = new AgentService();
  const settings = new SettingsService();
  const approvals = new ApprovalService();
  const automations = new AutomationService();

  const startedAt = new Date();

  const queue = new TaskQueue(tasks, agents, settings);
  const scheduler = new Scheduler(automations, tasks);

  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: true,
  });
  await app.register(sensible);
  await app.register(websocket);
  await app.register(rateLimit, {
    global: true,
    max: 500,
    timeWindow: '1 minute',
  });
  // CSRF defense-in-depth on state-changing requests. The primary defense is the
  // SameSite=Strict session cookie; this rejects cross-origin requests sent by
  // browsers. The Origin header is only ever compared against the configured
  // public/trusted origins plus loopback, never against the request Host.
  app.addHook('onRequest', async (req, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, config.trustedOrigins)) {
      return reply.code(403).send({ error: 'Cross-origin request rejected' });
    }
  });

  // Recover stale tasks before starting the queue
  tasks.recoverStaleTasks();
  // Fail tasks whose approval requests outlived their approval window
  for (const taskId of approvals.expireStale()) {
    tasks.updateStatus(taskId, 'failed', { error: 'Requires approval expired' });
  }

  // Register routes
  authRoutes(app);
  chatRoutes(app);
  taskRoutes(app, () => queue);
  agentRoutes(app);
  memoryRoutes(app);
  noteRoutes(app);
  projectRoutes(app);
  automationRoutes(app);
  approvalRoutes(app);
  settingsRoutes(app);
  systemRoutes(app, { getQueue: () => queue, getScheduler: () => scheduler, startedAt });
  logsRoutes(app);
  realtimeRoutes(app);

  app.get('/api/health', async (_req, reply) => {
    return reply.send({ status: 'ok', version: '1.0.0' });
  });

  // Serve the built React frontend if present
  const clientDist = path.resolve(config.rootDir, 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (_req, reply) => {
      return reply.type('text/html').send(
        `<html><head><title>AgentOS</title></head><body><h1>AgentOS</h1>` +
          `<p>API server is running. Build the frontend with <code>npm run build -w client</code>.</p>` +
          `<p><a href="/api/system/status">System status API</a></p></body></html>`,
      );
    });
  }

  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number };
    log.error('app', 'Unhandled error', {
      error: e.message,
      url: req.url,
      method: req.method,
    });
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? 'Internal server error' : e.message });
  });

  return { app, queue, scheduler, startedAt };
}

export async function startServer(): Promise<ServerInstance> {
  const { app, queue, scheduler } = await buildServer();
  queue.start();
  scheduler.start();

  await app.listen({ port: config.port, host: config.host });
  getLogger().info('system', `AgentOS listening on ${config.host}:${config.port}`);

  if (
    config.runtimeMode === 'production' &&
    !isLoopbackHost(config.host) &&
    config.trustedOrigins.length === 0
  ) {
    getLogger().warn(
      'system',
      `Listening on a non-loopback address (${config.host}) with no AGENTOS_PUBLIC_ORIGIN / ` +
        'AGENTOS_TRUSTED_ORIGINS configured. Browsers reaching this host will have their ' +
        `state-changing requests rejected as cross-origin. Set AGENTOS_PUBLIC_ORIGIN=http://<hostname-or-ip>:${config.port} ` +
        '(or add origins to AGENTOS_TRUSTED_ORIGINS) to allow LAN browser access.',
    );
  }

  const shutdown = async (signal: string) => {
    getLogger().info('system', `Received ${signal}, shutting down...`);
    await scheduler.stop();
    await queue.stop();
    try {
      await app.close();
    } catch {}
    clearDbSingleton();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return { app, queue, scheduler, startedAt: new Date() };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; username: string; mustChangePassword: boolean };
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('index.ts') ||
    process.argv[1].endsWith('index.js') ||
    import.meta.url === `file://${process.argv[1]}`);

if (isMain) {
  void startServer();
}