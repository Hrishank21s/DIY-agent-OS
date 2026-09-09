interface StatusBadgeProps {
  status: string;
}

const STATUS_CLASSES: Record<string, string> = {
  running: 'badge-info',
  queued: 'badge-info',
  pending: 'badge-warn',
  waiting: 'badge-warn',
  in_progress: 'badge-info',
  complete: 'badge-success',
  completed: 'badge-success',
  success: 'badge-success',
  succeeded: 'badge-success',
  approved: 'badge-success',
  enabled: 'badge-success',
  active: 'badge-success',
  healthy: 'badge-success',
  online: 'badge-success',
  failed: 'badge-danger',
  failed_permanent: 'badge-danger',
  error: 'badge-danger',
  cancelled: 'badge-muted',
  canceled: 'badge-muted',
  rejected: 'badge-danger',
  disabled: 'badge-muted',
  offline: 'badge-danger',
  paused: 'badge-warn',
  open: 'badge-warn',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  const cls = STATUS_CLASSES[key] ?? 'badge-neutral';
  return <span className={`status-badge ${cls}`}>{status}</span>;
}