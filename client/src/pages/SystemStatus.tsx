import { useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import { RealtimeContext } from '../context/RealtimeContext';
import { SystemStatusInfo } from '../types';
import { InlineError, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

export default function SystemStatus() {
  const { subscribe } = useContext(RealtimeContext);
  const [status, setStatus] = useState<SystemStatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.get<SystemStatusInfo>('/system/status');
      setStatus(data);
      setUpdatedAt(new Date().toLocaleTimeString());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const sub = subscribe('system:status', (data) => {
      setStatus(data as SystemStatusInfo);
      setUpdatedAt(new Date().toLocaleTimeString());
    });
    const timer = window.setInterval(load, 15000);
    return () => {
      sub();
      window.clearInterval(timer);
    };
  }, [subscribe]);

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="System Status" />
        <LoadingBlock label="Contacting server" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="page">
        <PageHeader title="System Status" />
        {error && <InlineError message={error} />}
      </div>
    );
  }

  const health = (
    status.server === 'online' &&
    status.database &&
    status.scheduler &&
    status.opencode.available
  )
    ? 'healthy'
    : 'degraded';

  const metrics: { label: string; value: string }[] = [
    { label: 'Active tasks', value: String(status.activeTasks) },
    { label: 'Queued tasks', value: String(status.queuedTasks) },
    { label: 'Waiting approvals', value: String(status.waitingApprovals) },
    { label: 'Memory records', value: String(status.memoryRecords) },
    { label: 'Workers', value: `${status.workers.busy}/${status.workers.available}` },
  ];

  return (
    <div className="page">
      <PageHeader
        title="System Status"
        subtitle={updatedAt ? `Updated ${updatedAt}` : 'Live overview of the control plane'}
      />
      {error && <InlineError message={error} />}

      <div className="system-banner">
        <div className="system-health">
          <StatusBadge status={health} />
          <span className="system-health-label">
            {health === 'healthy' ? 'All systems operational' : 'System needs attention'}
          </span>
        </div>
        <div className="system-stats">
          {metrics.map((m) => (
            <div key={m.label} className="stat">
              <div className="stat-value">{m.value}</div>
              <div className="stat-label">{m.label}</div>
            </div>
          ))}
          <div className="stat">
            <div className="stat-value mono stat-model">{status.currentModel ?? '-'}</div>
            <div className="stat-label">Model</div>
          </div>
        </div>
      </div>

      <div className="system-grid">
        <div className="card check-card">
          <div className="card-head">
            <div className="card-title">Server</div>
            <StatusBadge status={status.server} />
          </div>
          <div className="metric-line">
            <span>Uptime</span>
            <span className="mono">{formatUptime(status.uptime)}</span>
          </div>
          <div className="metric-line">
            <span>Server time</span>
            <span>{new Date(status.serverTime).toLocaleString()}</span>
          </div>
        </div>

        <div className="card check-card">
          <div className="card-head">
            <div className="card-title">OpenCode</div>
            <StatusBadge status={status.opencode.available ? 'online' : 'offline'} />
          </div>
          <div className="metric-line">
            <span>Version</span>
            <span className="mono">{status.opencode.version ?? 'unknown'}</span>
          </div>
          {status.opencode.error && <p className="card-body error-text">{status.opencode.error}</p>}
        </div>

        <div className="card check-card">
          <div className="card-head">
            <div className="card-title">Database</div>
            <StatusBadge status={status.database ? 'healthy' : 'offline'} />
          </div>
          <div className="metric-line">
            <span>Memory records stored</span>
            <span className="mono">{status.memoryRecords}</span>
          </div>
        </div>

        <div className="card check-card">
          <div className="card-head">
            <div className="card-title">Scheduler</div>
            <StatusBadge status={status.scheduler ? 'healthy' : 'offline'} />
          </div>
          <div className="metric-line">
            <span>Workers</span>
            <span className="mono">
              {status.workers.busy} busy of {status.workers.available}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}