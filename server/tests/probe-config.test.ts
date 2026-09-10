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

describe('isAllowedOrigin', () => {
  const trusted = ['http://192.168.1.50:3000', 'https://agentos.example.com'];

  // note: imported dynamically, and this block runs after the probe tests, so
  // the probe tests' fresh-module expectation for env resolution is preserved.
  async function allowed(origin: string, origins: string[]): Promise<boolean> {
    const { isAllowedOrigin } = await import('../src/config.js');
    return isAllowedOrigin(origin, origins);
  }

  it('allows explicitly configured (LAN/public) origins', async () => {
    expect(await allowed('http://192.168.1.50:3000', trusted)).toBe(true);
    expect(await allowed('https://agentos.example.com', trusted)).toBe(true);
    // trailing slash is tolerated
    expect(await allowed('https://agentos.example.com/', trusted)).toBe(true);
  });

  it('allows loopback origins regardless of configuration', async () => {
    expect(await allowed('http://localhost:3000', [])).toBe(true);
    expect(await allowed('http://localhost:5173', [])).toBe(true);
    expect(await allowed('http://127.0.0.1:3000', [])).toBe(true);
    expect(await allowed('http://[::1]:3000', [])).toBe(true);
  });

  it('rejects unconfigured, mismatched, and non-http(s) origins (fails closed)', async () => {
    expect(await allowed('http://192.168.1.50:3001', trusted)).toBe(false);
    expect(await allowed('http://192.168.1.51:3000', trusted)).toBe(false);
    // same host, different scheme => different origin
    expect(await allowed('https://192.168.1.50:3000', trusted)).toBe(false);
    expect(await allowed('ftp://agentos.example.com', trusted)).toBe(false);
    expect(await allowed('not-a-url', trusted)).toBe(false);
  });
});