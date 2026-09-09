import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { SessionInfo, SettingsData } from '../types';
import {
  Button,
  InlineError,
  LoadingBlock,
  PageHeader,
  TextField,
  TimeText,
} from '../components/Ui';

type SettingsTab = 'general' | 'auth' | 'opencode' | 'agents' | 'memory' | 'security' | 'system';

const TABS: { value: SettingsTab; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'auth', label: 'Authentication' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'agents', label: 'Agents' },
  { value: 'memory', label: 'Memory' },
  { value: 'security', label: 'Security' },
  { value: 'system', label: 'System' },
];

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('general');
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);

  const [general, setGeneral] = useState({ server_name: '', timezone: '' });
  const [auth, setAuth] = useState({ username: '', newPassword: '', sessionDurationMinutes: '1440' });
  const [opencode, setOpencode] = useState({
    opencode_path: '',
    model: '',
    working_dir: '',
    task_timeout_ms: '600000',
  });
  const [security, setSecurity] = useState({
    trustedPaths: '',
    loginRateLimit: '',
    approvalRules: '',
  });

  useEffect(() => {
    api
      .get<SettingsData>('/settings')
      .then((d) => {
        setData(d);
        const s = d.settings;
        setGeneral({
          server_name: String(s.server_name ?? ''),
          timezone: String(s.timezone ?? ''),
        });
        setAuth({
          username: String(s.username ?? ''),
          newPassword: '',
          sessionDurationMinutes: String(s.session_duration_minutes ?? s.sessionDurationMinutes ?? 1440),
        });
        setOpencode({
          opencode_path: String(s.opencode_path ?? ''),
          model: String(s.model ?? ''),
          working_dir: String(s.working_dir ?? ''),
          task_timeout_ms: String(s.task_timeout_ms ?? s.task_timeout ?? 600000),
        });
        const limit = (s.login_rate_limit as string | number | undefined) ?? '';
        const rules = (s.approval_rules ?? '') as string | object | undefined;
        setSecurity({
          trustedPaths: (d.trustedPaths ?? []).join('\n'),
          loginRateLimit: String(limit ?? ''),
          approvalRules: typeof rules === 'string' ? rules : JSON.stringify(rules ?? {}, null, 2),
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const loadSessions = useCallback(() => {
    api
      .get<{ sessions: SessionInfo[] }>('/auth/sessions')
      .then((d) => setSessions(d.sessions))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'auth') {
      loadSessions();
    }
  }, [tab, loadSessions]);

  const saveGeneral = async () => {
    setSaving(true);
    setSaveMsg('');
    setSaveError('');
    try {
      await api.put<{ ok: boolean }>('/settings/general', {
        server_name: general.server_name || undefined,
        timezone: general.timezone || undefined,
      });
      setSaveMsg('General settings saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const saveAuth = async () => {
    setSaving(true);
    setSaveMsg('');
    setSaveError('');
    try {
      await api.put<{ ok: boolean }>('/settings/auth', {
        username: auth.username || undefined,
        newPassword: auth.newPassword || undefined,
        sessionDurationMinutes: Number(auth.sessionDurationMinutes) || undefined,
      });
      setAuth((prev) => ({ ...prev, newPassword: '' }));
      setSaveMsg('Authentication settings saved');
      loadSessions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const saveOpencode = async () => {
    setSaving(true);
    setSaveMsg('');
    setSaveError('');
    try {
      await api.put<{ ok: boolean }>('/settings/opencode', {
        opencode_path: opencode.opencode_path || undefined,
        model: opencode.model || undefined,
        working_dir: opencode.working_dir || undefined,
        task_timeout_ms: Number(opencode.task_timeout_ms) || undefined,
      });
      setSaveMsg('OpenCode settings saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const saveSecurity = async () => {
    setSaving(true);
    setSaveMsg('');
    setSaveError('');
    let approvalRules: string | Record<string, unknown> | undefined;
    try {
      approvalRules = security.approvalRules.trim() ? JSON.parse(security.approvalRules) : undefined;
    } catch {
      setSaveError('Approval rules must be valid JSON');
      setSaving(false);
      return;
    }
    try {
      await api.put<{ ok: boolean }>('/settings/security', {
        trusted_paths: security.trustedPaths.split('\n').map((s) => s.trim()).filter(Boolean),
        login_rate_limit: security.loginRateLimit ? Number(security.loginRateLimit) : undefined,
        approval_rules: approvalRules,
      });
      setSaveMsg('Security settings saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const revokeSession = async (id: string) => {
    setRevokeBusy(id);
    try {
      await api.post<{ ok: boolean }>(`/auth/sessions/${id}/revoke`);
      loadSessions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setRevokeBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Settings" />
        <LoadingBlock label="Loading settings" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Server configuration and security controls" />
      {error && <InlineError message={error} />}
      <div className="settings-layout">
        <div className="settings-nav">
          {TABS.map((t) => (
            <button
              key={t.value}
              className={`settings-tab ${tab === t.value ? 'settings-tab-active' : ''}`}
              onClick={() => {
                setTab(t.value);
                setSaveMsg('');
                setSaveError('');
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-panel">
          {saveMsg && <div className="success-block">{saveMsg}</div>}
          {saveError && <InlineError message={saveError} />}

          {tab === 'general' && (
            <div className="form-grid settings-form">
              <TextField
                label="Server name"
                value={general.server_name}
                onChange={(v) => setGeneral({ ...general, server_name: v })}
              />
              <TextField
                label="Timezone"
                value={general.timezone}
                onChange={(v) => setGeneral({ ...general, timezone: v })}
                placeholder="UTC, America/New_York, Europe/Berlin..."
              />
              <div className="settings-actions">
                <Button variant="primary" onClick={saveGeneral} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}

          {tab === 'auth' && (
            <div className="settings-section">
              <div className="form-grid settings-form">
                <TextField
                  label="Username"
                  value={auth.username}
                  onChange={(v) => setAuth({ ...auth, username: v })}
                />
                <TextField
                  label="New password"
                  value={auth.newPassword}
                  onChange={(v) => setAuth({ ...auth, newPassword: v })}
                  type="password"
                />
                <TextField
                  label="Session duration (minutes)"
                  value={auth.sessionDurationMinutes}
                  onChange={(v) => setAuth({ ...auth, sessionDurationMinutes: v })}
                  type="number"
                />
                <div className="settings-actions">
                  <Button variant="primary" onClick={saveAuth} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-label">Active sessions ({sessions.length})</div>
                {sessions.length === 0 ? (
                  <div className="muted">None</div>
                ) : (
                  <div className="compact-list">
                    {sessions.map((s) => (
                      <div key={s.id} className="compact-row">
                        <span className="mono">{s.id.slice(0, 12)}...</span>
                        <span>
                          {s.current ? 'current session' : `created ${new Date(s.created_at).toLocaleString()}`}
                        </span>
                        <span className="muted">expires <TimeText value={s.expires_at} /></span>
                        {!s.current && (
                          <Button
                            variant="danger"
                            disabled={revokeBusy === s.id}
                            onClick={() => revokeSession(s.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'opencode' && (
            <div className="form-grid settings-form">
              <TextField
                label="OpenCode path"
                value={opencode.opencode_path}
                onChange={(v) => setOpencode({ ...opencode, opencode_path: v })}
                placeholder="/usr/local/bin/opencode"
              />
              <TextField
                label="Model"
                value={opencode.model}
                onChange={(v) => setOpencode({ ...opencode, model: v })}
                placeholder="opencode/big-pickle"
              />
              <TextField
                label="Working directory"
                value={opencode.working_dir}
                onChange={(v) => setOpencode({ ...opencode, working_dir: v })}
                placeholder="/path/to/workspace"
              />
              <TextField
                label="Task timeout (ms)"
                value={opencode.task_timeout_ms}
                onChange={(v) => setOpencode({ ...opencode, task_timeout_ms: v })}
                type="number"
              />
              <div className="settings-actions">
                <Button variant="primary" onClick={saveOpencode} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}

          {tab === 'agents' && (
            <div className="settings-link-panel">
              <p>Agent definitions, system prompts and permission rules live in Agents.</p>
              <Link to="/agents" className="btn btn-primary">
                Open Agents
              </Link>
            </div>
          )}

          {tab === 'memory' && (
            <div className="settings-link-panel">
              <p>Browse, search and manage persistent memory records.</p>
              <Link to="/memory" className="btn btn-primary">
                Open Memory
              </Link>
            </div>
          )}

          {tab === 'security' && (
            <div className="settings-section">
              <div className="detail-label">Trusted paths</div>
              <textarea
                className="input textarea"
                rows={5}
                value={security.trustedPaths}
                onChange={(v) => setSecurity({ ...security, trustedPaths: v.target.value })}
                placeholder={'/Users/me/work\n/Users/me/projects'}
              />
              <div className="form-grid-2">
                <TextField
                  label="Login rate limit"
                  value={security.loginRateLimit}
                  onChange={(v) => setSecurity({ ...security, loginRateLimit: v })}
                  type="number"
                />
              </div>
              <div className="detail-label">Approval rules (JSON)</div>
              <textarea
                className="input textarea mono"
                rows={8}
                value={security.approvalRules}
                onChange={(v) => setSecurity({ ...security, approvalRules: v.target.value })}
                placeholder='{"risk_levels":["high"],"require_review_for":["file:write"]}'
              />
              <div className="settings-actions">
                <Button variant="primary" onClick={saveSecurity} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}

          {tab === 'system' && (
            <div className="settings-link-panel">
              <p>Live server status, workers, queue and scheduler information.</p>
              <Link to="/system" className="btn btn-primary">
                Open System Status
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}