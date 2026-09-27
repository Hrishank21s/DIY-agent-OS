import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAINS, asBrainId } from '../src/executors/brains.js';
import { isAllowedOpenCodePath } from '../src/config.js';

describe('brain selection', () => {
  it('falls back to opencode for unknown ids', () => {
    expect(asBrainId('antigravity')).toBe('antigravity');
    expect(asBrainId('opencode')).toBe('opencode');
    expect(asBrainId('gpt')).toBe('opencode');
    expect(asBrainId(undefined)).toBe('opencode');
  });

  it('keeps each brain to its own executable allowlist', () => {
    expect(isAllowedOpenCodePath('gemini', 'antigravity')).toBe(true);
    // The whole point of the per-brain allowlist: selecting antigravity must
    // not let an opencode path through, or vice versa.
    expect(isAllowedOpenCodePath('gemini', 'opencode')).toBe(false);
    expect(isAllowedOpenCodePath('opencode', 'antigravity')).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-brain-'));
    const evil = path.join(dir, 'rm');
    fs.writeFileSync(evil, '#!/bin/sh\n', { mode: 0o755 });
    expect(isAllowedOpenCodePath(evil, 'antigravity')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('brain argv', () => {
  it('builds opencode argv with the prompt as a trailing positional', () => {
    const args = BRAINS.opencode.buildArgs({ prompt: 'hi; rm -rf /', model: 'x/y', cwd: '/tmp' });
    expect(args).toEqual(['run', '--format', 'json', '--model', 'x/y', '--dir', '/tmp', 'hi; rm -rf /']);
  });

  it('builds gemini argv in headless streaming mode and never yolo', () => {
    const args = BRAINS.antigravity.buildArgs({ prompt: 'hi', model: 'gemini-3-pro', cwd: '/tmp' });
    expect(args).toEqual([
      '-p', 'hi',
      '-o', 'stream-json',
      '--approval-mode', 'default',
      '-m', 'gemini-3-pro',
      '--skip-trust',
    ]);
    expect(args).not.toContain('--yolo');
    expect(args).not.toContain('-y');
  });

  it('omits the model flag when no model is configured', () => {
    expect(BRAINS.antigravity.buildArgs({ prompt: 'hi' })).not.toContain('-m');
    expect(BRAINS.opencode.buildArgs({ prompt: 'hi' })).not.toContain('--model');
  });
});

describe('brain event parsing', () => {
  it('reads assistant text from each CLI stream format', () => {
    expect(BRAINS.opencode.textOf({ type: 'text', part: { text: 'a' } })).toBe('a');
    expect(BRAINS.opencode.textOf({ type: 'text', text: 'b' })).toBe('b');
    expect(BRAINS.opencode.textOf({ type: 'step_finish' })).toBeUndefined();

    expect(BRAINS.antigravity.textOf({ type: 'message', role: 'assistant', content: 'c' })).toBe('c');
    // The user echo must not land in the result text.
    expect(BRAINS.antigravity.textOf({ type: 'message', role: 'user', content: 'prompt' })).toBeUndefined();
    expect(BRAINS.antigravity.textOf({ type: 'tool_use', tool_name: 'shell' })).toBeUndefined();
  });

  it('recognises each CLI step terminator', () => {
    expect(BRAINS.opencode.isStepEnd({ type: 'step_finish' })).toBe(true);
    expect(BRAINS.antigravity.isStepEnd({ type: 'result', status: 'success' })).toBe(true);
    expect(BRAINS.antigravity.isStepEnd({ type: 'message' })).toBe(false);
  });
});
