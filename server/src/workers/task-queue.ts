import { getLogger } from '../lib/logger.js';
import { TaskService, type Task } from '../services/tasks.js';
import { AgentService } from '../services/agents.js';
import { SettingsService } from '../services/settings.js';
import { MemoryService } from '../services/memory.js';
import { ProjectService } from '../services/projects.js';
import { NoteService } from '../services/notes.js';
import { createExecutor } from '../executors/opencode.js';
import { AgentWorker } from './agent-worker.js';
import { emitSystemStatus } from '../services/realtime.js';

const log = getLogger();

export class TaskQueue {
  private running = new Set<string>();
  private concurrency: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private worker: AgentWorker;

  constructor(
    private tasks: TaskService,
    private agents: AgentService,
    private settings: SettingsService,
  ) {
    this.concurrency = this.settings.getNumber('worker_concurrency', 2);
    this.worker = new AgentWorker(
      tasks,
      agents,
      settings,
      new MemoryService(),
      new ProjectService(),
      new NoteService(),
      createExecutor(),
    );
  }

  start(): void {
    this.recoverStale();
    this.pollTimer = setInterval(() => this.poll(), 1000);
    log.info('task', `Task queue started (concurrency ${this.concurrency})`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async poll(): Promise<void> {
    if (this.running.size >= this.concurrency) return;
    const task = this.tasks.claimAvailable([...this.running]);
    if (!task) return;
    this.running.add(task.id);
    emitSystemStatus({ workers: this.running.size });
    this.executeTask(task)
      .catch(err => {
        log.error('task', `Worker error for task ${task.id}`, { error: (err as Error).message });
        this.tasks.updateStatus(task.id, 'failed', { error: (err as Error).message });
      })
      .finally(() => {
        this.running.delete(task.id);
        emitSystemStatus({ workers: this.running.size });
      });
  }

  private async executeTask(task: Task): Promise<void> {
    await this.worker.execute(task.id);
  }

  private recoverStale(): void {
    const { running, waiting } = this.tasks.recoverStaleTasks();
    if (running || waiting) {
      log.warn('task', `Recovered stale tasks after restart: ${running} running, ${waiting} waiting`);
    }
  }

  cancel(taskId: string): boolean {
    return this.worker.cancel(taskId);
  }

  runningCount(): number {
    return this.running.size;
  }

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.settings.set('worker_concurrency', String(n));
    log.info('task', `Worker concurrency set to ${this.concurrency}`);
  }

  retry(taskId: string): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    if (t.status === 'failed' || t.status === 'cancelled' || t.status === 'completed') {
      this.tasks.updateStatus(taskId, 'queued', { error: null });
      log.info('task', `Task ${taskId} requeued for retry`);
    }
  }
}