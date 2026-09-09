import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Memory as MemoryRecord } from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineError,
  LoadingBlock,
  Modal,
  PageHeader,
  SelectField,
  TagList,
  TextArea,
  TextField,
  TimeText,
} from '../components/Ui';

const MEMORY_TYPES = [
  'USER_PREFERENCE',
  'PROJECT_FACT',
  'PROJECT_DECISION',
  'TECHNICAL_DECISION',
  'WORKFLOW',
  'IMPORTANT_CONTEXT',
  'REFERENCE',
  'GOAL',
];

export default function Memory() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deleting, setDeleting] = useState<MemoryRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [form, setForm] = useState({
    content: '',
    type: MEMORY_TYPES[0],
    importance: '5',
    tags: '',
  });

  const load = useCallback(async (query = '') => {
    setLoading(true);
    setError('');
    try {
      if (query) {
        const data = await api.get<{ memories: MemoryRecord[] }>(
          `/memory/search?q=${encodeURIComponent(query)}`
        );
        setMemories(data.memories);
        setSearching(true);
      } else {
        const data = await api.get<{ memories: MemoryRecord[] }>('/memory');
        setMemories(data.memories);
        setSearching(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createMemory = async () => {
    setCreateError('');
    setCreating(true);
    try {
      const data = await api.post<{ memory: MemoryRecord }>('/memory', {
        content: form.content,
        type: form.type,
        importance: Number(form.importance) || undefined,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setMemories((prev) => [data.memory, ...prev]);
      setShowCreate(false);
      setForm({ content: '', type: MEMORY_TYPES[0], importance: '5', tags: '' });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create memory');
    } finally {
      setCreating(false);
    }
  };

  const deleteMemory = async () => {
    if (!deleting) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.del<{ ok: boolean }>(`/memory/${deleting.id}`);
      setMemories((prev) => prev.filter((m) => m.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Memory"
        subtitle="Persistent context the system recalls from chat and tasks"
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            Add memory
          </Button>
        }
      />
      <div className="toolbar">
        <input
          className="input search-input"
          placeholder="Search memories... (retrieval simulation)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              load(search);
            }
          }}
        />
        <Button variant="ghost" onClick={() => load(search)} disabled={!search.trim()}>
          Search
        </Button>
        {searching && (
          <Button variant="ghost" onClick={() => { setSearch(''); load(''); }}>
            Clear
          </Button>
        )}
      </div>

      {searching && !loading && (
        <div className="retrieval-note">
          Retrieved {memories.length} memory record{memories.length === 1 ? '' : 's'} for query
          &quot;{search}&quot; ranked by semantic relevance.
        </div>
      )}
      {error && <InlineError message={error} />}

      {loading ? (
        <LoadingBlock label="Loading memories" />
      ) : memories.length === 0 ? (
        <EmptyState
          title="No memories"
          hint={searching ? 'No memories matched your search' : 'Add a memory the agent should remember'}
        />
      ) : (
        <div className="card-grid">
          {memories.map((m) => (
            <div key={m.id} className="card memory-card">
              <div className="card-head">
                <span className="tag">{m.type}</span>
                {m.importance !== null && m.importance !== undefined && (
                  <span className="memory-importance">importance: {m.importance}</span>
                )}
              </div>
              <p className="card-body memory-content">{m.content}</p>
              <div className="meta-row">
                <TagList tags={m.tags} />
              </div>
              <div className="meta-row muted">
                <span>created <TimeText value={m.created_at} /></span>
                {m.last_used_at && <span>last used <TimeText value={m.last_used_at} /></span>}
              </div>
              {m.source_conversation_id && <div className="muted source-line">from conversation {m.source_conversation_id.slice(0, 8)}</div>}
              {m.source_task_id && <div className="muted source-line">from task {m.source_task_id.slice(0, 8)}</div>}
              <div className="card-actions">
                <Button variant="danger" onClick={() => setDeleting(m)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal
          title="Add memory"
          onClose={() => setShowCreate(false)}
          width="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={createMemory} disabled={creating || !form.content.trim()}>
                {creating ? 'Saving...' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <TextArea
              label="Content"
              value={form.content}
              onChange={(v) => setForm({ ...form, content: v })}
              rows={4}
            />
            <SelectField
              label="Type"
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={MEMORY_TYPES.map((t) => ({ value: t, label: t }))}
            />
            <div className="form-grid-2">
              <TextField
                label="Importance (1-10)"
                value={form.importance}
                onChange={(v) => setForm({ ...form, importance: v })}
                type="number"
              />
              <TextField
                label="Tags (comma separated)"
                value={form.tags}
                onChange={(v) => setForm({ ...form, tags: v })}
              />
            </div>
          </div>
          {createError && <InlineError message={createError} />}
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete memory"
          message="Delete this memory record? The agent will no longer recall it."
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={deleteMemory}
        />
      )}
    </div>
  );
}