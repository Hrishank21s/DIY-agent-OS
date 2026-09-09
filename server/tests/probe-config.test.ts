import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function importConfig() {
  return (await import('../src/config.js')).config;
}

describe('env-based executable resolution probe', () => {
  it('resolves env path on first import', async () => {
    process.env.AGENTOS_OPENCODE_PATH = '/tmp/agentos-probe-first';
    const cfg = await importConfig();
    expect(cfg.opencodePath).toBe('/tmp/agentos-probe-first');
  });

  it('resolves env path after vi.resetModules', async () => {
    vi.resetModules();
    process.env.AGENTOS_OPENCODE_PATH = '/tmp/agentos-probe-second';
    const cfg = await importConfig();
    console.log('RESOLVED second =', cfg.opencodePath);
    expect(cfg.opencodePath).toBe('/tmp/agentos-probe-second');
  });
});