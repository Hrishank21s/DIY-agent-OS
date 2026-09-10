import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { analyzeCommand, isWithinRoot, type AllowedRule } from './risk.js';
import { ApprovalService } from './approvals.js';
import { TaskService } from './tasks.js';
import { hub } from './realtime.js';
import { Logger } from '../lib/logger.js';
import { config } from '../config.js';

const approvals = new ApprovalService();
const tasks = new TaskService();

export interface CommandResult {
  id: string;
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  taskId?: string | null;
  agentId?: string | null;
}

export interface ExecuteOptions {
  taskId?: string;
  agentId?: string;
  agentApprovalPolicy: string;
  allowedRules?: AllowedRule[];
  cwd?: string;
  timeoutMs?: number;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  onApprovalRequested?: (approvalId: string) => void;
}

/**
 * Execute a command with a controlled, safe argv-based spawn.
 * Never interprets the string through a shell.
 */
export class CommandExecutor {
  async execute(argv: string[], opts: ExecuteOptions): Promise<CommandResult> {
    const log = new Logger();
    const id = nanoid();
    const command = argv[0] || '';
    const result: CommandResult = {
      id,
      command,
      args: argv,
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      taskId: opts.taskId || null,
      agentId: opts.agentId || null,
    };

    // Risk assessment
    const assessment = analyzeCommand(argv, opts.agentApprovalPolicy, opts.allowedRules || []);

    // Record the command
    await this.recordCommand(result, opts, assessment);

    if (assessment.requiresApproval) {
      const approval = approvals.create({
        task_id: opts.taskId,
        agent_id: opts.agentId,
        type: 'command',
        description: `Execute: ${argv.join(' ')}`,
        payload: { argv, risk: assessment.risk },
        risk_level: assessment.risk,
      });
      // Mark task as waiting for approval
      if (opts.taskId) {
        tasks.updateStatus(opts.taskId, 'waiting_for_approval', { approval_state: 'pending' });
      }
      if (opts.onApprovalRequested) opts.onApprovalRequested(approval.id);
      log.info('command', `Command requires approval: ${argv.join(' ')} (${assessment.risk})`, { approvalId: approval.id });

      // Wait for approval. Event-driven: resolved as soon as an approval
      // response arrives for this request, or when the approval window lapses.
      const approved = await this.waitForApproval(approval.id);
      if (!approved) {
        result.exitCode = -1;
        result.stderr = 'Command rejected by approver';
        this.updateRecordResult(result);
        return result;
      }
      if (opts.taskId) {
        // In-flight execution resumed after approval; reflect it as running again
        tasks.updateStatus(opts.taskId, 'running');
      }
    }

    await this.executeSpawn(argv, result, opts, log);
    this.updateRecordResult(result);
    return result;
  }

  private waitForApproval(approvalId: string, maxWaitMs = config.approvalTimeoutMs): Promise<boolean> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (approved: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(approved);
      };
      const unsubscribe = hub.subscribe(evt => {
        if (evt.type === 'approval:responded' && evt.approvalId === approvalId) {
          finish(evt.status === 'approved');
        }
      });
      const timer = setTimeout(() => finish(false), maxWaitMs);
    });
  }

  private executeSpawn(
    argv: string[],
    result: CommandResult,
    opts: ExecuteOptions,
    _log: Logger,
  ): Promise<void> {
    return new Promise(resolve => {
      let child;
      try {
        child = spawn(argv[0], argv.slice(1), {
          cwd: opts.cwd,
          shell: false,
          env: { ...process.env, AGENTOS_TASK_ID: opts.taskId || '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        result.stderr = `Failed to spawn: ${(err as Error).message}`;
        resolve();
        return;
      }

      let timedOut = false;
      child.stdout?.on('data', d => {
        const s = d.toString();
        result.stdout += s;
        if (opts.onOutput) opts.onOutput(s, 'stdout');
      });
      child.stderr?.on('data', d => {
        const s = d.toString();
        result.stderr += s;
        if (opts.onOutput) opts.onOutput(s, 'stderr');
      });
      child.on('error', err => {
        result.stderr = `Process error: ${err.message}`;
      });
      child.on('close', code => {
        clearTimeout(timer);
        result.exitCode = code;
        result.timedOut = timedOut;
        resolve();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 3000);
      }, opts.timeoutMs || 120_000);
    });
  }

  private recordCommand(
    result: CommandResult,
    opts: ExecuteOptions,
    assessment: { risk: string; requiresApproval: boolean },
  ): void {
    const db = getDb();
    db.db
      .prepare(
        `INSERT INTO command_logs (id, command, args, task_id, agent_id, cwd, risk, requires_approval, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        result.id,
        result.command,
        JSON.stringify(result.args),
        opts.taskId || null,
        opts.agentId || null,
        opts.cwd || null,
        assessment.risk,
        assessment.requiresApproval ? 1 : 0,
      );
  }

  private updateRecordResult(result: CommandResult): void {
    const db = getDb();
    db.db
      .prepare(
        `UPDATE command_logs SET exit_code = ?, stdout = ?, stderr = ?, completed_at = datetime('now') WHERE id = ?`,
      )
      .run(result.exitCode, result.stdout, result.stderr, result.id);
  }
}

export function resolveRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export { isWithinRoot };
