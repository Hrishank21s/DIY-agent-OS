import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { TaskService } from '../services/tasks.js';
import { MemoryService } from '../services/memory.js';
import { SettingsService } from '../services/settings.js';
import { createExecutor } from '../executors/opencode.js';
import type { TaskQueue } from '../workers/task-queue.js';
import type { Scheduler } from '../scheduler/index.js';
import { ApprovalService } from '../services/approvals.js';
import { emitSystemStatus } from '../services/realtime.js';
import { getLogger } from '../lib/logger.js';

const tasks = new TaskService();
const memory = new MemoryService();
const settings = new SettingsService();
const approvals = new ApprovalService();
const log = getLogger();
const executor = createExecutor();

export interface SystemDeps {
  getQueue: () => TaskQueue;
  getScheduler: () => Scheduler;
  startedAt: Date;
}

export function systemRoutes(app: FastifyInstance, deps: SystemDeps): void {
  app.get('/api/v1/system/status', { preHandler: requireAuth }, async () => {
    const opencode = await executor.isAvailable();
    const uptimeMs = Date.now() - deps.startedAt.getTime();
    const available = settings.getNumber('worker_concurrency', 2);
    const busy = deps.getQueue().runningCount();

    // Shape mirrors client/src/types.ts SystemStatusInfo (previously it
    // returned `server: 'ONLINE'`, `workers: 'x/y'`, string uptime — the UI
    // never rendered correctly, LOW #25).
    const status = {
      server: 'ONLINE',
      uptime: uptimeMs,
      opencode,
      database: true,
      scheduler: deps.getScheduler() !== null,
      workers: { available, busy },
      activeTasks: tasks.countByStatus()['running'] || 0,
      queuedTasks: tasks.countByStatus()['queued'] || 0,
      waitingApprovals: approvals.countPending(),
      memoryRecords: memory.count(),
      currentModel: settings.configuredModel,
      serverTime: new Date().toISOString(),
    };
    emitSystemStatus(status);
    return status;
  });

  app.post('/api/v1/system/restart', { preHandler: requireAuth }, async (_req, reply) => {
    log.info('system', 'System restart requested');
    await reply.send({ ok: true, message: 'Restarting...' });
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });
}