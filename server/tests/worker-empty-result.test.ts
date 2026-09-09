import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpenCodeExecutor, OpenCodeResult, RunOptions, ExecutorController } from '../src/executors/opencode.js';
import type { Task } from '../src/services/tasks.js';
import type { Agent, Permission } from '../src/services/agents.js';
import type { TaskService } from '../src/services/tasks.js';
import type { AgentService } from '../src/services/agents.js';
import type { SettingsService } from '../src/services/settings.js';
import type { MemoryService } from '../src/services/memory.js';
import type { ProjectService } from '../src/services/projects.js';
import type { NoteService } from '../src/services/notes.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_test_1',
    title: 'Test task',
    description: 'Test',
    prompt: 'Say hello',
    status: 'queued',
    priority: 'normal',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    name: 'General',
    enabled: 1,
    approval_policy: 'auto',
    permissions: [],
    ...overrides,
  };
}

function makeMockExecutor(runResult: OpenCodeResult): OpenCodeExecutor {
  return {
    isAvailable: vi.fn().mockResolvedValue({ available: true, version: '1.18.30' }),
    getModels: vi.fn().mockResolvedValue(['opencode/big-pickle']),
    run: vi.fn().mockResolvedValue({
      result: runResult,
      controller: { cancel: vi.fn(), pid: 12345 } as ExecutorController,
    }),
  };
}

function makeMockTaskService(): TaskService {
  return {
    get: vi.fn(),
    updateStatus: vi.fn(),
    addLog: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    claimAvailable: vi.fn(),
    recoverStaleTasks: vi.fn().mockReturnValue({ running: 0, waiting: 0 }),
    countByStatus: vi.fn().mockReturnValue({}),
  } as unknown as TaskService;
}

function makeMockAgentService(agent: Agent | null): AgentService {
  return {
    get: vi.fn().mockReturnValue(agent),
    getByName: vi.fn().mockReturnValue(agent),
    list: vi.fn().mockReturnValue(agent ? [agent] : []),
    create: vi.fn(),
  } as unknown as AgentService;
}

function makeMockSettings(): SettingsService {
  return {
    workingDir: '/tmp/test',
    configuredModel: 'opencode/big-pickle',
    getBool: vi.fn().mockReturnValue(true),
    getNumber: vi.fn().mockReturnValue(2),
    get: vi.fn(),
    set: vi.fn(),
  } as unknown as SettingsService;
}

function makeMockMemory(): MemoryService {
  return {
    retrieveQuery: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    extractType: vi.fn().mockReturnValue(null),
    touch: vi.fn(),
  } as unknown as MemoryService;
}

function makeMockProjects(): ProjectService {
  return {
    get: vi.fn().mockReturnValue(null),
    getByName: vi.fn().mockReturnValue(null),
    create: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  } as unknown as ProjectService;
}

function makeMockNotes(): NoteService {
  return {
    list: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as NoteService;
}

vi.mock('../src/services/realtime.js', () => ({
  hub: { emit: vi.fn() },
  emitTaskStatus: vi.fn(),
  emitTaskOutput: vi.fn(),
  emitSystemStatus: vi.fn(),
}));

vi.mock('../src/lib/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('AgentWorker empty-result detection', () => {
  let taskService: TaskService;
  let agentService: AgentService;
  let settingsService: SettingsService;
  let memoryService: MemoryService;
  let projectService: ProjectService;
  let noteService: NoteService;

  beforeEach(() => {
    taskService = makeMockTaskService();
    agentService = makeMockAgentService(makeAgent());
    settingsService = makeMockSettings();
    memoryService = makeMockMemory();
    projectService = makeMockProjects();
    noteService = makeMockNotes();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks task FAILED when exit code 0 but no text and no events', async () => {
    const task = makeTask();
    (taskService.get as any).mockReturnValue(task);

    const executor = makeMockExecutor({
      text: '',
      events: [],
      exitCode: 0,
      timedOut: false,
      cancelled: false,
    });

    const { AgentWorker } = await import('../src/workers/agent-worker.js');
    const worker = new AgentWorker(
      taskService, agentService, settingsService,
      memoryService, projectService, noteService,
      executor,
    );

    await worker.execute('task_test_1');

    const statusCalls = (taskService.updateStatus as any).mock.calls;
    const failedCall = statusCalls.find((c: any[]) => c[1] === 'failed');

    expect(failedCall).toBeDefined();
    expect(failedCall![0]).toBe('task_test_1');
    expect(failedCall![2]).toMatchObject({
      error: 'OpenCode exited successfully but returned no usable response',
    });
  });

  it('completes task when exit code 0 and text is present', async () => {
    const task = makeTask();
    (taskService.get as any).mockReturnValue(task);

    const executor = makeMockExecutor({
      text: 'Hello!',
      events: [{ type: 'text', text: 'Hello!' }],
      exitCode: 0,
      timedOut: false,
      cancelled: false,
    });

    const { AgentWorker } = await import('../src/workers/agent-worker.js');
    const worker = new AgentWorker(
      taskService, agentService, settingsService,
      memoryService, projectService, noteService,
      executor,
    );

    await worker.execute('task_test_1');

    const statusCalls = (taskService.updateStatus as any).mock.calls;
    const completedCall = statusCalls.find((c: any[]) => c[1] === 'completed');

    expect(completedCall).toBeDefined();
    expect(completedCall![0]).toBe('task_test_1');
    expect(completedCall![2]).toMatchObject({ result: 'Hello!' });
  });

  it('completes task when exit code 0 and events exist but no text (legitimate non-text response)', async () => {
    const task = makeTask();
    (taskService.get as any).mockReturnValue(task);

    const executor = makeMockExecutor({
      text: '',
      events: [
        { type: 'tool_use', tool: 'bash', part: { type: 'tool-use' } },
        { type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } },
      ],
      exitCode: 0,
      timedOut: false,
      cancelled: false,
    });

    const { AgentWorker } = await import('../src/workers/agent-worker.js');
    const worker = new AgentWorker(
      taskService, agentService, settingsService,
      memoryService, projectService, noteService,
      executor,
    );

    await worker.execute('task_test_1');

    const statusCalls = (taskService.updateStatus as any).mock.calls;
    const completedCall = statusCalls.find((c: any[]) => c[1] === 'completed');
    const failedCall = statusCalls.find((c: any[]) => c[1] === 'failed');

    expect(completedCall).toBeDefined();
    expect(failedCall).toBeUndefined();
  });

  it('marks task FAILED on non-zero exit code with error', async () => {
    const task = makeTask();
    (taskService.get as any).mockReturnValue(task);

    const executor = makeMockExecutor({
      text: '',
      events: [],
      exitCode: 1,
      timedOut: false,
      cancelled: false,
      error: 'Process crashed',
    });

    const { AgentWorker } = await import('../src/workers/agent-worker.js');
    const worker = new AgentWorker(
      taskService, agentService, settingsService,
      memoryService, projectService, noteService,
      executor,
    );

    await worker.execute('task_test_1');

    const statusCalls = (taskService.updateStatus as any).mock.calls;
    const failedCall = statusCalls.find((c: any[]) => c[1] === 'failed');

    expect(failedCall).toBeDefined();
    expect(failedCall![2]).toMatchObject({ error: 'Process crashed' });
  });
});
