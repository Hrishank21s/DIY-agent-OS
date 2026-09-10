import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fixtureScript: string;
let fixtureDir: string;

function makeFixtureScript(ndjsonLines: string[]): void {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-ndjson-fixture-'));
  fixtureScript = path.join(fixtureDir, 'opencode');

  const payloadFile = path.join(fixtureDir, 'payload.ndjson');
  fs.writeFileSync(payloadFile, ndjsonLines.join('\n') + '\n');

  const script = `#!/bin/sh
cat "${payloadFile}"
`;
  fs.writeFileSync(fixtureScript, script, { mode: 0o755 });
  process.env.AGENTOS_OPENCODE_PATH = fixtureScript;
}

beforeEach(() => {
  delete process.env.AGENTOS_OPENCODE_PATH;
});

afterEach(() => {
  delete process.env.AGENTOS_OPENCODE_PATH;
  if (fixtureDir) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

async function importExecutor() {
  const mod = await import('../src/executors/opencode.js');
  return mod;
}

describe('NDJSON text-event parsing (real subprocess fixture)', () => {
  it('extracts text from evt.part.text (OpenCode v1.18.30 format)', async () => {
    makeFixtureScript([
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","timestamp":1788974094894,"sessionID":"s1","part":{"id":"p1","messageID":"m1","sessionID":"s1","type":"text","text":"Hello from part!"}}',
      '{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}',
    ]);

    const { OpenCodeCliExecutor } = await importExecutor();
    const executor = new OpenCodeCliExecutor();
    const { result } = await executor.run({ prompt: 'test' });

    expect(result.text).toBe('Hello from part!');
    expect(result.events.length).toBe(3);
    expect(result.exitCode).toBe(0);
  });

  it('extracts text from evt.text (legacy format)', async () => {
    makeFixtureScript([
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","text":"Hello from top-level!"}',
      '{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}',
    ]);

    const { OpenCodeCliExecutor } = await importExecutor();
    const executor = new OpenCodeCliExecutor();
    const { result } = await executor.run({ prompt: 'test' });

    expect(result.text).toBe('Hello from top-level!');
    expect(result.events.length).toBe(3);
  });

  it('accumulates text from multiple text events', async () => {
    makeFixtureScript([
      '{"type":"text","part":{"type":"text","text":"Hello "}}',
      '{"type":"text","part":{"type":"text","text":"world!"}}',
    ]);

    const { OpenCodeCliExecutor } = await importExecutor();
    const executor = new OpenCodeCliExecutor();
    const { result } = await executor.run({ prompt: 'test' });

    expect(result.text).toBe('Hello world!');
  });

  it('collects non-text events into events array', async () => {
    makeFixtureScript([
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"tool_use","part":{"type":"tool-use","toolName":"bash"}}',
      '{"type":"text","part":{"type":"text","text":"done"}}',
      '{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}',
    ]);

    const { OpenCodeCliExecutor } = await importExecutor();
    const executor = new OpenCodeCliExecutor();
    const { result } = await executor.run({ prompt: 'test' });

    expect(result.events.length).toBe(4);
    expect(result.events[1].type).toBe('tool_use');
    expect(result.text).toBe('done');
  });

  it('handles non-JSON lines as plain text fallback', async () => {
    makeFixtureScript([
      'some plain text output',
      '{"type":"text","part":{"type":"text","text":"real response"}}',
    ]);

    const { OpenCodeCliExecutor } = await importExecutor();
    const executor = new OpenCodeCliExecutor();
    const { result } = await executor.run({ prompt: 'test' });

    expect(result.text).toContain('some plain text output');
    expect(result.text).toContain('real response');
  });

  it('handles empty stdout (no events)', async () => {
    makeFixtureScript([]);

    const { OpenCodeCliExecutor } = await importExecutor();
    const executor = new OpenCodeCliExecutor();
    const { result } = await executor.run({ prompt: 'test' });

    expect(result.text).toBe('');
    expect(result.events.length).toBe(0);
  });

  it('fires onEvent and onStdout callbacks for text events', async () => {
    makeFixtureScript(['{"type":"text","part":{"type":"text","text":"callback test"}}']);

    const onEvent = vi.fn();
    const onStdout = vi.fn();

    const { OpenCodeCliExecutor } = await importExecutor();
    const executor = new OpenCodeCliExecutor();
    await executor.run({ prompt: 'test', onEvent, onStdout });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onStdout).toHaveBeenCalledWith('callback test');
  });
});