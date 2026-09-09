import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

dotenv.config();

function resolveDataDir(): string {
  const dir = process.env.AGENTOS_DATA_DIR || path.join(os.homedir(), '.agentos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const dataDir = resolveDataDir();
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

function detectOpenCode(): string {
  if (process.env.AGENTOS_OPENCODE_PATH) return process.env.AGENTOS_OPENCODE_PATH;
  const candidates = [
    path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
    path.join(os.homedir(), '.local', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/opt/homebrew/bin/opencode',
    '/usr/bin/opencode',
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {}
  }
  return 'opencode';
}

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  opencodePath: string;
  defaultModel: string;
  defaultWorkingDir: string;
  sessionDurationMinutes: number;
  workerConcurrency: number;
  taskTimeoutMs: number;
  environment: string;
  rootDir: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.AGENTOS_PORT || '3000', 10),
  host: process.env.AGENTOS_HOST || '0.0.0.0',
  dataDir,
  dbPath: path.join(dataDir, 'agentos.db'),
  opencodePath: detectOpenCode(),
  defaultModel: process.env.AGENTOS_DEFAULT_MODEL || 'opencode/big-pickle',
  defaultWorkingDir:
    process.env.AGENTOS_WORKDIR || path.join(os.homedir(), 'Projects'),
  sessionDurationMinutes: parseInt(
    process.env.AGENTOS_SESSION_MINUTES || '480',
    10,
  ),
  workerConcurrency: parseInt(process.env.AGENTOS_CONCURRENCY || '2', 10),
  taskTimeoutMs: parseInt(process.env.AGENTOS_TASK_TIMEOUT_MS || '600000', 10),
  environment: process.env.NODE_ENV || 'development',
  rootDir,
};
