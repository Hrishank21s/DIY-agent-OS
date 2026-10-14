import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Button, InlineError, TextField } from '../components/Ui';

interface TelegramState {
  tokenSet: boolean;
  running: boolean;
  chatIds: string[];
  strangers: string[];
}

export default function TelegramSettings() {
  const [state, setState] = useState<TelegramState | null>(null);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await api.get<TelegramState>('/settings/telegram'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Telegram settings');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // pick up new "allow this chat" requests
    return () => clearInterval(t);
  }, [load]);

  const save = async (body: { botToken?: string; chatIds?: string[] }, done: string) => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const r = await api.put<{ botUsername?: string }>('/settings/telegram', body);
      setMsg(r.botUsername ? `${done} Bot: @${r.botUsername}` : done);
      setToken('');
      setChatId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return error ? <InlineError message={error} /> : null;
  const allow = (id: string) => save({ chatIds: [...new Set([...state.chatIds, id])] }, 'Chat allowed.');

  return (
    <div className="settings-section">
      <div className="form-grid settings-form">
        <div className="muted">
          Status: {state.running ? 'bot running' : state.tokenSet ? 'starting…' : 'not set up'}
        </div>
        {msg && <div className="muted">{msg}</div>}
        {error && <InlineError message={error} />}

        <ol className="muted">
          <li>In Telegram, message <b>@BotFather</b>, send <code>/newbot</code>, copy the token.</li>
          <li>Paste it below and save. The bot starts immediately.</li>
          <li>Send any message to your bot, then click <b>Allow</b> next to your chat here.</li>
        </ol>

        <TextField
          label={state.tokenSet ? 'Bot token (saved — paste to replace)' : 'Bot token'}
          value={token}
          onChange={setToken}
          type="password"
          placeholder="123456:ABC..."
        />
        <div className="settings-actions">
          <Button variant="primary" disabled={busy || !token.trim()} onClick={() => save({ botToken: token.trim() }, 'Token saved.')}>
            Save token
          </Button>
          {state.tokenSet && (
            <Button variant="danger" disabled={busy} onClick={() => save({ botToken: '' }, 'Bot disabled.')}>
              Remove token
            </Button>
          )}
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-label">Chats waiting for approval ({state.strangers.filter((s) => !state.chatIds.includes(s)).length})</div>
        <div className="compact-list">
          {state.strangers.filter((s) => !state.chatIds.includes(s)).map((id) => (
            <div key={id} className="compact-row">
              <span className="mono">{id}</span>
              <Button variant="success" disabled={busy} onClick={() => allow(id)}>Allow</Button>
            </div>
          ))}
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-label">Allowed chats ({state.chatIds.length})</div>
        <div className="compact-list">
          {state.chatIds.map((id) => (
            <div key={id} className="compact-row">
              <span className="mono">{id}</span>
              <Button variant="danger" disabled={busy} onClick={() => save({ chatIds: state.chatIds.filter((c) => c !== id) }, 'Chat removed.')}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="form-grid settings-form">
          <TextField label="Add chat id manually" value={chatId} onChange={setChatId} placeholder="123456789" />
          <div className="settings-actions">
            <Button variant="primary" disabled={busy || !chatId.trim()} onClick={() => allow(chatId.trim())}>Add</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
