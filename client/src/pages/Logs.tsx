import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { CommandLog, LogEntry } from '../types';
import { EmptyState, InlineError, LoadingBlock, PageHeader, TimeText } from '../components/Ui';

type LogTab = 'task' | 'audit' | 'command';

export default function Logs() {
  const [tab, setTab] = useState<LogTab>('task');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [commands, setCommands] = useState<CommandLog[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState('200');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTaskLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (category) {
        params.set('category', category);
      }
      params.set('limit', limit);
      const data = await api.get<{ logs: LogEntry[]; categories: string[] }>(
        `/logs?${params.toString()}`
      );
      setEntries(data.logs);
      setCategories(data.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [category, limit]);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ logs: LogEntry[] }>(`/logs/audit?limit=${limit}`);
      setEntries(data.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const loadCommandLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ commands: CommandLog[] }>(`/logs/commands?limit=${limit}`);
      setCommands(data.commands);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load command logs');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (tab === 'task') {
      loadTaskLogs();
    } else if (tab === 'audit') {
      loadAuditLogs();
    } else {
      loadCommandLogs();
    }
  }, [tab, loadTaskLogs, loadAuditLogs, loadCommandLogs]);

  const filteredEntries = entries.filter((e) => {
    if (!search.trim()) {
      return true;
    }
    const q = search.toLowerCase();
    return (
      e.message?.toLowerCase().includes(q) ||
      e.source?.toLowerCase().includes(q) ||
      e.level?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q)
    );
  });

  const filteredCommands = commands.filter((c) => {
    if (!search.trim()) {
      return true;
    }
    const q = search.toLowerCase();
    return c.command?.toLowerCase().includes(q);
  });

  return (
    <div className="page">
      <PageHeader title="Logs" subtitle="Task, audit and command execution history" />
      <div className="toolbar">
        <div className="filter-bar compact">
          {(['task', 'audit', 'command'] as LogTab[]).map((t) => (
            <button
              key={t}
              className={`filter-chip ${tab === t ? 'filter-chip-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t} logs
            </button>
          ))}
        </div>
        <input
          className="input search-input"
          placeholder="Filter logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input limit-input"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        >
          <option value="100">100</option>
          <option value="200">200</option>
          <option value="500">500</option>
          <option value="1000">1000</option>
        </select>
      </div>
      {tab === 'task' && categories.length > 0 && (
        <div className="toolbar">
          <select
            className="input limit-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">all categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <InlineError message={error} />}

      {loading ? (
        <LoadingBlock label="Loading logs" />
      ) : tab === 'command' ? (
        filteredCommands.length === 0 ? (
          <EmptyState title="No command logs" hint={search ? 'No commands matched your search' : 'No commands executed yet'} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Command</th>
                <th>CWD</th>
                <th>Exit</th>
                <th>Duration</th>
                <th>Task</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {filteredCommands.map((c) => (
                <tr key={c.id}>
                  <td className="mono command-text">{c.command}</td>
                  <td className="mono muted">{c.cwd ?? '-'}</td>
                  <td>
                    <span className={c.exit_code === 0 ? 'exit-ok' : 'exit-bad'}>
                      {c.exit_code ?? '-'}
                    </span>
                  </td>
                  <td>{c.duration_ms != null ? `${c.duration_ms}ms` : '-'}</td>
                  <td className="mono muted">{c.task_id?.slice(0, 8) ?? '-'}</td>
                  <td><TimeText value={c.created_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : filteredEntries.length === 0 ? (
        <EmptyState title="No log entries" hint={search ? 'No entries matched your search' : 'Nothing logged yet'} />
      ) : (
        <div className="log-list log-list-scroll">
          {filteredEntries.map((e) => (
            <div key={e.id} className="log-line">
              <span className={`log-level log-${e.level}`}>{e.level || 'info'}</span>
              <span className="log-category">{e.category}</span>
              <span className="log-source">{e.source}</span>
              <span className="log-message">{e.message}</span>
              <TimeText value={e.created_at} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}