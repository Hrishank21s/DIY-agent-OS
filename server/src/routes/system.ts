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
    const uptimeMinutes = Math.floor(uptimeMs / 60000);
    const uptimeText = `${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m`;

    const status = {
      server: 'ONLINE',
      uptime: uptimeText,
      uptimeMs,
      opencode,
      database: 'HEALTHY',
      scheduler: deps.getScheduler() ? 'RUNNING' : 'UNKNOWN',
      workers: `${deps.getQueue().runningCount()}/${settings.getNumber('worker_concurrency', 2)}`,
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