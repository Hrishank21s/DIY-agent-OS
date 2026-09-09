import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { isWithinRoot } from './risk.js';

export class TrustedPathsService {
  list(): string[] {
    const db = getDb();
    const rows = db.db.prepare('SELECT path FROM trusted_paths').all() as { path: string }[];
    return rows.map(r => r.path);
  }

  add(path: string): void {
    const db = getDb();
    const p = path.replace(/\/+$/, '');
    db.db.prepare('INSERT OR IGNORE INTO trusted_paths (id, path) VALUES (?, ?)').run(nanoid(), p);
  }

  remove(path: string): void {
    const db = getDb();
    db.db.prepare('DELETE FROM trusted_paths WHERE path = ?').run(path);
  }

  setList(paths: string[]): void {
    const db = getDb();
    const tx = (fn: () => void) => {
      db.db.exec('BEGIN');
      try {
        fn();
        db.db.exec('COMMIT');
      } catch (e) {
        db.db.exec('ROLLBACK');
        throw e;
      }
    };
    tx(() => {
      db.db.prepare('DELETE FROM trusted_paths').run();
      const insert = db.db.prepare('INSERT INTO trusted_paths (id, path) VALUES (?, ?)');
      for (const p of paths) {
        if (p.trim()) insert.run(nanoid(), p.replace(/\/+$/, ''));
      }
    });
  }

  includes(absPath: string): boolean {
    return isWithinRoot(absPath, this.list());
  }
}