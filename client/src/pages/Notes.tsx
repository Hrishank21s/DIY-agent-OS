import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Note } from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineError,
  LoadingBlock,
  Modal,
  PageHeader,
  TagList,
  TextArea,
  TextField,
  Toggle,
  TimeText,
} from '../components/Ui';

const EMPTY_FORM = {
  title: '',
  content: '',
  note_type: 'general',
  tags: '',
  pinned: false,
  archived: false,
};

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [editingNew, setEditingNew] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState<Note | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (search.trim()) {
      params.set('search', search.trim());
    }
    if (showArchived) {
      params.set('archived', 'true');
    }
    try {
      const data = await api.get<{ notes: Note[] }>(`/notes${params.toString() ? `?${params}` : ''}`);
      setNotes(data.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [search, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return b.updated_at.localeCompare(a.updated_at);
  });

  const startEdit = (n: Note | null) => {
    if (n) {
      setEditing(n);
      setForm({
        title: n.title,
        content: n.content ?? '',
        note_type: n.note_type,
        tags: n.tags.join(', '),
        pinned: n.pinned,
        archived: n.archived,
      });
    } else {
      setEditing(null);
      setForm({ ...EMPTY_FORM });
    }
    setEditingNew(!n);
    setSaveError('');
  };

  const save = async () => {
    setSaveError('');
    setSaving(true);
    const body = {
      title: form.title,
      content: form.content || undefined,
      note_type: form.note_type,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      pinned: form.pinned,
      archived: form.archived,
    };
    try {
      if (editingNew) {
        const data = await api.post<{ note: Note }>('/notes', body);
        setNotes((prev) => [data.note, ...prev]);
      } else if (editing) {
        const data = await api.put<{ note: Note }>(`/notes/${editing.id}`, body);
        setNotes((prev) => prev.map((n) => (n.id === editing.id ? data.note : n)));
      }
      setEditing(null);
      setEditingNew(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  const quickToggle = async (n: Note, patch: Partial<Note>) => {
    try {
      const data = await api.put<{ note: Note }>(`/notes/${n.id}`, patch);
      setNotes((prev) => prev.map((x) => (x.id === n.id ? data.note : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update note');
    }
  };

  const deleteNote = async () => {
    if (!deleting) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.del<{ ok: boolean }>(`/notes/${deleting.id}`);
      setNotes((prev) => prev.filter((n) => n.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Notes"
        subtitle="Markdown-friendly notes with tags, pinning and archive"
        actions={
          <Button variant="primary" onClick={() => startEdit(null)}>
            New note
          </Button>
        }
      />
      <div className="toolbar">
        <input
          className="input search-input"
          placeholder="Search notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="chat-archived-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      {error && <InlineError message={error} />}

      {loading ? (
        <LoadingBlock label="Loading notes" />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No notes"
          hint={showArchived ? 'No archived notes' : 'Write a note to get started'}
        />
      ) : (
        <div className="notes-grid">
          {sorted.map((n) => (
            <div key={n.id} className={`card note-card ${n.pinned ? 'note-pinned' : ''}`}>
              <div className="card-head">
                <div>
                  <div className="card-title">
                    {n.pinned && <span className="pin-mark">pin</span>} {n.title}
                  </div>
                  <div className="card-sub">
                    {n.note_type} · updated <TimeText value={n.updated_at} />
                  </div>
                </div>
              </div>
              {n.content && <p className="card-body note-preview">{n.content}</p>}
              <div className="meta-row">
                <TagList tags={n.tags} />
              </div>
              <div className="card-actions">
                <Toggle
                  checked={n.pinned}
                  onChange={(v) => quickToggle(n, { pinned: v })}
                  label="pin"
                />
                {!n.archived && (
                  <Button variant="ghost" onClick={() => quickToggle(n, { archived: true })}>
                    Archive
                  </Button>
                )}
                {n.archived && (
                  <Button variant="ghost" onClick={() => quickToggle(n, { archived: false })}>
                    Unarchive
                  </Button>
                )}
                <Button onClick={() => startEdit(n)}>Edit</Button>
                <Button variant="danger" onClick={() => setDeleting(n)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || editingNew) && (
        <Modal
          title={editingNew ? 'New note' : `Edit ${editing?.title}`}
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
              <Button
                variant="primary"
                onClick={save}
                disabled={saving || !form.title.trim()}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <TextField label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
            <TextArea label="Content" value={form.content} onChange={(v) => setForm({ ...form, content: v })} rows={10} />
            <div className="form-grid-2">
              <TextField
                label="Type"
                value={form.note_type}
                onChange={(v) => setForm({ ...form, note_type: v })}
              />
              <TextField
                label="Tags (comma separated)"
                value={form.tags}
                onChange={(v) => setForm({ ...form, tags: v })}
              />
            </div>
          </div>
          <div className="form-row">
            <Toggle checked={form.pinned} onChange={(v) => setForm({ ...form, pinned: v })} label="Pinned" />
            <Toggle checked={form.archived} onChange={(v) => setForm({ ...form, archived: v })} label="Archived" />
          </div>
          {saveError && <InlineError message={saveError} />}
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete note"
          message={`Delete "${deleting.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={deleteNote}
        />
      )}
    </div>
  );
}