import { getDb } from '../db/index.js';
import { getLogger } from '../lib/logger.js';
import { ChatService } from '../services/chat.js';
import { TaskService } from '../services/tasks.js';
import { SettingsService } from '../services/settings.js';
import { ApprovalService } from '../services/approvals.js';
import { MemoryService } from '../services/memory.js';
import { AgentService } from '../services/agents.js';
import { AutomationService } from '../services/automations.js';
import { hub } from '../services/realtime.js';
import { respondToApproval } from '../routes/approvals.js';
import { updateGeneralSchema, updateOpencodeSchema } from '../routes/settings.js';
import type { TaskQueue } from '../workers/task-queue.js';
import { config } from '../config.js';

const log = getLogger();
const MAX_MSG = 4000; // Telegram caps a message at 4096 chars
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const settableSchema = updateGeneralSchema.merge(updateOpencodeSchema).strict();
const SETTABLE_KEYS = Object.keys(settableSchema.shape);

const HELP = `AgentOS on Telegram

Just type to chat with your agent. "remember ...", "note that ...", "create a project ..." work like in the dashboard.

/new – start a fresh conversation
/status – system status
/tasks – recent tasks
/cancel <id> · /retry <id>
/approvals – pending approvals (tap to approve/reject)
/settings – show settings
/set <key> <value> – change a setting
/agents – list agents
/agent <name> on|off – enable/disable an agent
/memory [query] – list or search memories
/automations – list automations
/automate <schedule> | <prompt> – schedule: seconds (3600), cron ("0 9 * * *"), daily:08:00, hourly
/autotoggle <id> – enable/disable an automation
/autodelete <id> – delete an automation

Settable keys: ${SETTABLE_KEYS.join(', ')}`;

interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

/**
 * Telegram front-end for AgentOS: chat with the agent and manage it from a
 * phone. Long-polls getUpdates, so no public URL or webhook is needed. Only
 * chats listed in AGENTOS_TELEGRAM_CHAT_IDS are served; everyone else is told
 * their chat id and ignored.
 */
export class TelegramBot {
  /** Chats that messaged the bot but aren't allowed yet; Settings offers to allow them. */
  readonly strangers = new Map<string, number>();
  private offset = 0;
  private abort = new AbortController();
  // ponytail: in-memory, so a reply in flight across a server restart is lost (still visible in the dashboard)
  private pending = new Map<string, number>();
  private unsubscribe?: () => void;
  private chat = new ChatService();
  private tasks = new TaskService();
  private settings = new SettingsService();
  private approvals = new ApprovalService();
  private memory = new MemoryService();
  private agents = new AgentService();
  private automations = new AutomationService();

  constructor(
    private token: string,
    private allowedChatIds: Set<string>,
    private queue?: TaskQueue,
  ) {}

  start(): void {
    this.unsubscribe = hub.subscribe(evt => {
      if (evt.type !== 'task:status' || !TERMINAL.has(String(evt.status))) return;
      const taskId = String(evt.taskId);
      const chatId = this.pending.get(taskId);
      if (chatId === undefined) return;
      this.pending.delete(taskId);
      const t = this.tasks.get(taskId);
      const text = t?.status === 'completed'
        ? t.result || '(empty reply)'
        : `Task ${t?.status ?? evt.status}${t?.error ? `: ${t.error}` : ''}`;
      void this.send(chatId, text);
    });
    void this.poll();
    log.info('system', 'Telegram bot started');
  }

  stop(): void {
    this.abort.abort();
    this.unsubscribe?.();
  }

