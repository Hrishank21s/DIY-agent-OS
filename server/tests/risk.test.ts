import { describe, it, expect } from 'vitest';
import {
  analyzeCommand,
  shouldRequireApproval,
  isWithinRoot,
} from '../src/services/risk.js';

describe('Risk classification', () => {
  it('rm -rf is always high risk (requires approval)', () => {
    const a = analyzeCommand(['rm', '-rf', '/important'], 'high');
    expect(a.risk).toBe('high');
    expect(a.requiresApproval).toBe(true);
  });

  it('rm -rf requires approval even for always-approve threshold', () => {
    const a = analyzeCommand(['rm', '-rf', '/'], 'high');
    expect(a.requiresApproval).toBe(true);
  });

  it('git push requires approval', () => {
    const a = analyzeCommand(['git', 'push', 'origin', 'main'], 'medium');
    expect(a.requiresApproval).toBe(true);
  });

  it('sudo always requires approval', () => {
    const a = analyzeCommand(['sudo', 'rm', '/etc/passwd'], 'high');
    expect(a.requiresApproval).toBe(true);
  });

  it('ls is safe', () => {
    const a = analyzeCommand(['ls', '-la'], 'safe');
    expect(a.risk).toBe('safe');
    expect(a.requiresApproval).toBe(false);
  });

  it('whitelisted rules allow execution', () => {
    const a = analyzeCommand(['ls', '/tmp'], 'safe', [{ executable: 'ls', args: ['/tmp'] }]);
    expect(a.requiresApproval).toBe(false);
  });

  it('whitelist matches by executable basename', () => {
    const a = analyzeCommand(['/bin/ls', '/tmp'], 'safe', [{ executable: 'ls', args: ['/tmp'] }]);
    expect(a.requiresApproval).toBe(false);
  });

  it('whitelist uses exact argv matching, not prefix matching', () => {
    // node is medium risk; under a 'safe' policy it is only allowed when an
    // exact rule matches.
    const rule = [{ executable: 'node', args: ['script.js'] }];
    expect(analyzeCommand(['node', 'script.js'], 'safe', rule).requiresApproval).toBe(false);
    expect(analyzeCommand(['node', 'script.jsX'], 'safe', rule).requiresApproval).toBe(true);
    expect(analyzeCommand(['node', 'script.js', '-x'], 'safe', rule).requiresApproval).toBe(true);
  });

  it('allow-list rules cannot bypass mandatory approval', () => {
    const rule = [{ executable: 'rm', args: ['-rf', '/important'] }];
    const a = analyzeCommand(['rm', '-rf', '/important'], 'high', rule);
    expect(a.requiresApproval).toBe(true);
  });

  it('rule with no args allows any invocation of that executable', () => {
    const a = analyzeCommand(['ls', '-la', '/tmp'], 'safe', [{ executable: 'ls' }]);
    expect(a.requiresApproval).toBe(false);
    // but other executables are still gated
    const b = analyzeCommand(['whoami'], 'safe', [{ executable: 'ls' }]);
    expect(b.requiresApproval).toBe(true);
  });

  it('approval policy gating works', () => {
    // medium command with 'safe' policy -> requires approval
    expect(shouldRequireApproval('medium', 'safe')).toBe(true);
    // medium command with 'medium' policy -> allowed
    expect(shouldRequireApproval('medium', 'medium')).toBe(false);
    // always_require_approval -> everything requires approval
    expect(shouldRequireApproval('safe', 'always_require_approval')).toBe(true);
    // legacy 'always_approve' spelling behaves identically
    expect(shouldRequireApproval('safe', 'always_approve')).toBe(true);
    // unknown policies fail closed
    expect(shouldRequireApproval('safe', 'bogus')).toBe(true);
  });

  it('mkfs/disk operations are high risk', () => {
    const a = analyzeCommand(['diskutil', 'eraseVolume', 'x', '/dev/disk2'], 'medium');
    expect(a.risk).toBe('high');
    expect(a.requiresApproval).toBe(true);
  });

  it('node/python script execution is medium risk', () => {
    const a = analyzeCommand(['node', 'script.js'], 'medium');
    expect(a.risk).toBe('medium');
    expect(a.requiresApproval).toBe(false);
  });
});

describe('Path boundaries', () => {
  it('detects paths within a root', () => {
    expect(isWithinRoot('/Users/me/Projects/App/src/main.ts', ['/Users/me/Projects'])).toBe(true);
    expect(isWithinRoot('/Users/me/Projects', ['/Users/me/Projects'])).toBe(true);
  });

  it('rejects paths outside a root', () => {
    expect(isWithinRoot('/Users/me/Documents/secret', ['/Users/me/Projects'])).toBe(false);
    expect(isWithinRoot('/etc/passwd', ['/Users/me/Projects'])).toBe(false);
    // prefix trap: /Users/me/ProjectsEvil must NOT match /Users/me/Projects
    expect(isWithinRoot('/Users/me/ProjectsEvil/x', ['/Users/me/Projects'])).toBe(false);
  });
});
