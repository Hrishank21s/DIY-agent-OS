import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

/** Expand a leading `~` (dotenv does not) into the user's home directory. */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveDataDir(): string {
  const dir = expandHome(process.env.AGENTOS_DATA_DIR || path.join(os.homedir(), '.agentos'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const dataDir = resolveDataDir();
// Decode URL percent-encoding: `new URL(...).pathname` keeps `%20` intact and
// breaks paths containing spaces. db/index.ts already uses this pattern.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

/**
 * How many reverse-proxy hops to trust for the client IP. `false` disables
 * X-Forwarded-* handling entirely (the default and safest). A bare `true`
 * means "trust the single nearest hop" — never an unbounded chain, so a
 * client-supplied X-Forwarded-For cannot be rotated to defeat rate limits.
 */
export type TrustProxy = boolean | number;

function parseTrustProxy(): TrustProxy {
  const v = process.env.AGENTOS_TRUST_PROXY;
  if (v === undefined || v === '' || v === 'false' || v === '0') return false;
  const n = parseInt(v, 10);
  if (!Number.isNaN(n)) return Math.max(1, n);
  return v === 'true' || v === '1' ? 1 : false;
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
  trustProxy: TrustProxy;
  cookieSecure: boolean;
  trustedOrigins: string[];
  rootDir: string;
}

const runtimeMode = parseRuntimeMode(process.env.AGENTOS_RUNTIME_MODE);

/** Parse an int env var with a fallback and sane clamps (NaN / negatives rejected). */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const config: AppConfig = {
  port: intEnv('AGENTOS_PORT', 3000, 1, 65535),
  // Loopback by default; bind 0.0.0.0 only when the user opts into LAN access.
  host: process.env.AGENTOS_HOST || '127.0.0.1',
  dataDir,
  dbPath: path.join(dataDir, 'agentos.db'),
  opencodePath: detectOpenCode(),
  defaultModel: process.env.AGENTOS_DEFAULT_MODEL || 'opencode/big-pickle',
  defaultWorkingDir: expandHome(
    process.env.AGENTOS_WORKDIR || path.join(os.homedir(), 'Projects'),
  ),
  sessionDurationMinutes: intEnv('AGENTOS_SESSION_MINUTES', 480, 1, 10080),
  workerConcurrency: intEnv('AGENTOS_CONCURRENCY', 2, 1, 16),
  taskTimeoutMs: intEnv('AGENTOS_TASK_TIMEOUT_MS', 600000, 5000, 86400000),
  approvalTimeoutMs: intEnv('AGENTOS_APPROVAL_TIMEOUT_MS', 86400000, 60000, 30 * 86400000),
  environment: process.env.NODE_ENV || 'development',
  runtimeMode,
  trustProxy: parseTrustProxy(),
  cookieSecure: runtimeMode === 'production',
  trustedOrigins: parseTrustedOrigins(),
  rootDir,
};
