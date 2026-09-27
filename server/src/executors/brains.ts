import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The selectable AI brains. `antigravity` runs Google's Gemini CLI: the
 * Antigravity IDE itself ships no headless binary (only an Electron app and a
 * `language_server`), so the CLI is the only Google agent AgentOS can spawn.
 */
export type BrainId = 'opencode' | 'antigravity';

export interface BrainProfile {
  id: BrainId;
  label: string;
  /** Basenames this brain may be exec'd as, so a bad path cannot run /usr/bin/rm. */
  basenames: string[];
  /** Absolute paths probed in order when nothing is configured. */
  candidates: string[];
  /** Env var that overrides the resolved path. */
  pathEnv: string;
  /** `settings` table key holding the configured path. */
  pathSetting: string;
  /** `settings` table key holding the model, kept per brain so switching
   * brains does not hand OpenCode's model id to Gemini. */
  modelSetting: string;
  /** Blank means "let the CLI pick", rather than pinning a model id that ages out. */
  defaultModel: string;
  extraEnv: Record<string, string>;
  buildArgs(o: { prompt: string; model?: string; cwd?: string }): string[];
  /** Assistant text carried by one parsed NDJSON event, if any. */
  textOf(evt: Record<string, unknown>): string | undefined;
  /** True when the event closes one agent step. */
  isStepEnd(evt: Record<string, unknown>): boolean;
}

const home = (...p: string[]) => path.join(os.homedir(), ...p);

export const BRAINS: Record<BrainId, BrainProfile> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    basenames: ['opencode', 'opencode.exe'],
    candidates: [
      home('.opencode', 'bin', 'opencode'),
      home('.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/opt/homebrew/bin/opencode',
      '/usr/bin/opencode',
    ],
    pathEnv: 'AGENTOS_OPENCODE_PATH',
    pathSetting: 'opencode_path',
    modelSetting: 'model',
    defaultModel: 'opencode/big-pickle',
    extraEnv: { OPENCODE_NON_INTERACTIVE: '1' },
    buildArgs({ prompt, model, cwd }) {
      const args = ['run', '--format', 'json'];
      if (model) args.push('--model', model);
      if (cwd) args.push('--dir', cwd);
      // Prompt as a trailing positional; spawn runs with shell:false so it is
      // never string-interpreted.
      args.push(prompt);
      return args;
    },
    textOf(evt) {
      if (evt.type !== 'text') return undefined;
      const part = evt.part as { text?: unknown } | undefined;
      const text = part?.text ?? evt.text;
      return typeof text === 'string' ? text : undefined;
    },
    isStepEnd: evt => evt.type === 'step_finish',
  },

  antigravity: {
    id: 'antigravity',
    label: 'Antigravity (Gemini CLI)',
    basenames: ['gemini', 'gemini.exe'],
    candidates: [
      home('.local', 'bin', 'gemini'),
      '/opt/homebrew/bin/gemini',
      '/usr/local/bin/gemini',
      '/usr/bin/gemini',
    ],
    pathEnv: 'AGENTOS_ANTIGRAVITY_PATH',
    pathSetting: 'antigravity_path',
    modelSetting: 'antigravity_model',
    defaultModel: '',
    extraEnv: {},
    buildArgs({ prompt, model }) {
      // cwd is applied via spawn's own `cwd`, so there is no --dir equivalent.
      // `--approval-mode default` keeps tool calls that need a human from
      // running unattended, matching the OpenCode non-interactive boundary.
      // Never --yolo here: that would delete the gate docs/SECURITY.md assumes.
      const args = ['-p', prompt, '-o', 'stream-json', '--approval-mode', 'default'];
      if (model) args.push('-m', model);
      // ponytail: blanket --skip-trust, because headless Gemini refuses any
      // directory the user has not trusted interactively and AgentOS picks the
      // cwd itself. Make it a per-path setting if untrusted repos get queued.
      args.push('--skip-trust');
      return args;
    },
    textOf(evt) {
      if (evt.type !== 'message' || evt.role !== 'assistant') return undefined;
      return typeof evt.content === 'string' ? evt.content : undefined;
    },
    isStepEnd: evt => evt.type === 'result',
  },
};

export function asBrainId(v: string | undefined): BrainId {
  return v === 'antigravity' ? 'antigravity' : 'opencode';
}

/** First candidate that exists and is executable, else the bare name for PATH. */
export function detectBrain(brain: BrainProfile): string {
  const fromEnv = process.env[brain.pathEnv];
  if (fromEnv) return fromEnv;
  for (const c of brain.candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {}
  }
  return brain.id === 'opencode' ? 'opencode' : 'gemini';
}
