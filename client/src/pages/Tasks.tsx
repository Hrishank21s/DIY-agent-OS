import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { RealtimeContext } from '../context/RealtimeContext';
import { Agent, Project, Task, TaskLog } from '../types';
import {
  Button,
  LoadingBlock,
  Modal,
  PageHeader,
  SelectField,
  StatusBadge,
  TextArea,
  TextField,
  TimeText,
  EmptyState,
  InlineError,
} from '../components/Ui';

type TaskFilter = '' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Tasks() {
  const { subscribe } = useContext(RealtimeContext);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskFilter>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const logsRef = useRef<HTMLDivElement | null>(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    prompt: '',
    projectId: '',
    agentName: '',
    priority: 'normal',
  });

  const loadTasks = useCallback(async (statusFilter: TaskFilter = filter) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) {
        params.set('status', statusFilter);
      }
      const data = await api.get<{ tasks: Task[] }>(`/tasks${params.toString() ? `?${params}` : ''}`);
      setTasks(data.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    api
      .get<{ agents: Agent[] }>('/agents')
      .then((d) => setAgents(d.agents))
      .catch(() => {});
    api
      .get<{ projects: Project[] }>('/projects')
      .then((d) => setProjects(d.projects))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribe('task:status', (data) => {
      const d = data as Partial<Task> & { taskId?: string; task_id?: string };
      const id = (d.taskId ?? d.task_id ?? d.id) as string;
      if (!id) {
        return;
      }
      setTasks((prev) => {
        const exists = prev.some((t) => t.id === id);
        if (!exists) {
          return [d as Task, ...prev];
        }
        return prev.map((t) => (t.id === id ? { ...t, ...d } : t));
      });
      setSelected((prev) => (prev && prev.id === id ? { ...prev, ...d } : prev));
    });
    return () => unsub();
  }, [subscribe]);

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected]);

  useEffect(() => {
    const unsub = subscribe('task:output', (data) => {
      const d = data as Record<string, unknown>;
      const id = (d.taskId ?? d.task_id) as string | undefined;
      if (!id || id !== selectedIdRef.current) {
        return;
      }
      const chunk = (d.chunk ?? '') as string;
      if (!chunk) {
        return;
      }
      setLogs((prev) => [
        ...prev,
        {
          id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          task_id: id,
          level: 'info',
          message: chunk,
          source: 'opencode',
          meta: null,
          created_at: new Date().toISOString(),
        },
      ]);
    });
    return () => unsub();
  }, [subscribe]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs, logsLoading]);

  const openDetail = async (task: Task) => {
    setSelected(task);
    setLogsLoading(true);
    try {
      const data = await api.get<{ task: Task; logs: TaskLog[] }>(`/tasks/${task.id}`);
      setSelected(data.task);
      setLogs(data.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task');
    } finally {
      setLogsLoading(false);
    }
  };

  const createTask = async () => {
    setCreateError('');
    setCreating(true);
    try {
      const data = await api.post<{ task: Task }>('/tasks', {
        title: form.title,
        description: form.description || undefined,
        prompt: form.prompt || undefined,
        project_id: form.projectId || undefined,
        agent_name: form.agentName || undefined,
        priority: form.priority,
      });
      setTasks((prev) => [data.task, ...prev]);
      setShowCreate(false);
      setForm({ title: '', description: '', prompt: '', projectId: '', agentName: '', priority: 'normal' });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const taskAction = async (id: string, action: 'cancel' | 'retry') => {
    setBusyId(id);
    try {
      const data = await api.post<{ task: Task }>(`/tasks/${id}/${action}`);
      setTasks((prev) => prev.map((t) => (t.id === id ? data.task : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} task`);
    } finally {
      setBusyId(null);
    }
  };

  const visibleTasks = filter ? tasks.filter((t) => t.status === filter) : tasks;

  return (
    <div className="page">
      <PageHeader
        title="Tasks"
        subtitle={`${tasks.length} tasks · live updates`}
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            New task
          </Button>
        }
      />
      <div className="filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`filter-chip ${filter === f.value ? 'filter-chip-active' : ''}`}
            onClick={() => {
              setFilter(f.value);
              loadTasks(f.value);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <InlineError message={error} />}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Agent</th>
              <th>Project</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}><LoadingBlock label="Loading tasks" /></td>
              </tr>
            ) : visibleTasks.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No tasks" hint="Create a task to get started" />
                </td>
              </tr>
            ) : (
              visibleTasks.map((t) => (
                <tr key={t.id} onClick={() => openDetail(t)} className="row-clickable">
                  <td className="cell-title">{t.title}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{t.priority}</td>
                  <td>{t.agent_id ? t.agent_id.slice(0, 8) : '-'}</td>
                  <td>{t.project_id ? t.project_id.slice(0, 8) : '-'}</td>
                  <td><TimeText value={t.created_at} /></td>
                  <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
                    {(t.status === 'queued' || t.status === 'running' || t.status === 'in_progress') && (
                      <Button
                        variant="danger"
                        disabled={busyId === t.id}
                        onClick={() => taskAction(t.id, 'cancel')}
                      >
                        Cancel
                      </Button>
                    )}
                    {(t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') && (
                      <Button
                        variant="ghost"
                        disabled={busyId === t.id}
                        onClick={() => taskAction(t.id, 'retry')}
                      >
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <Modal
          title={selected.title}
          onClose={() => setSelected(null)}
          width="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </>
          }
        >
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Status</span>
              <StatusBadge status={selected.status} />
            </div>
            <div className="detail-item">
              <span className="detail-label">Priority</span>
              <span>{selected.priority}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Agent</span>
              <span>{selected.agent_id ?? '-'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Project</span>
              <span>{selected.project_id ?? '-'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Created</span>
              <TimeText value={selected.created_at} />
            </div>
            <div className="detail-item">
              <span className="detail-label">Completed</span>
              <TimeText value={selected.completed_at} />
            </div>
          </div>
          {selected.description && (
            <div className="detail-section">
              <div className="detail-label">Description</div>
              <p>{selected.description}</p>
            </div>
          )}
          {selected.prompt && (
            <div className="detail-section">
              <div className="detail-label">Prompt</div>
              <pre className="code-block">{selected.prompt}</pre>
            </div>
          )}
          {selected.result && (
            <div className="detail-section">
              <div className="detail-label">Result</div>
              <pre className="code-block">{selected.result}</pre>
            </div>
          )}
          {selected.error && (
            <div className="detail-section">
              <div className="detail-label">Error</div>
              <pre className="code-block code-error">{selected.error}</pre>
            </div>
          )}
          <div className="detail-section">
            <div className="detail-label">Logs</div>
            {logsLoading ? (
              <LoadingBlock label="Loading logs" />
            ) : logs.length === 0 ? (
              <div className="muted">No logs yet</div>
            ) : (
              <div className="log-list log-list-scroll" ref={logsRef}>
                {logs.map((l) => (
                  <div key={l.id} className="log-line">
                    <span className={`log-level log-${l.level}`}>{l.level}</span>
                    <span className="log-source">{l.source}</span>
                    <span className="log-message">{l.message}</span>
                    <TimeText value={l.created_at} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {showCreate && (
        <Modal
          title="New task"
          onClose={() => setShowCreate(false)}
          width="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={createTask} disabled={creating}>
                {creating ? 'Creating...' : 'Create task'}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <TextField
              label="Title"
              value={form.title}
              onChange={(v) => setForm({ ...form, title: v })}
              required
            />
            <TextArea
              label="Description"
              value={form.description}
              onChange={(v) => setForm({ ...form, description: v })}
            />
            <TextArea
              label="Prompt"
              value={form.prompt}
              onChange={(v) => setForm({ ...form, prompt: v })}
            />
            <SelectField
              label="Priority"
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'High' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
            <SelectField
              label="Agent"
              value={form.agentName}
              onChange={(v) => setForm({ ...form, agentName: v })}
              options={[
                { value: '', label: 'Default' },
                ...agents.map((a) => ({ value: a.name, label: a.name })),
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
          </div>
          {createError && <InlineError message={createError} />}
        </Modal>
      )}
    </div>
  );
}