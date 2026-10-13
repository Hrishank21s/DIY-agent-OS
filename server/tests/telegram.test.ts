import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';
import { TelegramBot } from '../src/integrations/telegram.js';
import { SettingsService } from '../src/services/settings.js';
import { TaskService } from '../src/services/tasks.js';
import { emitTaskStatus } from '../src/services/realtime.js';

/** Bot with the network replaced by a recorder. */
function makeBot() {
  const sent: { chat_id?: number; text?: string }[] = [];
  const bot = new TelegramBot('t', new Set(['42']));
  bot.api = async (method, body) => {
    if (method === 'sendMessage') sent.push(body as never);
    if (method === 'getUpdates') await new Promise(r => setTimeout(r, 20));
    return method === 'getUpdates' ? [] : true;
  };
  const say = (text: string, chatId = 42) =>
    bot.handleUpdate({ update_id: 1, message: { chat: { id: chatId }, text } });
  return { bot, sent, say };
}

describe('TelegramBot', () => {
  beforeAll(() => seed(getDb()));

  it('refuses chats that are not allowlisted', async () => {
    const { sent, say } = makeBot();
    await say('/set brain antigravity', 7);
    expect(sent[0].text).toMatch(/Not authorized.*7/);
    expect(new SettingsService().brain).toBe('opencode');
  });

  it('changes settings with validation', async () => {
    const { sent, say } = makeBot();
    await say('/set brain antigravity');
    await say('/set task_timeout_ms 60000');
    await say('/set brain rm');
    const s = new SettingsService();
    expect(s.brain).toBe('antigravity');
    expect(s.get('task_timeout_ms')).toBe('60000');
    expect(sent[2].text).toMatch(/^Invalid/);
  });

  it('queues a chat message as a task and sends the result back', async () => {
    const { bot, sent, say } = makeBot();
    bot.start();
    await say('what is 2+2');
    const tasks = new TaskService();
    const task = tasks.list({ limit: 1 })[0];
    expect(task.prompt).toBe('what is 2+2');
    tasks.updateStatus(task.id, 'completed', { result: '4' });
    emitTaskStatus(task.id, 'completed');
    await new Promise(r => setTimeout(r, 0));
    bot.stop();
    expect(sent.at(-1)).toMatchObject({ chat_id: 42, text: '4' });
  });
});
