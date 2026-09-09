import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Agent, Automation, AutomationRun, Project } from '../types';
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
  TimeText,
} from '../components/Ui';

const SCHEDULE_TYPES = ['one_time', 'recurring', 'cron', 'interval'];

const SCHEDULE_EXAMPLES: Record<string, string> = {
  one_time: 'ISO date e.g. 2026-09-10T09:00:00',
  recurring: 'daily / weekly / monthly',
  cron: 'cron expression e.g. 0 9 * * *',
  interval: 'minutes e.g. 30',
};

const EMPTY_FORM = {
  name: '',
  prompt: '',
  agentId: '',
  projectId: '',
  schedule_type: SCHEDULE_TYPES[0],
  schedule_value: '',
  enabled: true,
};

export default function Automations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [editingNew, setEditingNew] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [detail, setDetail] = useState<{ automation: Automation; runs: AutomationRun[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ automations: Automation[] }>('/automations');
      setAutomations(data.automations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load automations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api
      .get<{ agents: Agent[] }>('/agents')
      .then((d) => setAgents(d.agents))
      .catch(() => {});
    api
      .get<{ projects: Project[] }>('/projects')
      .then((d) => setProjects(d.projects))
      .catch(() => {});
  }, [load]);

  const startEdit = (a: Automation | null) => {
    if (a) {
      setEditing(a);
      setForm({
        name: a.name,
        prompt: a.prompt,
        agentId: a.agent_id ?? '',
        projectId: a.project_id ?? '',
        schedule_type: a.schedule_type,
        schedule_value: a.schedule_value,
        enabled: a.enabled,
      });
    } else {
      setEditing(null);
      setForm({ ...EMPTY_FORM });
    }
    setEditingNew(!a);
    setSaveError('');
  };

  const save = async () => {
    setSaveError('');
    setSaving(true);
    const body = {
      name: form.name,
      prompt: form.prompt,
      agent_id: form.agentId || undefined,
      project_id: form.projectId || undefined,
      schedule_type: form.schedule_type,
      schedule_value: form.schedule_value,
      enabled: form.enabled,
    };
    try {
      if (editingNew) {
        const data = await api.post<{ automation: Automation }>('/automations', body);
        setAutomations((prev) => [data.automation, ...prev]);
      } else if (editing) {
        const data = await api.put<{ automation: Automation }>(`/automations/${editing.id}`, body);
        setAutomations((prev) => prev.map((a) => (a.id === editing.id ? data.automation : a)));
      }
      setEditing(null);
      setEditingNew(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save automation');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (a: Automation) => {
    setBusyId(a.id);
    try {
      const data = await api.post<{ automation: Automation }>(`/automations/${a.id}/toggle`);
      setAutomations((prev) => prev.map((x) => (x.id === a.id ? data.automation : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle automation');
    } finally {
      setBusyId(null);
    }
  };

  const triggerNow = async (a: Automation) => {
    setBusyId(a.id);
    try {
      const data = await api.post<{ taskId: string; automation: Automation }>(
        `/automations/${a.id}/trigger-now`
      );
      setAutomations((prev) => prev.map((x) => (x.id === a.id ? data.automation : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger automation');
    } finally {
      setBusyId(null);
    }
  };

  const openDetail = async (a: Automation) => {
    setDetail({ automation: a, runs: [] });
    setDetailLoading(true);
    try {
      const data = await api.get<{ automation: Automation; runs: AutomationRun[] }>(`/automations/${a.id}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run history');
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteAutomation = async () => {
    if (!deleting) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.del<{ ok: boolean }>(`/automations/${deleting.id}`);
      setAutomations((prev) => prev.filter((a) => a.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete automation');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Automations"
        subtitle="Scheduled, recurring code tasks running autonomously"
        actions={
          <Button variant="primary" onClick={() => startEdit(null)}>
            New automation
          </Button>
        }
      />
      {error && <InlineError message={error} />}

      {loading ? (
        <LoadingBlock label="Loading automations" />
      ) : automations.length === 0 ? (
        <EmptyState title="No automations" hint="Create an automation to schedule recurring work" />
      ) : (
        <div className="card-grid">
          {automations.map((a) => (
            <div key={a.id} className="card automation-card">
              <div className="card-head">
                <div>
                  <div className="card-title">{a.name}</div>
                  <div className="card-sub">
                    {a.schedule_type} / {a.schedule_value}
                  </div>
                </div>
                <StatusBadge status={a.enabled ? 'enabled' : 'disabled'} />
              </div>
              <p className="card-body prompt-preview">{a.prompt}</p>
              <div className="meta-row">
                <span>last run: <TimeText value={a.last_run_at} /></span>
                <span>next run: <TimeText value={a.next_run_at} /></span>
              </div>
              <div className="card-actions">
                <Button variant="ghost" onClick={() => openDetail(a)}>
                  Runs
                </Button>
                <Button variant="ghost" onClick={() => toggle(a)} disabled={busyId === a.id}>
                  {a.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button onClick={() => triggerNow(a)} disabled={!a.enabled || busyId === a.id}>
                  Trigger now
                </Button>
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
          title={editingNew ? 'New automation' : `Edit ${editing?.name}`}
          onClose={() => {
            setEditing(null);
            setEditingNew(false);
          }}
          width="md"
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
              <Button variant="primary" onClick={save} disabled={saving || !form.name.trim() || !form.prompt.trim() || !form.schedule_value.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <TextField label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <TextArea label="Prompt" value={form.prompt} onChange={(v) => setForm({ ...form, prompt: v })} rows={4} />
            <SelectField
              label="Agent"
              value={form.agentId}
              onChange={(v) => setForm({ ...form, agentId: v })}
              options={[
                { value: '', label: 'Default' },
                ...agents.map((ag) => ({ value: ag.id, label: ag.name })),
              ]}
            />
            <SelectField
              label="Project"
              value={form.projectId}
              onChange={(v) => setForm({ ...form, projectId: v })}
              options={[
                { value: '', label: 'None' },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <SelectField
              label="Schedule type"
              value={form.schedule_type}
              onChange={(v) => setForm({ ...form, schedule_type: v, schedule_value: '' })}
              options={SCHEDULE_TYPES.map((t) => ({ value: t, label: t }))}
            />
            <TextField
              label={SCHEDULE_EXAMPLES[form.schedule_type]}
              value={form.schedule_value}
              onChange={(v) => setForm({ ...form, schedule_value: v })}
              required
            />
          </div>
          {saveError && <InlineError message={saveError} />}
        </Modal>
      )}

      {detail && (
        <Modal
          title={`${detail.automation.name} - run history`}
          onClose={() => setDetail(null)}
          width="lg"
        >
          {detailLoading ? (
            <LoadingBlock label="Loading run history" />
          ) : detail.runs.length === 0 ? (
            <EmptyState title="No runs yet" hint="This automation has not been triggered" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Triggered</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {detail.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.task_id ?? 'not created'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td><TimeText value={r.triggered_at} /></td>
                    <td className="muted">{r.error ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete automation"
          message={`Delete automation "${deleting.name}"?`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={deleteAutomation}
        />
      )}
    </div>
  );
}