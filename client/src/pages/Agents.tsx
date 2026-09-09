import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Agent, AgentPermission } from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineError,
  LoadingBlock,
  Modal,
  PageHeader,
  SelectField,
  StatusBadge,
  TextArea,
  TextField,
  Toggle,
} from '../components/Ui';

const BLANK_PERMISSION: AgentPermission = { resource: '', action: 'read', allowed: true };

const EMPTY_FORM = {
  name: '',
  description: '',
  system_prompt: '',
  model: '',
  enabled: true,
  approval_policy: 'none',
  timeout_seconds: '600',
  max_concurrent_tasks: '1',
  permissions: [] as AgentPermission[],
};

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Agent | null>(null);
  const [editingNew, setEditingNew] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ agents: Agent[] }>('/agents');
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (agent: Agent | null) => {
    if (agent) {
      setEditing(agent);
      setForm({
        name: agent.name,
        description: agent.description ?? '',
        system_prompt: agent.system_prompt ?? '',
        model: agent.model ?? '',
        enabled: agent.enabled,
        approval_policy: agent.approval_policy ?? 'none',
        timeout_seconds: String(agent.timeout_seconds ?? 600),
        max_concurrent_tasks: String(agent.max_concurrent_tasks ?? 1),
        permissions: agent.permissions.length
          ? agent.permissions.map((p) => ({ ...p }))
          : [{ ...BLANK_PERMISSION }],
      });
    } else {
      setEditing(null);
      setForm({ ...EMPTY_FORM, permissions: [{ ...BLANK_PERMISSION }] });
    }
    setEditingNew(!agent);
    setSaveError('');
    setSaving(false);
  };

  const save = async () => {
    setSaveError('');
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description || undefined,
        system_prompt: form.system_prompt || undefined,
        model: form.model || undefined,
        enabled: form.enabled,
        approval_policy: form.approval_policy,
        timeout_seconds: Number(form.timeout_seconds) || undefined,
        max_concurrent_tasks: Number(form.max_concurrent_tasks) || undefined,
        permissions: form.permissions
          .filter((p) => p.resource.trim())
          .map((p) => ({ ...p, paths: p.paths?.filter((s) => s.trim()).length ? p.paths : undefined })),
      };
      if (editingNew) {
        const data = await api.post<{ agent: Agent }>('/agents', body);
        setAgents((prev) => [data.agent, ...prev]);
      } else if (editing) {
        const data = await api.put<{ agent: Agent }>(`/agents/${editing.id}`, body);
        setAgents((prev) => prev.map((a) => (a.id === editing.id ? data.agent : a)));
      }
      setEditing(null);
      setEditingNew(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (agent: Agent) => {
    setToggleBusy(agent.id);
    try {
      const data = await api.put<{ agent: Agent }>(`/agents/${agent.id}`, { enabled: !agent.enabled });
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? data.agent : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent');
    } finally {
      setToggleBusy(null);
    }
  };

  const deleteAgent = async () => {
    if (!deleting) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.del<{ ok: boolean }>(`/agents/${deleting.id}`);
      setAgents((prev) => prev.filter((a) => a.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setDeleteBusy(false);
    }
  };

  const setPermission = (i: number, patch: Partial<AgentPermission>) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }));
  };

  return (
    <div className="page">
      <PageHeader
        title="Agents"
        subtitle="Default and custom agents with permissions"
        actions={
          <Button variant="primary" onClick={() => startEdit(null)}>
            New agent
          </Button>
        }
      />
      {error && <InlineError message={error} />}

      {loading ? (
        <LoadingBlock label="Loading agents" />
      ) : agents.length === 0 ? (
        <EmptyState title="No agents" hint="Create an agent to get started" />
      ) : (
        <div className="card-grid">
          {agents.map((a) => (
            <div key={a.id} className="card agent-card">
              <div className="card-head">
                <div>
                  <div className="card-title">{a.name}</div>
                  <div className="card-sub">{a.model || 'default model'}</div>
                </div>
                <StatusBadge status={a.enabled ? 'enabled' : 'disabled'} />
              </div>
              <p className="card-body">{a.description || 'No description'}</p>
              <div className="meta-row">
                <span>policy: {a.approval_policy ?? 'none'}</span>
                <span>timeout: {a.timeout_seconds ?? 600}s</span>
                <span>concurrent: {a.max_concurrent_tasks ?? 1}</span>
              </div>
              <div className="permission-preview">
                {a.permissions.map((p) => (
                  <span key={`${a.id}-${p.resource}-${p.action}-${p.allowed}`} className={`tag ${p.allowed ? '' : 'tag-muted'}`}>
                    {p.resource}:{p.action}
                  </span>
                ))}
              </div>
              <div className="card-actions">
                <Toggle
                  checked={a.enabled}
                  onChange={() => toggleEnabled(a)}
                  disabled={toggleBusy === a.id}
                />
                <Button onClick={() => startEdit(a)}>Edit</Button>
                <Button variant="danger" onClick={() => setDeleting(a)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || editingNew) && (
        <Modal
          title={editingNew ? 'New agent' : `Edit ${editing?.name}`}
          onClose={() => {
            setEditing(null);
            setEditingNew(false);
          }}
          width="lg"
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setEditingNew(false);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <TextField
              label="Name"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              required
            />
            <TextArea
              label="Description"
              value={form.description}
              onChange={(v) => setForm({ ...form, description: v })}
              rows={2}
            />
            <TextArea
              label="System prompt"
              value={form.system_prompt}
              onChange={(v) => setForm({ ...form, system_prompt: v })}
              rows={6}
            />
            <TextField
              label="Model"
              value={form.model}
              onChange={(v) => setForm({ ...form, model: v })}
              placeholder="e.g. opencode/big-pickle"
            />
            <SelectField
              label="Approval policy"
              value={form.approval_policy}
              onChange={(v) => setForm({ ...form, approval_policy: v })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'auto', label: 'Auto approve' },
                { value: 'review', label: 'Require review' },
                { value: 'all', label: 'Approve everything' },
              ]}
            />
            <div className="form-grid-2">
              <TextField
                label="Timeout (seconds)"
                value={form.timeout_seconds}
                onChange={(v) => setForm({ ...form, timeout_seconds: v })}
                type="number"
              />
              <TextField
                label="Max concurrent tasks"
                value={form.max_concurrent_tasks}
                onChange={(v) => setForm({ ...form, max_concurrent_tasks: v })}
                type="number"
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">Enable</span>
            <Toggle
              checked={form.enabled}
              onChange={(v) => setForm({ ...form, enabled: v })}
              label={form.enabled ? 'enabled' : 'disabled'}
            />
          </div>
          <div className="field">
            <span className="field-label">Permissions</span>
            <div className="permission-editor">
              {form.permissions.map((p, i) => (
                <div key={i} className="permission-row">
                  <input
                    className="input"
                    placeholder="resource (file, shell, http, env, process...)"
                    value={p.resource}
                    onChange={(e) => setPermission(i, { resource: e.target.value })}
                  />
                  <select
                    className="input"
                    value={p.action}
                    onChange={(e) => setPermission(i, { action: e.target.value })}
                  >
                    <option value="read">read</option>
                    <option value="write">write</option>
                    <option value="execute">execute</option>
                    <option value="delete">delete</option>
                    <option value="all">all</option>
                  </select>
                  <input
                    className="input"
                    placeholder="paths (comma separated)"
                    value={(p.paths ?? []).join(', ')}
                    onChange={(e) =>
                      setPermission(i, {
                        paths: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <Toggle
                    checked={!!p.allowed}
                    onChange={(v) => setPermission(i, { allowed: v })}
                    label={p.allowed ? 'allow' : 'deny'}
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        permissions: prev.permissions.filter((_, idx) => idx !== i),
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                onClick={() =>
                  setForm((prev) => ({ ...prev, permissions: [...prev.permissions, { ...BLANK_PERMISSION }] }))
                }
              >
                Add permission
              </Button>
            </div>
          </div>
          {saveError && <InlineError message={saveError} />}
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete agent"
          message={`Delete agent "${deleting.name}"? Tasks may fail if they reference this agent.`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={deleteAgent}
        />
      )}
    </div>
  );
}