import { basename } from 'node:path';
import { realpathSync } from 'node:fs';

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high';

export interface RiskAssessment {
  risk: RiskLevel;
  requiresApproval: boolean;
  reason?: string;
}

/**
 * Structured allow-list rule. `args`, when provided, must match the exact
 * argv (after the executable) for the rule to apply. When omitted, every
 * invocation of the executable is allowed.
 */
export interface AllowedRule {
  executable: string;
  args?: string[];
}

const HIGH_RISK_COMMANDS = new Set([
  'rm',
  'rmdir',
  'sudo',
  'launchctl',
  'launchd',
  'systemctl',
  'reboot',
  'shutdown',
  'halt',
  'poweroff',
  'dd',
  'mkfs',
  'diskutil',
  'fdisk',
  'kill',
  'pkill',
  'killall',
  'chmod',
  'chown',
  'passwd',
  'usermod',
  'groupadd',
  'useradd',
  'iptables',
  'pfctl',
  'networksetup',
  'pf',
  'brew',
  'port',
  'npm',
  'yarn',
  'pnpm',
  'pip',
  'pip3',
  'gem',
  'cargo',
  'go install',
  'git push',
  'git reset',
  'git clean',
  'curl',
  'wget',
  'chroot',
  'mount',
  'umount',
  'openssl',
  'rmdir',
]);

const MEDIUM_RISK_COMMANDS = new Set([
  'mv',
  'cp',
  'touch',
  'mkdir',
  'git add',
  'git commit',
  'git checkout',
  'git branch',
  'git merge',
  'git rebase',
  'ssh',
  'scp',
  'python',
  'node',
  'ruby',
  'perl',
  'bash',
  'sh',
  'zsh',
  'cat',
  'echo',
  'nano',
  'vim',
  'tee',
  'sed',
  'awk',
  'export',
  'unset',
  'env',
  'crontab',
  'at',
  'osascript',
  'security',
  'defaults',
]);

/**
 * Commands that must NEVER run without explicit human approval, regardless of
 * the agent's approval policy or any allow-list rule.
 */
const MUST_APPROVE_COMMANDS = new Set([
  'sudo',
  'rm',
  'launchctl',
  'launchd',
  'diskutil',
  'mkfs',
  'dd',
  'fdisk',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'chroot',
  'mount',
  'umount',
  'iptables',
  'pfctl',
  'networksetup',
  'security',
  'passwd',
  'usermod',
  'useradd',
  'groupadd',
  'osascript',
  'crontab',
  'kill',
  'pkill',
  'killall',
]);

export interface AnalyzeOptions {
  /** One or more { executable, args } rules explicitly allowed for this run. */
  allowedRules?: AllowedRule[];
}

function resolveRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function executableMatches(argv0: string, ruleExec: string): boolean {
  if (argv0 === ruleExec) return true;
  return basename(argv0) === basename(ruleExec) || resolveRealPath(argv0) === resolveRealPath(ruleExec);
}

function matchesRule(argv: string[], rule: AllowedRule): boolean {
  const exec = argv[0] || '';
  const args = argv.slice(1);
  if (!executableMatches(exec, rule.executable)) return false;
  if (!rule.args) return true;
  if (rule.args.length !== args.length) return false;
  return rule.args.every((a, i) => a === args[i]);
}

/**
 * Analyze a command (already tokenized) and determine its risk level and
 * whether it requires human approval given the agent's approval policy.
 *
 * Catastrophic commands (sudo, rm, disk utilities, launchctl, ...) ALWAYS
 * require approval, cannot be bypassed by raising the approval policy, and
 * cannot be allowed by an allow-list rule.
 */
export function analyzeCommand(argv: string[], approvalPolicy: string, allowedRules: AllowedRule[] = []): RiskAssessment {
  const policy = normalizeApprovalPolicy(approvalPolicy);
  const base = classifyCommand(argv);

  // Hard rule: catastrophic commands always require approval
  const baseCmd = (argv[0] || '').toLowerCase();
  if (MUST_APPROVE_COMMANDS.has(baseCmd)) {
    return {
      risk: base,
      requiresApproval: true,
      reason: `Command '${baseCmd}' always requires human approval`,
    };
  }

  // Structured allow-list: exact-match rules only, no prefix matching.
  for (const rule of allowedRules) {
    if (matchesRule(argv, rule)) {
      return { risk: 'safe', requiresApproval: false };
    }
  }

  return applyPolicy(base, policy);
}

function classifyCommand(argv: string[]): RiskLevel {
  const cmd = (argv[0] || '').toLowerCase();
  const args = argv.slice(1).join(' ');

  // git subcommands
  if (cmd === 'git') {
    if (/(^|\s)(push|reset|clean|checkout -b|branch -D|merge --abort|rebase --abort|rev-parse master)/.test(args)) {
      return 'high';
    }
    if (/(^|\s)(add|commit|checkout|branch|merge|rebase|stash|log|diff|status)/.test(args)) {
      return 'medium';
    }
    return 'low';
  }

  if (cmd === 'rm') {
    if (/(^|\s)-[-A-Za-z]*[rf]/.test(args)) {
      return 'high';
    }
    return 'medium';
  }

  if (cmd === 'cat' || cmd === 'echo' || cmd === 'tee') {
    if (/\||>/.test(args)) return 'medium';
    return 'safe';
  }

  if (['ls', 'pwd', 'head', 'tail', 'grep', 'find', 'stat', 'file', 'which', 'du', 'df', 'true', 'false', 'date', 'printf', 'man'].includes(cmd)) {
    return 'safe';
  }

  if (cmd === 'brew' || cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm' || cmd === 'pip' || cmd === 'pip3' || cmd === 'gem' || cmd === 'cargo' || cmd === 'apt-get' || cmd === 'curl' || cmd === 'wget') {
    return 'high';
  }

  if (HIGH_RISK_COMMANDS.has(cmd)) {
    return 'high';
  }

  if (MEDIUM_RISK_COMMANDS.has(cmd)) {
    return 'medium';
  }

  return 'low';
}

function applyPolicy(risk: RiskLevel, policy: string): RiskAssessment {
  const requires = shouldRequireApproval(risk, policy);
  return {
    risk,
    requiresApproval: requires,
    reason: requires
      ? `Command is ${risk} risk and agent approval policy is '${policy}'`
      : undefined,
  };
}

export function shouldRequireApproval(risk: RiskLevel, policy: string): boolean {
  const order: Record<RiskLevel, number> = { safe: 0, low: 1, medium: 2, high: 3 };
  const riskRank = order[risk];
  // policy sets the maximum rank that is allowed WITHOUT approval
  const allowedRank: Record<string, number> = {
    safe: order.safe,
    low: order.low,
    medium: order.medium,
    high: order.high,
    always_require_approval: -1,
    always_approve: -1, // legacy alias
  };
  const threshold = allowedRank[policy];
  if (threshold === undefined) return true;
  return riskRank > threshold;
}

/** Canonical spelling for the "always require approval" policy. */
export function normalizeApprovalPolicy(policy: string | undefined | null): string {
  if (!policy) return 'always_require_approval';
  if (policy === 'always_approve') return 'always_require_approval';
  return policy;
}

/**
 * Check whether a file path is within an allowed root directory.
 */
export function isWithinRoot(absolutePath: string, roots: string[]): boolean {
  for (const root of roots) {
    const r = root.replace(/\/+$/, '');
    const p = absolutePath;
    if (p === r || p.startsWith(r + '/')) return true;
  }
  return false;
}
