import { getLogger } from '../lib/logger.js';
import { TaskService, type Task } from '../services/tasks.js';
import { AgentService, type Agent } from '../services/agents.js';
import { SettingsService } from '../services/settings.js';
import { MemoryService } from '../services/memory.js';
import { ProjectService } from '../services/projects.js';
import { NoteService } from '../services/notes.js';
import { type OpenCodeExecutor, type ExecutorController } from '../executors/opencode.js';
import { ChatService } from '../services/chat.js';
import { hub, emitTaskStatus, emitTaskOutput, emitSystemStatus } from '../services/realtime.js';

const log = getLogger();
const chat = new ChatService();

function updateChatReply(task: Task, status: string, content: string, error?: string | null): void {
  if (!task.conversation_id) return;
  try {
    chat.updateTaskReply(task.id, content, status, error);
  } catch (err) {
    log.warn('system', `Failed to update chat reply for task ${task.id}`, { error: (err as Error).message });
  }
}

export class AgentWorker {
  private cancellables = new Map<string, () => void>();
  private running = new Set<string>();

  constructor(
    private tasks: TaskService,
    private agents: AgentService,
    private settings: SettingsService,
    private memory: MemoryService,
    private projects: ProjectService,
    private notes: NoteService,
    private executor: OpenCodeExecutor,
  ) {}

  async execute(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'queued') return;

    const agent = task.agent_id
      ? this.agents.get(task.agent_id)
      : this.agents.getByName('General');
    if (!agent) {
      this.tasks.updateStatus(taskId, 'failed', { error: 'Agent not found' });
      return;
    }
    if (!agent.enabled) {
      this.tasks.updateStatus(taskId, 'failed', { error: `Agent '${agent.name}' is disabled` });
      return;
    }

    this.tasks.updateStatus(taskId, 'running');
    emitTaskStatus(taskId, 'running');
    this.tasks.addLog(taskId, 'info', `Starting task with agent '${agent.name}'`, 'worker');

    const timeoutMs = (agent.timeout_seconds || 600) * 1000;
    const cwd = this.resolveCwd(task, agent);
    const prompt = this.composePrompt(task, agent);

    const controllerRef: { current?: ExecutorController } = {};
    const runPromise = this.executor.run({
      prompt,
      model: agent.model || undefined,
      agent: agent.name,
      agentSystemPrompt: agent.system_prompt,
      cwd,
      timeoutMs,
      onEvent: evt => {
        hub.emit('task:opencode', { taskId, evt });
      },
      onStdout: chunk => {
        this.tasks.addLog(taskId, 'info', chunk, 'opencode');
        emitTaskOutput(taskId, chunk);
      },
      onStderr: chunk => {
        this.tasks.addLog(taskId, 'warn', chunk, 'opencode');
        emitTaskOutput(taskId, chunk, 'stderr');
      },
    });

    runPromise.then(({ controller }) => {
      controllerRef.current = controller;
    });

    this.registerCancellable(taskId, () => controllerRef.current?.cancel());

