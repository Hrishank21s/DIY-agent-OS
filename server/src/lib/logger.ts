import { nanoid } from 'nanoid';

export type LogCategory =
  | 'app'
  | 'agent'
  | 'task'
  | 'command'
  | 'auth'
  | 'approval'
  | 'automation'
  | 'system'
  | 'memory'
  | 'note'
  | 'project'
  | 'settings';

const COLORS: Record<string, string> = {
  INFO: '\x1b[36m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  DEBUG: '\x1b[90m',
  RESET: '\x1b[0m',
};

interface LogEntry {
  id: string;
  ts: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  category: LogCategory;
  message: string;
  meta?: Record<string, unknown>;
}

function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj
      .replace(/(password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[:=]\s*["']?[^\s"',;]+/gi, '$1=***')
      .replace(/(sk-[A-Za-z0-9]{8,})/g, 'sk-***');
  }
  if (Array.isArray(obj)) return obj.map(redact);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (/password|passwd|secret|token|api[_-]?key|authorization/i.test(k)) {
        out[k] = '***';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return obj;
}

export class Logger {
  private inMemory: LogEntry[] = [];
  private maxInMemory = 5000;

  constructor(private persist?: (entry: LogEntry) => void) {}

  log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      id: nanoid(),
      ts: new Date().toISOString(),
      level,
      category,
      message,
      meta,
    };
    const safe = redact(meta);
    const color = COLORS[level] || '';
    console[level === 'ERROR' ? 'error' : 'log'](
      `${color}[${entry.ts}][${level}][${category}]${COLORS.RESET} ${message}`,
      safe ? `\n${JSON.stringify(safe)}` : '',
    );
    this.inMemory.push(entry);
    if (this.inMemory.length > this.maxInMemory) {
      this.inMemory = this.inMemory.slice(-this.maxInMemory);
    }
    if (this.persist) {
      try {
        this.persist({
          ...entry,
          meta: meta ? (redact(meta) as Record<string, unknown>) : undefined,
        });
      } catch {
        // Logging persistence failure should never crash the system
      }
    }
  }

  info(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('INFO', category, message, meta);
  }
  warn(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('WARN', category, message, meta);
  }
  error(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('ERROR', category, message, meta);
  }
  debug(category: LogCategory, message: string, meta?: Record<string, unknown>): void {
    this.log('DEBUG', category, message, meta);
  }

  getRecent(limit = 500): LogEntry[] {
    return this.inMemory.slice(-limit);
  }
}

let instance: Logger | null = null;

export function initLogger(persist?: (e: LogEntry) => void): Logger {
  instance = new Logger(persist);
  return instance;
}

export function getLogger(): Logger {
  if (!instance) instance = new Logger();
  return instance;
}

export type { LogEntry };
