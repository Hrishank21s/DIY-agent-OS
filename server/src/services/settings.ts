import { getDb } from '../db/index.js';
import { BRAINS, asBrainId, type BrainId } from '../executors/brains.js';

const SECURE_KEYS = new Set(['password_hash']);

export class SettingsService {
  get(key: string): string | undefined {
    const db = getDb();
    const row = db.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  getNumber(key: string, fallback: number): number {
    const v = this.get(key);
    if (!v) return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  getBool(key: string, fallback = false): boolean {
    const v = this.get(key);
    if (!v) return fallback;
    return v === '1' || v === 'true';
  }

  set(key: string, value: string): void {
    const db = getDb();
    db.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(key, value);
  }

  getAll(): Record<string, string> {
    const db = getDb();
    const rows = db.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (SECURE_KEYS.has(r.key)) continue;
      out[r.key] = r.value;
    }
    return out;
  }

  /** Which CLI the worker spawns as its brain. */
  get brain(): BrainId {
    return asBrainId(this.get('brain'));
  }

  get configuredModel(): string {
    const brain = BRAINS[this.brain];
    return this.get(brain.modelSetting) || brain.defaultModel;
  }

  /** Configured executable path for a brain (blank falls back to detection). */
  brainPath(id: BrainId): string {
    return this.get(BRAINS[id].pathSetting) || '';
  }

  get opencodePath(): string {
    return this.brainPath('opencode');
  }

  get workingDir(): string {
    return this.get('working_dir') || '';
  }
}
