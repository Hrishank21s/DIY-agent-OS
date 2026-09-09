import { useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import { RealtimeContext } from '../context/RealtimeContext';
import { Approval } from '../types';
import {
  Button,
  EmptyState,
  InlineError,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusBadge,
  TextArea,
  TimeText,
} from '../components/Ui';

type ApprovalFilter = '' | 'pending' | 'approved' | 'rejected';

const FILTERS: { value: ApprovalFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function Approvals() {
  const { subscribe } = useContext(RealtimeContext);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [filter, setFilter] = useState<ApprovalFilter>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [responding, setResponding] = useState<Approval | null>(null);
  const [note, setNote] = useState('');
  const [respondBusy, setRespondBusy] = useState(false);
  const [respondError, setRespondError] = useState('');

  const load = useCallback(async (status: ApprovalFilter = filter) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) {
        params.set('status', status);
      }
      const data = await api.get<{ approvals: Approval[] }>(
        `/approvals${params.toString() ? `?${params}` : ''}`
      );
      setApprovals(data.approvals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsubNew = subscribe('approval:new', (data) => {
      const a = data as Approval;
      if (a.id) {
        setApprovals((prev) => (prev.some((x) => x.id === a.id) ? prev : [a, ...prev]));
      }
    });
    const unsubResponded = subscribe('approval:responded', (data) => {
      const a = data as Approval;
      if (a.id) {
        setApprovals((prev) => prev.map((x) => (x.id === a.id ? a : x)));
      }
    });
    return () => {
      unsubNew();
      unsubResponded();
    };
  }, [subscribe]);

  const beginRespond = (a: Approval) => {
    setResponding(a);
    setNote('');
    setRespondError('');
  };

  const submitRespond = async (approve: boolean) => {
    if (!responding) {
      return;
    }
    setRespondBusy(true);
    setRespondError('');
    try {
      const data = await api.post<{ approval: Approval }>(`/approvals/${responding.id}/respond`, {
        approve,
        note: note || undefined,
      });
      setApprovals((prev) => prev.map((x) => (x.id === data.approval.id ? data.approval : x)));
      setResponding(null);
    } catch (err) {
      setRespondError(err instanceof Error ? err.message : 'Failed to respond');
    } finally {
      setRespondBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Approvals"
        subtitle="Review requests before agents perform sensitive actions"
      />
      <div className="filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`filter-chip ${filter === f.value ? 'filter-chip-active' : ''}`}
            onClick={() => {
              setFilter(f.value);
              load(f.value);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <InlineError message={error} />}

      {loading ? (
        <LoadingBlock label="Loading approvals" />
      ) : approvals.length === 0 ? (
        <EmptyState title="No approvals" hint="Nothing requires review right now" />
      ) : (
        <div className="card-grid">
          {approvals.map((a) => (
            <div key={a.id} className={`card approval-card approval-${a.status}`}>
              <div className="card-head">
                <div>
                  <div className="card-title">{a.type}</div>
                  <div className="card-sub">
                    task {a.task_id?.slice(0, 8) ?? '-'} · agent {a.agent_id?.slice(0, 8) ?? 'default'}
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <p className="card-body">{a.description}</p>
              {a.payload && (
                <pre className="code-block">{JSON.stringify(a.payload, null, 2)}</pre>
              )}
              <div className="meta-row">
                <span className={`risk risk-${a.risk_level}`}>risk: {a.risk_level}</span>
                <span>requested <TimeText value={a.requested_at} /></span>
              </div>
              <div className="meta-row muted">
                {a.responded_at && <span>responded <TimeText value={a.responded_at} /></span>}
                {a.responded_by && <span>by {a.responded_by}</span>}
              </div>
              {a.reviewer_note && <div className="approval-note">note: {a.reviewer_note}</div>}
              {a.status === 'pending' && (
                <div className="card-actions">
                  <Button variant="success" onClick={() => beginRespond(a)}>
                    Approve
                  </Button>
                  <Button variant="danger" onClick={() => beginRespond(a)}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {responding && (
        <Modal
          title={`${responding.status === 'pending' ? 'Review' : 'Respond to'} approval request`}
          onClose={() => setResponding(null)}
          width="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setResponding(null)}>
                Cancel
              </Button>
              <Button
                variant="success"
                onClick={() => submitRespond(true)}
                disabled={respondBusy}
              >
                {respondBusy ? 'Working...' : 'Approve'}
              </Button>
              <Button
                variant="danger"
                onClick={() => submitRespond(false)}
                disabled={respondBusy}
              >
                {respondBusy ? 'Working...' : 'Reject'}
              </Button>
            </>
          }
        >
          <TextArea
            label="Reviewer note (optional)"
            value={note}
            onChange={setNote}
            rows={3}
          />
          {respondError && <InlineError message={respondError} />}
        </Modal>
      )}
    </div>
  );
}