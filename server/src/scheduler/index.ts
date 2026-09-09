import { getLogger } from '../lib/logger.js';
import { AutomationService } from '../services/automations.js';
import { TaskService } from '../services/tasks.js';
import { emitAutomationEvent, emitSystemStatus } from '../services/realtime.js';

const log = getLogger();

/**
 * Application-level scheduler. Polls for due automations every N seconds,
 * producing tasks into the task queue. Never executes agents itself.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickMs = 10_000;

  constructor(
    private automations: AutomationService,
    private tasks: TaskService,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), this.tickMs);
    log.info('automation', 'Scheduler started');
    this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    try {
      const triggered = this.automations.triggerDue();
      for (const taskId of triggered) {
        const task = this.tasks.get(taskId);
        emitAutomationEvent({
          taskId,
          name: task?.title || 'Automation',
          status: 'triggered',
        });
        log.info('automation', `Automation triggered task ${taskId}`);
      }
      if (triggered.length) {
        emitSystemStatus({ scheduler: 'running' });
      }
    } catch (err) {
      log.error('automation', 'Scheduler tick failed', { error: (err as Error).message });
    }
  }
}