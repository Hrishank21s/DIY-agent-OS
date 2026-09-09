import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default function globalSetup(): void {
  const root = path.join(os.tmpdir(), 'agentos-test');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  process.env.AGENTOS_TEST_ROOT = root;
}
