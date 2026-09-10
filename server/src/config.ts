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

// Basenames the worker is willing to exec as the OpenCode brain. This stops a
// misconfigured AGENTOS_OPENCODE_PATH or opencode_path setting from pointing the
// worker at an unrelated binary (e.g. /usr/bin/rm) that is then executed with
// task prompts.
const OPENCODE_BASENAMES = new Set(['opencode', 'opencode.exe']);

/**
 * True when p may be used as the OpenCode executable. Bare names without a
 * directory separator defer resolution to PATH and are allowed only if their
 * basename is in the allowlist. Named paths must exist, be regular files, and
 * be executable.
 */
export function isAllowedOpenCodePath(p: string): boolean {
  if (!OPENCODE_BASENAMES.has(path.basename(p))) return false;
  if (!/[/\\]/.test(p)) return true;
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type RuntimeMode = 'development' | 'production';

function parseRuntimeMode(value: string | undefined): RuntimeMode {
  const mode = (value || process.env.NODE_ENV || 'production').toLowerCase();
  return mode === 'development' || mode === 'test' ? 'development' : 'production';
}

function parseTrustProxy(): boolean {
  const v = process.env.AGENTOS_TRUST_PROXY;
  return v === 'true' || v === '1';
}

function parseTrustedOrigins(): string[] {
  const raw = [
    process.env.AGENTOS_PUBLIC_ORIGIN,
    ...(process.env.AGENTOS_TRUSTED_ORIGINS || '').split(','),
  ];
  const out = new Set<string>();
  for (const item of raw) {
    if (item && item.trim()) {
      try {
        out.add(new URL(item.trim()).origin);
      } catch {}
    }
  }
  return [...out];
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** True when {@link host} is a loopback hostname. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.replace(/^\[|\]$/g, ''));
}

/**
 * CSRF defense-in-depth for state-changing browser requests. Only loopback
 * origins and explicitly configured origins are allowed; the request Host
 * header is deliberately never used as an implicit trusted origin.
 */
export function isAllowedOrigin(origin: string, trustedOrigins: string[]): boolean {
  let hostname: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (isLoopbackHost(hostname)) return true;
  return trustedOrigins.includes(origin.replace(/\/+$/, ''));
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
  approvalTimeoutMs: number;
  environment: string;
  runtimeMode: RuntimeMode;
  trustProxy: boolean;
  cookieSecure: boolean;
  trustedOrigins: string[];
  rootDir: string;
}

const runtimeMode = parseRuntimeMode(process.env.AGENTOS_RUNTIME_MODE);

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
  approvalTimeoutMs: parseInt(process.env.AGENTOS_APPROVAL_TIMEOUT_MS || '86400000', 10),
  environment: process.env.NODE_ENV || 'development',
  runtimeMode,
  trustProxy: parseTrustProxy(),
  cookieSecure: runtimeMode === 'production',
  trustedOrigins: parseTrustedOrigins(),
  rootDir,
};
