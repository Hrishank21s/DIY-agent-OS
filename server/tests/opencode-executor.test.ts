import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { createExecutor } from '../src/executors/opencode.js';
import { isAllowedOpenCodePath } from '../src/config.js';

beforeAll(() => seed(getDb()));

describe('OpenCode path allowlist', () => {
  it('allows bare opencode on PATH', () => {
    expect(isAllowedOpenCodePath('opencode')).toBe(true);
  });

  it('allows a named, executable opencode binary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-path-check-'));
    const bin = path.join(dir, 'opencode');
    fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    expect(isAllowedOpenCodePath(bin)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects unrelated executables and non-executable files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-path-check-'));
    const evil = path.join(dir, 'rm');
    fs.writeFileSync(evil, '#!/bin/sh\n', { mode: 0o755 });
    expect(isAllowedOpenCodePath(evil)).toBe(false);
    const plain = path.join(dir, 'opencode');
    fs.writeFileSync(plain, 'not executable');
    expect(isAllowedOpenCodePath(plain)).toBe(false);
    expect(isAllowedOpenCodePath('/usr/bin/ls')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('OpenCodeExecutor', () => {
  it('detects OpenCode availability (safe mode)', async () => {
    const executor = createExecutor();
    const info = await executor.isAvailable();
    // The executor must at least run without crashing; availability depends on environment
    expect(typeof info.available).toBe('boolean');
    expect(typeof info.version).toBe('string' || 'undefined');
  });

  it('lists models', async () => {
    const executor = createExecutor();
    const models = await executor.getModels();
    expect(Array.isArray(models)).toBe(true);
  });

  it(
    'runs a short task and returns text (skipped if OpenCode unavailable)',
    async () => {
      const executor = createExecutor();
      const info = await executor.isAvailable();
      if (!info.available) {
        expect(true).toBe(true); // skip gracefully when brain unavailable
        return;
      }
      const { result } = await executor.run({
        prompt: 'Reply with exactly: ping',
        timeoutMs: 150000,
      });
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.timedOut).toBe(false);
    },
    180000,
  );
});
