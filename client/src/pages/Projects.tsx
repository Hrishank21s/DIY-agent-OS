import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Memory, Note, Project, Task } from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineError,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusBadge,
  TextArea,
  TextField,
  TimeText,
} from '../components/Ui';

const EMPTY_FORM = { name: '', description: '', root_dir: '', instructions: '' };

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [editingNew, setEditingNew] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [detail, setDetail] = useState<Project | null>(null);
  const [detailData, setDetailData] = useState<{
    memories: Memory[];
    notes: Note[];
    tasks: Task[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ projects: Project[] }>('/projects');
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (p: Project | null) => {
    if (p) {
      setEditing(p);
      setForm({
        name: p.name,
        description: p.description ?? '',
        root_dir: p.root_dir ?? '',
        instructions: p.instructions ?? '',
      });
    } else {
      setEditing(null);
      setForm({ ...EMPTY_FORM });
    }
    setEditingNew(!p);
    setSaveError('');
  };

  const save = async () => {
    setSaveError('');
    setSaving(true);
    const body = {
      name: form.name,
      description: form.description || undefined,
      root_dir: form.root_dir || undefined,
      instructions: form.instructions || undefined,
    };
    try {
      if (editingNew) {
        const data = await api.post<{ project: Project }>('/projects', body);
        setProjects((prev) => [data.project, ...prev]);
      } else if (editing) {
        const data = await api.put<{ project: Project }>(`/projects/${editing.id}`, body);
        setProjects((prev) => prev.map((p) => (p.id === editing.id ? data.project : p)));
      }
      setEditing(null);
      setEditingNew(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (p: Project) => {
    setDetail(p);
    setDetailData(null);
    setDetailLoading(true);
    setDetailError('');
    try {
      const data = await api.get<{ project: Project; memories: Memory[]; notes: Note[]; tasks: Task[] }>(
        `/projects/${p.id}`
      );
      setDetailData({ memories: data.memories, notes: data.notes, tasks: data.tasks });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteProject = async () => {
    if (!deleting) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.del<{ ok: boolean }>(`/projects/${deleting.id}`);
      setProjects((prev) => prev.filter((p) => p.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Projects"
        subtitle="Scoped workspaces with instructions, memory, notes and tasks"
        actions={
          <Button variant="primary" onClick={() => startEdit(null)}>
            New project
          </Button>
        }
      />
      {error && <InlineError message={error} />}

      {loading ? (
        <LoadingBlock label="Loading projects" />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects" hint="Create a project to organize work" />
      ) : (
        <div className="card-grid">
          {projects.map((p) => (
            <div key={p.id} className="card project-card" onClick={() => openDetail(p)}>
              <div className="card-head">
                <div>
                  <div className="card-title">{p.name}</div>
                  <div className="card-sub">created <TimeText value={p.created_at} /></div>
                </div>
              </div>
              {p.description && <p className="card-body">{p.description}</p>}
              {p.root_dir && (
                <div className="code-line mono">dir: {p.root_dir}</div>
              )}
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <Button onClick={() => { startEdit(p); }}>Edit</Button>
                <Button variant="danger" onClick={() => setDeleting(p)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || editingNew) && (
        <Modal
          title={editingNew ? 'New project' : `Edit ${editing?.name}`}
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
            <TextField label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <TextArea label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={2} />
            <TextField label="Root directory" value={form.root_dir} onChange={(v) => setForm({ ...form, root_dir: v })} placeholder="/path/to/project" />
            <TextArea label="Instructions" value={form.instructions} onChange={(v) => setForm({ ...form, instructions: v })} rows={6} />
          </div>
          {saveError && <InlineError message={saveError} />}
        </Modal>
      )}

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} width="lg">
          {detailError && <InlineError message={detailError} />}
          {detail.description && <p className="card-body">{detail.description}</p>}
          {detail.root_dir && <div className="code-line mono">root: {detail.root_dir}</div>}
          {detail.instructions && (
            <div className="detail-section">
              <div className="detail-label">Instructions</div>
              <pre className="code-block">{detail.instructions}</pre>
            </div>
          )}
          {detailLoading ? (
            <LoadingBlock label="Loading project data" />
          ) : (
            detailData && (
              <>
                <div className="detail-section">
                  <div className="detail-label">Tasks ({detailData.tasks.length})</div>
                  {detailData.tasks.length === 0 ? (
                    <div className="muted">None</div>
                  ) : (
                    <div className="compact-list">
                      {detailData.tasks.map((t) => (
                        <div key={t.id} className="compact-row">
                          <span>{t.title}</span>
                          <StatusBadge status={t.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="detail-section">
                  <div className="detail-label">Memories ({detailData.memories.length})</div>
                  {detailData.memories.length === 0 ? (
                    <div className="muted">None</div>
                  ) : (
                    <div className="compact-list">
                      {detailData.memories.map((m) => (
                        <div key={m.id} className="compact-row">
                          <span className="mono">{m.type}</span>
                          <span>{m.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="detail-section">
                  <div className="detail-label">Notes ({detailData.notes.length})</div>
                  {detailData.notes.length === 0 ? (
                    <div className="muted">None</div>
                  ) : (
                    <div className="compact-list">
                      {detailData.notes.map((n) => (
                        <div key={n.id} className="compact-row">
                          <span>{n.title}</span>
                          <span className="muted">{n.note_type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )
          )}
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete project"
          message={`Delete project "${deleting.name}"? Associated memories, notes and tasks may be affected.`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={deleteProject}
        />
      )}
    </div>
  );
}