    try {
      const { result } = await runPromise;
      if (result.cancelled) {
        this.tasks.updateStatus(taskId, 'cancelled', { result: result.text });
        this.tasks.addLog(taskId, 'info', 'Task cancelled by user', 'worker');
        emitTaskStatus(taskId, 'cancelled');
        updateChatReply(task, 'cancelled', 'Task cancelled', undefined);
        return;
      }
      if (result.timedOut) {
        this.tasks.updateStatus(taskId, 'failed', { error: 'Task timed out', result: result.text });
        this.tasks.addLog(taskId, 'error', 'Task timed out', 'worker');
        emitTaskStatus(taskId, 'failed');
        updateChatReply(task, 'failed', result.text, 'Task timed out');
        return;
      }
      if (result.exitCode !== 0 && !result.text && result.error) {
        this.tasks.updateStatus(taskId, 'failed', { error: result.error, result: result.text });
        this.tasks.addLog(taskId, 'error', result.error, 'worker');
        emitTaskStatus(taskId, 'failed');
        updateChatReply(task, 'failed', result.text, result.error);
        return;
      }
      if (result.exitCode === 0 && !result.text && result.events.length === 0) {
        const noResponseError = 'OpenCode exited successfully but returned no usable response';
        this.tasks.updateStatus(taskId, 'failed', { error: noResponseError, result: result.text });
        this.tasks.addLog(taskId, 'error', noResponseError, 'worker');
        emitTaskStatus(taskId, 'failed');
        updateChatReply(task, 'failed', result.text, noResponseError);
        return;
      }
      this.tasks.updateStatus(taskId, 'completed', { result: result.text });
      this.tasks.addLog(taskId, 'info', 'Task completed', 'worker');
      emitTaskStatus(taskId, 'completed');
      updateChatReply(task, 'completed', result.text);
      this.extractMemory(task, agent);
    } catch (err) {
      const msg = (err as Error).message;
      this.tasks.updateStatus(taskId, 'failed', { error: msg });
      this.tasks.addLog(taskId, 'error', msg, 'worker');
      emitTaskStatus(taskId, 'failed');
      updateChatReply(task, 'failed', this.tasks.get(taskId)?.result || '', msg);
    } finally {
      this.unregisterCancellable(taskId);
      emitSystemStatus({ workers: this.runningCount() });
    }
  }

  private resolveCwd(task: Task, agent: Agent): string | undefined {
    let cwd = this.settings.workingDir?.trim() || undefined;
    if (task.project_id) {
      const p = this.projects.get(task.project_id);
      if (p?.root_dir) cwd = p.root_dir;
    }
    void agent;
    return cwd;
  }

  private composePrompt(task: Task, agent: Agent): string {
    const parts: string[] = [];
    if (agent.system_prompt) {
      parts.push(`[SYSTEM INSTRUCTIONS]\n${agent.system_prompt}`);
    }

    if (task.project_id) {
      const p = this.projects.get(task.project_id);
      if (p) {
        parts.push(`[PROJECT CONTEXT]\nProject: ${p.name}\nRoot: ${p.root_dir || 'N/A'}`);
        if (p.description) parts.push(`Description: ${p.description}`);
        if (p.instructions) parts.push(`Instructions:\n${p.instructions}`);
        const projectNotes = this.notes.list({ project_id: p.id, limit: 8 });
        if (projectNotes.length) {
          parts.push(
            `Project notes:\n${projectNotes.map(n => `- ${n.title}: ${(n.content || '').slice(0, 500)}`).join('\n')}`,
          );
        }
      }
    }

    const memories = this.memory.retrieveQuery(task.prompt || task.title, {
      projectId: task.project_id || undefined,
      limit: 8,
    });
    if (memories.length) {
      parts.push(
        `[RELEVANT MEMORIES]\n${memories
          .map(m => `[${m.type}] (importance ${m.importance}): ${m.content}`)
          .join('\n')}`,
      );
    }

    parts.push(`[TASK]\n${task.prompt || task.description || task.title}`);
    parts.push(
      `[RULES]\nYou are running inside AgentOS, a personal agent platform on macOS.\n` +
        `Your permissions: ${this.describePerms(agent)}.\n` +
        `Only perform actions within your granted permissions. For anything sensitive, dangerous, ` +
        `or outside your scope, STOP and describe exactly what you want to do and why; ` +
        `the user will be asked for approval.\n` +
        `When you need to modify files or run commands, do it yourself via your tools if permitted.`,
    );

    return parts.join('\n\n');
  }

  private describePerms(agent: Agent): string {
    return (
      agent.permissions
        .map(p => `${p.resource}:${p.action}${p.allowed ? '' : '(denied)'}`)
        .join(', ') || 'none'
    );
  }

  private registerCancellable(taskId: string, cancelFn: () => void): void {
    this.cancellables.set(taskId, cancelFn);
    this.running.add(taskId);
  }

  private unregisterCancellable(taskId: string): void {
    this.cancellables.delete(taskId);
    this.running.delete(taskId);
  }

  cancel(taskId: string): boolean {
    const fn = this.cancellables.get(taskId);
    if (fn) {
      fn();
      this.tasks.updateStatus(taskId, 'cancelled');
      emitTaskStatus(taskId, 'cancelled');
      return true;
    }
    return false;
  }

  runningCount(): number {
    return this.running.size;
  }

  private extractMemory(task: Task, agent: Agent): void {
    try {
      const canWrite = agent.permissions.some(
        p => p.resource === 'memory' && p.action === 'write' && p.allowed === 1,
      );
      if (!canWrite) return;
      const autoExtract = this.settings.getBool('memory_auto_extract', true);
      if (!autoExtract) return;
      const text = task.result;
      if (!text) return;

      const type = this.memory.extractType(text);
      if (!type) return;

      const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [];
      const useful = sentences.filter(s => s.length > 30 && s.length < 500).slice(0, 3);
      for (const s of useful) {
        const existing = this.memory.retrieveQuery(s, { limit: 1 });
        if (existing.length && existing[0].importance > 0.5) continue;
        this.memory.create({
          content: s.trim(),
          type,
          importance: 0.5,
          source_task_id: task.id,
          source_conversation_id: task.conversation_id || null,
          project_id: task.project_id || null,
          tags: agent.name,
        });
      }
    } catch (err) {
      log.warn('memory', `Memory extraction failed for task ${task.id}`, { error: (err as Error).message });
    }
  }
}