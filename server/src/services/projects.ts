import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { MemoryService } from './memory.js';
import { NoteService } from './notes.js';

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  root_dir?: string | null;
  instructions?: string | null;
  created_at: string;
  updated_at: string;
}

export class ProjectService {
  create(input: Partial<Project> & { name: string }): Project {
    const db = getDb();
    const id = nanoid();
    db.db
      .prepare(
        'INSERT INTO projects (id, name, description, root_dir, instructions) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.name, input.description || null, input.root_dir || null, input.instructions || null);
    return this.get(id)!;
  }

  get(id: string): Project | null {
    const db = getDb();
    return (db.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Project) || null;
  }

  getByName(name: string): Project | null {
    const db = getDb();
    return (db.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as unknown as Project) || null;
  }

  list(): Project[] {
    const db = getDb();
    return db.db.prepare('SELECT * FROM projects ORDER BY name').all() as unknown as Project[];
  }

  update(id: string, input: Partial<Project>): Project | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    const fields = ['name', 'description', 'root_dir', 'instructions'] as const;
    const sets: string[] = [];
    const params: (string | null)[] = [];
    for (const f of fields) {
      if (input[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(input[f] ?? null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      params.push(id);
      db.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.get(id);
  }

  delete(id: string): void {
    const db = getDb();
    db.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  context(projectId: string): Record<string, unknown> {
    const mem = new MemoryService();
    const notes = new NoteService();
    const project = this.get(projectId);
    return {
      project,
      memories: project ? mem.list({ projectId, limit: 10 }) : [],
      notes: project ? notes.list({ project_id: projectId, limit: 10 }) : [],
    };
  }
}