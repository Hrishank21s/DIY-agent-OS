import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { TaskService } from './tasks.js';
import { MemoryService } from './memory.js';
import { NoteService } from './notes.js';
import { ProjectService } from './projects.js';
import { emitChatEvent } from './realtime.js';

export type MessageRole = 'user' | 'agent' | 'system' | 'tool';

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  meta?: string | null;
  task_id?: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  user_id: string;
  project_id?: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export type RequestClass =
  | 'conversational'
  | 'task'
  | 'memory'
  | 'automation'
  | 'note'
  | 'project'
  | 'approval';

export interface ClassifiedRequest {
  kind: RequestClass;
  agentName?: string;
  reason: string;
  extracted?: string;
  title?: string;
}

export class ChatService {
  private tasks: TaskService;
  private memory: MemoryService;
  private notes: NoteService;
  private projects: ProjectService;

  constructor() {
    this.tasks = new TaskService();
    this.memory = new MemoryService();
    this.notes = new NoteService();
    this.projects = new ProjectService();
  }

  createConversation(userId: string, title = 'New conversation', projectId?: string): Conversation {
    const db = getDb();
    const id = nanoid();
    db.db
      .prepare(
        'INSERT INTO conversations (id, title, user_id, project_id) VALUES (?, ?, ?, ?)',
      )
      .run(id, title, userId, projectId || null);
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | null {
    const db = getDb();
    return (db.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as Conversation) || null;
  }

  listConversations(userId: string, opts?: { includeArchived?: boolean; search?: string }): Conversation[] {
    const db = getDb();
    let sql = 'SELECT * FROM conversations WHERE user_id = ?';
    const params: (string | number)[] = [userId];
    if (!opts?.includeArchived) {
      sql += ' AND archived = 0';
    }
    if (opts?.search) {
      sql += ' AND title LIKE ?';
      params.push(`%${opts.search}%`);
    }
    sql += ' ORDER BY updated_at DESC';
    return db.db.prepare(sql).all(...params) as unknown as Conversation[];
  }

  renameConversation(id: string, title: string): void {
    const db = getDb();
    db.db
      .prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
      .run(title, id);
  }

  archiveConversation(id: string, archived = true): void {
    const db = getDb();
    db.db
      .prepare('UPDATE conversations SET archived = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(archived ? 1 : 0, id);
  }

  deleteConversation(id: string): void {
    const db = getDb();
    db.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  addMessage(convId: string, role: MessageRole, content: string, meta?: Record<string, unknown>, taskId?: string): Message {
    const db = getDb();
    const id = nanoid();
    db.db
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, meta, task_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, convId, role, content, meta ? JSON.stringify(meta) : null, taskId || null);
    db.db
      .prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
      .run(convId);
    return this.getMessage(id)!;
  }

  getMessage(id: string): Message | null {
    const db = getDb();
    const row = db.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      meta: row.meta ? JSON.parse(row.meta as string) : null,
    } as unknown as Message;
  }

  /**
   * Replace the "⏳ Task queued" placeholder with the final response once the
   * worker finishes, so the chat thread shows the actual model output.
   * Falls back to the first agent message bound to the task.
   */
  updateTaskReply(
    taskId: string,
    content: string,
    status: string,
    error?: string | null,
  ): Message | null {
    const db = getDb();
    const row = (db.db
      .prepare(
        "SELECT * FROM messages WHERE task_id = ? AND role = 'agent' AND content LIKE '⏳%' ORDER BY created_at ASC LIMIT 1",
      )
      .get(taskId) ||
      db.db
        .prepare("SELECT * FROM messages WHERE task_id = ? AND role = 'agent' ORDER BY created_at ASC LIMIT 1")
        .get(taskId)) as Record<string, unknown> | undefined;
    if (!row) return null;
    const payload = error ? `Task failed: ${error}` : content;
    const messageId = row.id as string;
    db.db
      .prepare('UPDATE messages SET content = ?, meta = ? WHERE id = ?')
      .run(payload, JSON.stringify({ taskId, status, ...(error ? { error } : {}) }), messageId);
    const updated = this.getMessage(messageId);
    if (updated) {
      emitChatEvent(updated.conversation_id as string, { type: 'chat:event', status, message: updated });
    }
    return updated;
  }

  getMessages(convId: string, limit = 200): Message[] {
    const db = getDb();
    const rows = db.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(convId, limit) as Record<string, unknown>[];
    return rows.map(r => ({
      ...r,
      meta: r.meta ? JSON.parse(r.meta as string) : null,
    })) as unknown as Message[];
  }

  searchConversations(userId: string, query: string): Conversation[] {
    const db = getDb();
    const rows = db.db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = ? AND (m.content LIKE ? OR c.title LIKE ?)
         ORDER BY c.updated_at DESC LIMIT 20`,
      )
      .all(userId, `%${query}%`, `%${query}%`) as unknown as Conversation[];
    return rows;
  }

  /**
   * Classify a user message into one of the request kinds.
   * Deterministic rules; extensible point for LLM classification later.
   */
  classify(text: string): ClassifiedRequest {
    const lower = text.toLowerCase();
    if (lower.startsWith('remember') || lower.startsWith('remember this') || /\bremember that\b/.test(lower)) {
      return { kind: 'memory', reason: 'User asked to remember something', extracted: extractInstruction(text) };
    }
    if (/\bevery (morning|day|hour|week|night)\b/.test(lower) || /\brun this (every|daily|weekly)\b/.test(lower) || lower.includes('schedule') || lower.includes('automation') || /\bwhen\b.*\bthen\b/.test(lower)) {
      return { kind: 'automation', reason: 'User asked to schedule something', title: text.slice(0, 60) };
    }
    if (lower.startsWith('create a note') || lower.startsWith('note that') || lower.startsWith('add a note')) {
      return { kind: 'note', reason: 'User asked to create a note', extracted: extractInstruction(text) };
    }
    if (lower.startsWith('create a project') || lower.startsWith('new project')) {
      return { kind: 'project', reason: 'User asked to create a project', extracted: extractInstruction(text) };
    }
    if (
      /^[a-z0-9-._ ]{3,}$/i.test(text) &&
      (lower.startsWith('run') || lower.startsWith('fix') || lower.startsWith('research') ||
        lower.startsWith('check') || lower.startsWith('create a script') || lower.startsWith('build') ||
        lower.startsWith('deploy') || lower.startsWith('install') || lower.startsWith('test'))
    ) {
      return { kind: 'task', reason: 'User asked to execute something', title: text.slice(0, 60) };
    }
    return { kind: 'conversational', reason: 'General conversation' };
  }

  /**
   * Save a memory from a chat message if the request asked to remember something,
   * or if it contains explicit memory-worthy content ("we are building X").
   */
  maybeExtractMemory(userId: string, content: string, convId: string, projectId?: string): void {
    const lower = content.toLowerCase();
    const isExplicit = lower.startsWith('remember') || /remember that/i.test(content);
    if (isExplicit) {
      const body = extractInstruction(content);
      if (body.length > 10) {
        this.memory.create({
          content: body,
          type: this.memory.extractType(body) || 'IMPORTANT_CONTEXT',
          importance: 0.7,
          source_conversation_id: convId,
          project_id: projectId || null,
        });
        emitChatEvent(convId, { type: 'memory', saved: true });
        return;
      }
    }
    // Implicit: "we are building <X> ..." factual statements
    const type = this.memory.extractType(content);
    if (type && type === 'PROJECT_FACT' && content.length > 15 && content.length < 500) {
      this.memory.create({
        content,
        type,
        importance: 0.5,
        source_conversation_id: convId,
        project_id: projectId || null,
      });
      emitChatEvent(convId, { type: 'memory', saved: true, memoryType: type });
    }
  }

  get context(): { tasks: TaskService; memory: MemoryService; notes: NoteService; projects: ProjectService } {
    return { tasks: this.tasks, memory: this.memory, notes: this.notes, projects: this.projects };
  }
}

function extractInstruction(text: string): string {
  return text
    .replace(/^remember( that)?/i, '')
    .replace(/^note that/i, '')
    .replace(/^(create|add) a note/i, '')
    .replace(/^(create|start) (a )?project/i, '')
    .trim();
}