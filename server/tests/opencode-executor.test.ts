import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { createExecutor } from '../src/executors/opencode.js';

beforeAll(() => seed(getDb()));

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
