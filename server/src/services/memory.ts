import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

export type MemoryType =
  | 'USER_PREFERENCE'
  | 'PROJECT_FACT'
  | 'PROJECT_DECISION'
  | 'TECHNICAL_DECISION'
  | 'WORKFLOW'
  | 'IMPORTANT_CONTEXT'
  | 'REFERENCE'
  | 'GOAL';

export interface Memory {
  id: string;
  content: string;
  type: MemoryType;
  importance: number;
  source_conversation_id?: string | null;
  source_task_id?: string | null;
  project_id?: string | null;
  tags?: string | null;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
}

export interface RetrievalOptions {
  query?: string;
  projectId?: string;
  type?: MemoryType;
  limit?: number;
  importanceMin?: number;
}

export class MemoryService {
  create(input: Partial<Memory> & { content: string; type: MemoryType }): Memory {
    const db = getDb();
    const id = nanoid();
    const importance = input.importance ?? 0.5;
    db.db
      .prepare(
        `INSERT INTO memories (id, content, type, importance, source_conversation_id, source_task_id, project_id, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.content,
        input.type,
        importance,
        input.source_conversation_id || null,
        input.source_task_id || null,
        input.project_id || null,
        input.tags || null,
      );
    this.indexFts(id, input.content, input.tags || '');
    return this.get(id)!;
  }

  private indexFts(id: string, content: string, tags: string): void {
    const db = getDb();
    try {
      db.db
        .prepare('INSERT INTO memories_fts_index (memory_id, content, tags) VALUES (?, ?, ?)')
        .run(id, content, tags);
    } catch {
      // FTS indexes are best-effort
    }
  }

  get(id: string): Memory | null {
    const db = getDb();
    const row = db.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return (row as unknown as Memory) || null;
  }

  update(id: string, input: Partial<Memory>): Memory | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    const fields = ['content', 'type', 'importance', 'project_id', 'tags'] as const;
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
      db.db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    const updated = this.get(id)!;
    db.db.prepare('DELETE FROM memories_fts_index WHERE memory_id = ?').run(id);
    this.indexFts(id, updated.content, updated.tags || '');
    return updated;
  }

  delete(id: string): void {
    const db = getDb();
    db.db.prepare('DELETE FROM memories_fts_index WHERE memory_id = ?').run(id);
    db.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  touch(id: string): void {
    const db = getDb();
    db.db.prepare("UPDATE memories SET last_used_at = datetime('now') WHERE id = ?").run(id);
  }

  list(opts?: RetrievalOptions): Memory[] {
    const db = getDb();
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: (string | number)[] = [];
    if (opts?.projectId) {
      sql += ' AND project_id = ?';
      params.push(opts.projectId);
    }
    if (opts?.type) {
      sql += ' AND type = ?';
      params.push(opts.type);
    }
    if (opts?.importanceMin !== undefined) {
      sql += ' AND importance >= ?';
      params.push(opts.importanceMin);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(opts?.limit || 100);
    return db.db.prepare(sql).all(...params) as unknown as Memory[];
  }

  /**
   * Relevance-based retrieval using FTS5 full-text search plus metadata
   * (project, type, importance). Abstraction allows swapping in vector search
   * later without changing callers.
   */
  retrieveQuery(query: string, opts?: RetrievalOptions): Memory[] {
    const db = getDb();
    const limit = opts?.limit || 8;
    const clean = query.trim();
    if (!clean) return [];
    try {
      const rows = db.db
        .prepare(
          `SELECT m.*, rank
           FROM memories_fts_index f
           JOIN memories m ON m.id = f.memory_id
           WHERE memories_fts_index MATCH ?
           ORDER BY bm25(memories_fts_index) LIMIT ?`,
        )
        .all(clean, limit) as unknown as (Memory & { rank: number })[];
      return rows
        .filter(r => {
          if (opts?.projectId && r.project_id && r.project_id !== opts.projectId) return false;
          if (opts?.importanceMin !== undefined && r.importance < opts.importanceMin) return false;
          return true;
        })
        .slice(0, limit);
    } catch {
      // If FTS query fails (e.g. syntax), fall back to LIKE search
      return this.fallbackLike(clean, opts);
    }
  }

  private fallbackLike(query: string, opts?: RetrievalOptions): Memory[] {
    const db = getDb();
    const words = query.split(/\s+/).filter(Boolean).slice(0, 5);
    if (!words.length) return [];
    let realSql = 'SELECT m.* FROM memories m WHERE ' + words.map(() => 'm.content LIKE ?').join(' OR ');
    const p: string[] = words.map(w => `%${w}%`);
    if (opts?.projectId) {
      realSql += ' AND (m.project_id = ? OR m.project_id IS NULL)';
      p.push(opts.projectId as string);
    }
    realSql += ' ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?';
    p.push(String(opts?.limit || 8));
    return db.db.prepare(realSql).all(...p) as unknown as Memory[];
  }

  count(): number {
    const db = getDb();
    return (db.db.prepare('SELECT COUNT(*) c FROM memories').get() as { c: number }).c;
  }

  /**
   * Simple heuristic memory extraction: look for declarative knowledge
   * in a completed conversation. Returns candidate memories.
   */
  extractType(content: string): MemoryType | null {
    const c = content.toLowerCase();
    if (c.includes('we are building') || c.includes("we're building") || c.includes('project is')) return 'PROJECT_FACT';
    if (c.includes('we decided') || c.includes('decision') || c.includes('we chose')) return 'PROJECT_DECISION';
    if (c.includes('always') || c.includes('prefer') || c.includes('i like') || c.includes('i prefer')) return 'USER_PREFERENCE';
    if (c.includes('the stack') || c.includes('use ') || c.includes('technology')) return 'TECHNICAL_DECISION';
    if (c.includes('remember') || c.includes('important')) return 'IMPORTANT_CONTEXT';
    if (c.includes('goal') || c.includes('objective') || c.includes('aim')) return 'GOAL';
    if (c.includes('reference') || c.includes('url') || c.includes('link')) return 'REFERENCE';
    return null;
  }
}
