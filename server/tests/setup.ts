import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, afterAll } from 'vitest';

// IMPORTANT: this MUST run at module load time and BEFORE config.ts is
// imported anywhere, so each test file gets its own isolated data directory.
// We therefore must not statically import anything that transitively imports
// `config` (e.g. helpers -> db -> config), because ES module imports are
// hoisted above this statement. helpers is loaded lazily instead.
// NOTE: vitest does not expose a per-file env var, so we derive a unique dir
// per setup import (each file imports setup.ts in its own isolated context).
process.env.AGENTOS_DATA_DIR = path.join(os.tmpdir(), 'agentos-test', `${process.pid}-${randomUUID()}`);
process.env.AGENTOS_RUNTIME_MODE = 'development';
process.env.AGENTOS_BOOTSTRAP_USERNAME = 'admin';
process.env.AGENTOS_BOOTSTRAP_PASSWORD = 'admin123';
process.env.AGENTOS_PUBLIC_ORIGIN = 'http://lan-agentos.example:3000';

async function resetDb(): Promise<void> {
  const { resetDbForTest } = await import('./helpers.js');
  resetDbForTest();
}

afterEach(resetDb);
afterAll(resetDb);