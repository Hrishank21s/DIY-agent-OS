import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { SettingsService } from '../services/settings.js';
import { AgentService } from '../services/agents.js';
import { Logger } from '../lib/logger.js';
import { config } from '../config.js';

export interface OpenCodeEvent {
  type: string;
  text?: string;
  tool?: unknown;
  step?: unknown;
  [key: string]: unknown;
}

export interface OpenCodeResult {
  text: string;
  events: OpenCodeEvent[];
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  error?: string;
}

export interface RunOptions {
  prompt: string;
  model?: string;
  agent?: string;
  agentSystemPrompt?: string;
  cwd?: string;
  sessionId?: string;
  timeoutMs?: number;
  onEvent?: (event: OpenCodeEvent) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  env?: Record<string, string>;
}

export interface ExecutorController {
  cancel(): void;
  pid: number | null;
}

export interface OpenCodeExecutor {
  isAvailable(): Promise<{ available: boolean; version?: string; error?: string }>;
  run(opts: RunOptions): Promise<{ result: OpenCodeResult; controller: ExecutorController }>;
  getModels(): Promise<string[]>;
}

/**
 * Adapter around the installed OpenCode CLI.
 *
 * Uses `opencode run --format json` which streams newline-delimited JSON
 * events: step_start, text, tool, step_finish. This is abstracted so a future
 * brain (a different CLI or the opencode HTTP server via `opencode serve`)
 * can be plugged in without rewriting the rest of the application.
 */
export class OpenCodeCliExecutor implements OpenCodeExecutor {
  private settings: SettingsService;
  private agents: AgentService;
  private log: Logger;
  private opencodePath: string;

  constructor() {
    this.settings = new SettingsService();
    this.agents = new AgentService();
    this.log = new Logger();
    this.opencodePath = this.resolveExecutable();
  }

  private resolveExecutable(): string {
    const fromEnv = process.env.AGENTOS_OPENCODE_PATH?.trim();
    if (fromEnv) {
      // Runtime override; matches detectOpenCode() priority so config module
      // caching in tests cannot pin the executor to the installed binary.
      return fromEnv;
    }
    const fromSettings = this.settings.opencodePath?.trim();
    if (fromSettings && fs.existsSync(fromSettings) && fs.accessSync) {
      try {
        fs.accessSync(fromSettings, fs.constants.X_OK);
        return fromSettings;
      } catch {}
    }
    return config.opencodePath;
  }

  async isAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    return new Promise(resolve => {
      let child;
      try {
        child = spawn(this.opencodePath, ['--version'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        resolve({ available: false, error: (err as Error).message });
        return;
      }
      let out = '';
      let err = '';
      child.stdout?.on('data', d => (out += d.toString()));
      child.stderr?.on('data', d => (err += d.toString()));
      child.on('error', e => {
        resolve({ available: false, error: e.message });
      });
      child.on('close', code => {
        if (code === 0) {
          resolve({ available: true, version: out.trim() || err.trim() });
        } else {
          resolve({ available: false, error: err.trim() || out.trim() || `exit ${code}` });
        }
      });
    });
  }

  async getModels(): Promise<string[]> {
    return new Promise(resolve => {
      let child;
      try {
        child = spawn(this.opencodePath, ['models'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        resolve([]);
        return;
      }
      let out = '';
      child.stdout?.on('data', d => (out += d.toString()));
      child.on('error', () => resolve([]));
      child.on('close', () => {
        const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
        resolve(lines);
      });
    });
  }

  run(opts: RunOptions): Promise<{ result: OpenCodeResult; controller: ExecutorController }> {
    const args = ['run', '--format', 'json'];
    const model = opts.model || this.settings.configuredModel;
    if (model) {
      args.push('--model', model);
    }
    const agentModel = opts.agent ? this.agents.getByName(opts.agent)?.model : null;
    if (agentModel) {
      // Prefer agent-specified model when present
      const idx = args.indexOf('--model');
      if (idx !== -1) {
        args[idx + 1] = agentModel;
      } else {
        args.push('--model', agentModel);
      }
    }
    if (opts.sessionId) {
      args.push('--session', opts.sessionId);
    }
    if (opts.cwd) {
      args.push('--dir', opts.cwd);
    }
    // Add the prompt as positional arguments (avoids shell interpretation)
    // opencode run accepts the message as trailing positionals
    args.push(opts.prompt);

    const result: OpenCodeResult = {
      text: '',
      events: [],
      exitCode: null,
      timedOut: false,
      cancelled: false,
    };

    return new Promise(resolve => {
      const controller: ExecutorController = { cancel: () => {}, pid: null };
      let child: ChildProcessWithoutNullStreams | null = null;
      let completed = false;
      let timedOut = false;
      let cancelled = false;

      const finalize = () => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        result.timedOut = timedOut;
        result.cancelled = cancelled;
        resolve({ result, controller });
      };

      try {
        child = spawn(this.opencodePath, args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: opts.cwd || undefined,
          env: {
            ...process.env,
            ...(opts.env || {}),
            OPENCODE_NON_INTERACTIVE: '1',
          },
        }) as unknown as ChildProcessWithoutNullStreams;
      } catch (err) {
        result.error = (err as Error).message;
        finalize();
        return;
      }

      controller.pid = child.pid ?? null;
      controller.cancel = () => {
        cancelled = true;
        try { child?.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, 3000);
      };

      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: OpenCodeEvent;
        try {
          evt = JSON.parse(trimmed) as OpenCodeEvent;
        } catch {
          // Not JSON - treat as plain output
          if (trimmed) {
            result.text += trimmed + '\n';
            if (opts.onStdout) opts.onStdout(trimmed + '\n');
          }
          return;
        }
        result.events.push(evt);
        const evtPart = (evt as OpenCodeEvent & { part?: { text?: unknown } }).part;
        const textContent = evtPart?.text ?? evt.text;
        if (evt.type === 'text' && typeof textContent === 'string') {
          result.text += textContent;
          if (opts.onEvent) opts.onEvent(evt);
          if (opts.onStdout) opts.onStdout(textContent);
        }
        if (evt.type === 'step_finish') {
          if (opts.onEvent) opts.onEvent(evt);
        }
      });

      child.stderr.on('data', d => {
        const s = d.toString();
        if (opts.onStderr) opts.onStderr(s);
      });

      child.on('error', err => {
        result.error = err.message;
        finalize();
      });

      // `close` only fires once the process has exited AND every stdio pipe is
      // closed. Some opencode helper/grandchild processes can hold the stdout
      // fd open briefly, so also finalize shortly after the direct child exits.
      let exitFallback: NodeJS.Timeout | null = null;
      child.on('exit', code => {
        result.exitCode = code;
        exitFallback = setTimeout(() => finalize(), 150);
      });

      child.on('close', code => {
        result.exitCode = code;
        if (exitFallback) clearTimeout(exitFallback);
        finalize();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        controller.cancel();
      }, opts.timeoutMs || config.taskTimeoutMs);
    });
  }
}

export function createExecutor(): OpenCodeExecutor {
  return new OpenCodeCliExecutor();
}
