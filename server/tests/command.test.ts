import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { CommandExecutor } from '../src/services/command.js';
import { ApprovalService } from '../src/services/approvals.js';

beforeAll(() => seed(getDb()));

describe('CommandExecutor', () => {
  const captureApproval = () => {
    let approvalId: string | null = null;
    let resolveApproval: (id: string) => void = () => {};
    const promise = new Promise<string>(resolve => { resolveApproval = resolve; });
    return {
      onApprovalRequested: (id: string) => { approvalId = id; resolveApproval(id); },
      waitFor: () => promise,
      get id(): string | null { return approvalId; },
    };
  };

  it('executes a safe command', async () => {
    const ex = new CommandExecutor();
    const result = await ex.execute(['echo', 'hello'], {
      agentApprovalPolicy: 'safe',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('pauses and requires approval for dangerous commands', async () => {
    const ex = new CommandExecutor();
    const approvals = new ApprovalService();
    const cap = captureApproval();
    const resultP = ex.execute(['rm', '-rf', '/tmp/agentos-test-src'], {
      agentApprovalPolicy: 'high',
      taskId: null,
      onApprovalRequested: cap.onApprovalRequested,
    });

    // Wait for the approval to appear
    const approvalId = await Promise.race([
      cap.waitFor(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('approval never requested')), 5000)),
    ]);
    const approval = approvals.get(approvalId)!;
    expect(approval.risk_level).toBe('high');
    expect(approval.status).toBe('pending');

    // Reject it -> execution should abort
    approvals.respond(approval.id, false, 'admin');
    const result = await resultP;
    expect(result.stderr).toContain('rejected');
    expect(result.exitCode).toBe(-1);
  });

  it('continues after approval', async () => {
    const ex = new CommandExecutor();
    const approvals = new ApprovalService();
    const cap = captureApproval();
    const resultP = ex.execute(['rm', '-rf', '/tmp/agentos-nonexistent-target'], {
      agentApprovalPolicy: 'high',
      onApprovalRequested: cap.onApprovalRequested,
    });

    const approvalId = await Promise.race([
      cap.waitFor(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('approval never requested')), 5000)),
    ]);
    approvals.respond(approvals.get(approvalId)!.id, true, 'admin');
    const result = await resultP;
    // rm -rf on non-existent path returns non-zero, but execution continued
    expect(result.stderr).not.toContain('rejected');
    expect(result.timedOut).toBe(false);
  });

  it('never uses shell string concatenation', async () => {
    const ex = new CommandExecutor();
    const db = getDb();
    const rmCount = () => (db.db.prepare("SELECT COUNT(*) c FROM command_logs WHERE command='rm'").get() as { c: number }).c;
    const before = rmCount();

    // A command injection attempt via argv should NOT execute the injected part
    const result = await ex.execute(['echo', 'safe; rm -rf /tmp/evil'], {
      agentApprovalPolicy: 'high',
    });

    // Because we spawn argv directly, the semicolon is just an argument, not shell
    expect(result.stdout).toContain('safe; rm -rf /tmp/evil');
    // And importantly, the injected rm command was NOT run as a separate process
    const after = rmCount();
    expect(after).toBe(before);
  });
});