  private async poll(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const updates = (await this.api('getUpdates', { offset: this.offset, timeout: 30 })) as TgUpdate[];
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u).catch(err =>
            log.warn('system', 'Telegram update failed', { error: (err as Error).message }),
          );
        }
      } catch (err) {
        if (this.abort.signal.aborted) return;
        log.warn('system', 'Telegram poll failed', { error: (err as Error).message });
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  async api(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abort.signal,
    });
    const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!json.ok) throw new Error(`${method}: ${json.description}`);
    return json.result;
  }

  async send(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
    for (let i = 0; i < text.length || i === 0; i += MAX_MSG) {
      await this.api('sendMessage', { chat_id: chatId, text: text.slice(i, i + MAX_MSG), ...extra });
    }
  }

  async handleUpdate(u: TgUpdate): Promise<void> {
    const cq = u.callback_query;
    if (cq) {
      const chatId = cq.message?.chat.id;
      await this.api('answerCallbackQuery', { callback_query_id: cq.id });
      if (chatId === undefined || !this.allowedChatIds.has(String(chatId))) return;
      const [kind, id, yes] = (cq.data || '').split(':');
      if (kind === 'ap') await this.send(chatId, this.respond(id, yes === '1'));
      return;
    }
    const msg = u.message;
    if (!msg?.text) return;
    const chatId = msg.chat.id;
    if (!this.allowedChatIds.has(String(chatId))) {
      this.strangers.set(String(chatId), Date.now());
      await this.send(chatId, `Not authorized yet. Open AgentOS → Settings → Telegram and allow this chat (id ${chatId}).`);
      return;
    }
    const text = msg.text.trim();
    if (!text.startsWith('/')) return this.chatMessage(chatId, text);

    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.slice(1).split('@')[0].toLowerCase();
    const arg = text.slice(rawCmd.length).trim();
    await this.send(chatId, await this.command(chatId, cmd, rest, arg));
  }

  private async chatMessage(chatId: number, text: string): Promise<void> {
    const convId = this.conversation(chatId);
    const r = this.chat.send(convId, this.userId(), text);
    if (r.taskId) {
      this.pending.set(r.taskId, chatId);
      await this.api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      return;
    }
    await this.send(chatId, r.classification.kind === 'automation'
      ? 'Use /automate <schedule> | <prompt> to schedule this.'
      : r.reply || 'Done.');
  }

  private async command(chatId: number, cmd: string, args: string[], arg: string): Promise<string> {
    switch (cmd) {
      case 'start':
      case 'help':
        return HELP;
      case 'new':
        this.settings.set(`telegram_conversation_${chatId}`, this.chat.createConversation(this.userId(), 'Telegram').id);
        return 'Started a new conversation.';
      case 'status': {
        const c = this.tasks.countByStatus();
        return [
          `Brain: ${this.settings.brain} (${this.settings.configuredModel})`,
          `Running: ${c.running || 0} · Queued: ${c.queued || 0} · Waiting approval: ${c.waiting_for_approval || 0}`,
          `Pending approvals: ${this.approvals.countPending()}`,
          `Memories: ${this.memory.count()}`,
        ].join('\n');
      }
      case 'tasks': {
        const list = this.tasks.list({ limit: 10 });
        return list.length ? list.map(t => `${t.id} [${t.status}] ${t.title}`).join('\n') : 'No tasks.';
      }
      case 'cancel':
      case 'retry': {
        if (!this.tasks.get(args[0] || '')) return 'Task not found.';
        if (!this.queue) return 'Queue not running.';
        if (cmd === 'cancel') this.queue.cancel(args[0]);
        else this.queue.retry(args[0]);
        return `Task ${args[0]}: ${this.tasks.get(args[0])?.status}`;
      }
      case 'approvals': {
        const list = this.approvals.listPending();
        if (!list.length) return 'No pending approvals.';
        for (const a of list) {
          await this.send(chatId, `[${a.risk_level}] ${a.description}`, {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `ap:${a.id}:1` },
                { text: '❌ Reject', callback_data: `ap:${a.id}:0` },
              ]],
            },
          });
        }
        return `${list.length} pending.`;
      }
      case 'settings': {
        const all = this.settings.getAll();
        return SETTABLE_KEYS.map(k => `${k} = ${all[k] ?? '(default)'}`).join('\n');
      }
      case 'set': {
        const [key] = args;
        const value = arg.slice((key || '').length).trim();
        if (!key || !value) return `Usage: /set <key> <value>\nKeys: ${SETTABLE_KEYS.join(', ')}`;
        const asNum = Number(value);
        const parsed = [value, asNum].map(v => settableSchema.safeParse({ [key]: v })).find(p => p.success);
        if (!parsed?.success) return `Invalid. Keys: ${SETTABLE_KEYS.join(', ')}`;
        this.settings.set(key, value);
        log.info('settings', 'Setting updated via Telegram', { key });
        return `${key} = ${value}`;
      }
      case 'agents':
        return this.agents.list().map(a => `${a.enabled ? '🟢' : '⚪'} ${a.name}${a.model ? ` (${a.model})` : ''}`).join('\n') || 'No agents.';
      case 'agent': {
        const state = args.at(-1)?.toLowerCase();
        const agent = this.agents.getByName(args.slice(0, -1).join(' '));
        if (!agent || !['on', 'off'].includes(state || '')) return 'Usage: /agent <name> on|off';
        this.agents.update(agent.id, { enabled: state === 'on' ? 1 : 0 });
        return `${agent.name} ${state === 'on' ? 'enabled' : 'disabled'}.`;
      }
      case 'memory': {
        const list = arg ? this.memory.retrieveQuery(arg, { limit: 10 }) : this.memory.list({ limit: 10 });
        return list.map(m => `[${m.type}] ${m.content}`).join('\n') || 'No memories.';
      }
      case 'automations': {
        const list = this.automations.list();
        return list.map(a => `${a.id} ${a.enabled ? '🟢' : '⚪'} ${a.name} — ${a.schedule_type} ${a.schedule_value} (next ${a.next_run_at ?? '-'})`).join('\n') || 'No automations.';
      }
      case 'automate': {
        const [schedule = '', prompt = ''] = arg.split('|').map(s => s.trim());
        if (!schedule || !prompt) return 'Usage: /automate <schedule> | <prompt>';
        const type = /^\d+$/.test(schedule) ? 'interval'
          : /^(daily|weekly|hourly)/.test(schedule) ? 'recurring'
          : schedule.split(/\s+/).length >= 5 ? 'cron' : 'one_time';
        if (!this.automations.computeNext(type, schedule)) return `Could not parse schedule "${schedule}".`;
        const a = this.automations.create({ name: prompt.slice(0, 60), prompt, schedule_type: type, schedule_value: schedule });
        return `Automation ${a.id} created (${type}), next run ${a.next_run_at}.`;
      }
      case 'autotoggle': {
        const a = this.automations.get(args[0] || '');
        if (!a) return 'Automation not found.';
        this.automations.update(a.id, { enabled: a.enabled ? 0 : 1 });
        return `${a.name} ${a.enabled ? 'disabled' : 'enabled'}.`;
      }
      case 'autodelete': {
        if (!this.automations.get(args[0] || '')) return 'Automation not found.';
        this.automations.delete(args[0]);
        return 'Deleted.';
      }
      default:
        return 'Unknown command. /help';
    }
  }

  private respond(approvalId: string, approve: boolean): string {
    const a = respondToApproval(approvalId, approve, this.userId(), 'via Telegram');
    return a ? `Approval ${a.status}: ${a.description}` : 'Approval not found.';
  }

  /** Single-user platform: Telegram acts as the bootstrap (first) user. */
  private userId(): string {
    const row = getDb().db.prepare('SELECT id FROM users ORDER BY rowid LIMIT 1').get() as { id: string };
    return row.id;
  }

  private conversation(chatId: number): string {
    const key = `telegram_conversation_${chatId}`;
    const existing = this.settings.get(key);
    if (existing && this.chat.getConversation(existing)) return existing;
    const id = this.chat.createConversation(this.userId(), 'Telegram').id;
    this.settings.set(key, id);
    return id;
  }
}


/**
 * Owns the single running bot so Settings can (re)start it without a server
 * restart. Config comes from the Settings tab, falling back to the env vars.
 */
export const telegramRuntime = {
  queue: undefined as TaskQueue | undefined,
  bot: null as TelegramBot | null,

  token(): string {
    return new SettingsService().get('telegram_bot_token') || config.telegramBotToken;
  },

  chatIds(): string[] {
    const saved = new SettingsService().get('telegram_chat_ids');
    return saved !== undefined
      ? saved.split(',').map(s => s.trim()).filter(Boolean)
      : [...config.telegramChatIds];
  },

  /** (Re)start the bot from current settings; no token means no bot. */
  reload(): void {
    this.bot?.stop();
    this.bot = null;
    const token = this.token();
    if (!token) return;
    this.bot = new TelegramBot(token, new Set(this.chatIds()), this.queue);
    this.bot.start();
  },
};
