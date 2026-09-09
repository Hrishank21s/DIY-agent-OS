import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

export interface Note {
  id: string;
  title: string;
  content?: string | null;
  note_type: string;
  project_id?: string | null;
  pinned: number;
  archived: number;
  tags?: string | null;
  created_at: string;
  updated_at: string;
}

export class NoteService {
  create(input: Partial<Note> & { title: string }): Note {
    const db = getDb();
    const id = nanoid();
    db.db
      .prepare(
        `INSERT INTO notes (id, title, content, note_type, project_id, pinned, archived, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.content || null,
        input.note_type || 'personal',
        input.project_id || null,
        input.pinned || 0,
        input.archived || 0,
        input.tags || null,
      );
    return this.get(id)!;
  }

  get(id: string): Note | null {
    const db = getDb();
    return (db.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as unknown as Note) || null;
  }

  list(filter?: { project_id?: string; archived?: boolean; pinned?: boolean; search?: string; limit?: number }): Note[] {
    const db = getDb();
    let sql = 'SELECT * FROM notes WHERE 1=1';
    const params: (string | number)[] = [];
    if (filter?.project_id) {
      sql += ' AND project_id = ?';
      params.push(filter.project_id);
    }
    if (filter?.archived !== undefined) {
      sql += ' AND archived = ?';
      params.push(filter.archived ? 1 : 0);
    }
    if (filter?.pinned !== undefined) {
      sql += ' AND pinned = ?';
      params.push(filter.pinned ? 1 : 0);
    }
    if (filter?.search) {
      sql += ' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)';
      const q = `%${filter.search}%`;
      params.push(q, q, q);
    }
    sql += ' ORDER BY pinned DESC, updated_at DESC LIMIT ?';
    params.push(filter?.limit || 100);
    return db.db.prepare(sql).all(...params) as unknown as Note[];
  }

  update(id: string, input: Partial<Note>): Note | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    const fields = ['title', 'content', 'note_type', 'project_id', 'pinned', 'archived', 'tags'] as const;
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const f of fields) {
      if (input[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push((input[f] as string | number | null) ?? null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      params.push(id);
      db.db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.get(id);
  }

  delete(id: string): void {
    const db = getDb();
    db.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  }
}