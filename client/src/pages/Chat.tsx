import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { RealtimeContext } from '../context/RealtimeContext';
import {
  Approval,
  Conversation,
  Message,
  Task,
} from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineError,
  LoadingBlock,
  Modal,
  StatusBadge,
  TextField,
  TimeText,
} from '../components/Ui';

interface LiveTask extends Partial<Task> {
  id: string;
  status?: string;
  title?: string;
  approval_state?: string | null;
}

interface StreamEntry {
  taskId: string;
  chunk: string;
  stream?: string;
}

export default function Chat() {
  const { connected, subscribe } = useContext(RealtimeContext);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationError, setConversationError] = useState('');
  const [messagesError, setMessagesError] = useState('');
  const [sendError, setSendError] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [liveTasks, setLiveTasks] = useState<Record<string, LiveTask>>({});
  const [approvals, setApprovals] = useState<Record<string, Approval>>({});
  const [responding, setResponding] = useState<Record<string, 'approve' | 'reject' | undefined>>(
    {}
  );
  const streamRef = useRef<Record<string, string>>({});
  const [streams, setStreams] = useState<Record<string, StreamEntry[]>>({});
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadConversations = useCallback(async (query = search, archived = showArchived) => {
    setLoadingConversations(true);
    setConversationError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set('search', query.trim());
      }
      if (archived) {
        params.set('archived', 'true');
      }
      const data = await api.get<{ conversations: Conversation[] }>(
        `/chat/conversations${params.toString() ? `?${params.toString()}` : ''}`
      );
      setConversations(data.conversations);
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoadingConversations(false);
    }
  }, [search, showArchived]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const fetchMessages = useCallback(async (id: string) => {
    setLoadingMessages(true);
    setMessagesError('');
    try {
      const data = await api.get<{ messages: Message[] }>(`/chat/conversations/${id}/messages`);
      setMessages(data.messages);
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const selectConversation = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setMessages([]);
      setSendError('');
      streamRef.current = {};
      setStreams({});
      if (id) {
        fetchMessages(id);
      }
    },
    [fetchMessages]
  );

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, streams]);

  const upsertMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const existingIdx = prev.findIndex((m) => m.id === msg.id);
      if (existingIdx !== -1) {
        const next = [...prev];
        next[existingIdx] = msg;
        return next;
      }
      if (prev.some((m) => m.role === msg.role && m.content === msg.content)) {
        return prev;
      }
      return [...prev, msg];
    });
  }, []);

  useEffect(() => {
    const unsubTask = subscribe('task:status', (data) => {
      const d = data as Record<string, unknown>;
      const id = (d.taskId ?? d.task_id ?? d.id) as string | undefined;
      if (id) {
        setLiveTasks((prev) => ({ ...prev, [id]: d as unknown as LiveTask }));
        const status = d.status as string;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          setSelectedId((cur) => {
            if (cur) {
              fetchMessages(cur);
            }
            return cur;
          });
        }
      }
    });
    const unsubOutput = subscribe('task:output', (data) => {
      const d = data as Record<string, unknown>;
      const taskId = (d.taskId ?? d.task_id) as string;
      if (!taskId) {
        return;
      }
      const chunk = (d.chunk ?? '') as string;
      const prev = streamRef.current[taskId] ?? '';
      streamRef.current[taskId] = prev + chunk;
      setStreams((cur) => ({
        ...cur,
        [taskId]: [
          ...(cur[taskId] ?? []),
          { taskId, chunk, stream: d.stream as string | undefined },
        ],
      }));
    });
    const unsubApprovalNew = subscribe('approval:new', (data) => {
      const d = data as Approval;
      if (d.id) {
        setApprovals((prev) => ({ ...prev, [d.id]: d }));
      }
    });
    const unsubApprovalResponded = subscribe('approval:responded', (data) => {
      const d = data as Approval;
      if (d.id) {
        setApprovals((prev) => ({ ...prev, [d.id]: d }));
      }
    });
    const unsubChat = subscribe('chat:event', (data) => {
      const d = data as Record<string, unknown>;
      const eventId = (d.conversationId ?? d.conversation_id) as string | undefined;
      if (eventId && selectedId && eventId === selectedId) {
        const msg = d.message as Message | undefined;
        if (msg && msg.id) {
          upsertMessage(msg);
        }
      }
    });
    return () => {
      unsubTask();
      unsubOutput();
      unsubApprovalNew();
      unsubApprovalResponded();
      unsubChat();
    };
  }, [subscribe, selectedId, fetchMessages, upsertMessage]);

  const createConversation = async () => {
    try {
      const data = await api.post<{ conversation: Conversation }>('/chat/conversations', {
        title: newTitle.trim() || undefined,
      });
      setShowNewModal(false);
      setNewTitle('');
      setConversations((prev) => [data.conversation, ...prev]);
      selectConversation(data.conversation.id);
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : 'Failed to create conversation');
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || !selectedId || sending) {
      return;
    }
    setInput('');
    setSendError('');
    setSending(true);
    const optimisticId = `tmp-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      conversation_id: selectedId,
      role: 'user',
      content,
      meta: { pending: true },
      task_id: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const data = await api.post<{
        message: Message;
        taskId?: string | null;
        reply?: string;
      }>(`/chat/conversations/${selectedId}/messages`, { content });
      setMessages((prev) => prev.map((m) => (m.id === optimisticId ? data.message : m)));
      if (data.taskId) {
        setLiveTasks((prev) => ({
          ...prev,
          [data.taskId as string]: { id: data.taskId as string, status: 'queued' },
        }));
      }
      if (data.reply && data.reply.trim()) {
        upsertMessage({
          id: `reply-${data.taskId ?? Date.now()}`,
          conversation_id: selectedId,
          role: 'assistant',
          content: data.reply,
          meta: { fromReply: true },
          task_id: data.taskId ?? null,
          created_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const updateConversation = async (id: string, patch: Partial<Conversation>) => {
    try {
      const data = await api.patch<{ conversation: Conversation }>(
        `/chat/conversations/${id}`,
        patch
      );
      setConversations((prev) => prev.map((c) => (c.id === id ? data.conversation : c)));
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : 'Failed to update conversation');
    }
  };

  const deleteConversation = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await api.del<{ ok: boolean }>(`/chat/conversations/${deleteTarget.id}`);
      setConversations((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        selectConversation(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : 'Failed to delete conversation');
    } finally {
      setDeleting(false);
    }
  };

  const respondToApproval = async (id: string, approve: boolean) => {
    setResponding((prev) => ({ ...prev, [id]: approve ? 'approve' : 'reject' }));
    try {
      const data = await api.post<{ approval: Approval }>(`/approvals/${id}/respond`, {
        approve,
      });
      setApprovals((prev) => ({ ...prev, [id]: data.approval }));
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : 'Failed to respond');
    } finally {
      setResponding((prev) => ({ ...prev, [id]: undefined }));
    }
  };

  const liveTaskEntries = Object.values(liveTasks);
  const streamTasks = liveTaskEntries.filter((t) => streams[t.id]);

  return (
    <div className="chat-page">
      <div className="chat-sidebar">
        <div className="chat-sidebar-head">
          <Button variant="primary" onClick={() => setShowNewModal(true)}>
            New conversation
          </Button>
          <div className="chat-search">
            <input
              className="input"
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                loadConversations(e.target.value, showArchived);
              }}
            />
          </div>
          <label className="chat-archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => {
                setShowArchived(e.target.checked);
                loadConversations(search, e.target.checked);
              }}
            />
            Show archived
          </label>
        </div>
        <div className="conversation-list">
          {loadingConversations ? (
            <LoadingBlock label="Loading conversations" />
          ) : conversations.length === 0 ? (
            <EmptyState
              title="No conversations"
              hint={showArchived ? 'No archived conversations' : 'Start a new conversation'}
            />
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`conversation-item ${selectedId === c.id ? 'conversation-item-active' : ''}`}
                onClick={() => selectConversation(c.id)}
              >
                <div className="conversation-title">{c.title || 'Untitled'}</div>
                <div className="conversation-meta">
                  <span>{c.archived ? 'archived' : 'active'}</span>
                  <TimeText value={c.updated_at} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="chat-main">
        <div className="chat-context">
          {conversationError && <InlineError message={conversationError} />}
          {messagesError && <InlineError message={messagesError} />}
          {!selectedId && (
            <EmptyState
              title="Select a conversation"
              hint="Choose a conversation on the left or start a new one"
            />
          )}
        </div>

        {selectedId && (
          <div className="chat-pane">
            <div className="thread" ref={threadRef}>
              {messages.map((m) => (
                <div key={m.id} className={`bubble bubble-${m.role}`}>
                  <div className="bubble-role">{m.role}</div>
                  <div className="bubble-content monospace-wrap">{m.content}</div>
                  {m.task_id && (
                    <div className="bubble-task">
                      <StatusBadge status={liveTasks[m.task_id]?.status ?? 'unknown'} />
                    </div>
                  )}
                </div>
              ))}

              {liveTaskEntries.map((t) => {
                const output = streams[t.id];
                const isActive =
                  t.status === 'queued' || t.status === 'running' || t.status === 'in_progress';
                return (
                  <div key={t.id} className={`task-activity ${isActive ? 'task-active' : ''}`}>
                    <div className="task-activity-head">
                      <span className="task-activity-title">{t.title || 'Agent task'}</span>
                      <StatusBadge status={t.status ?? 'unknown'} />
                    </div>
                    {t.approval_state && t.approval_state !== 'none' && (
                      <div className="approval-inline">
                        <span>Approval {t.approval_state}</span>
                      </div>
                    )}
                    {output && output.length > 0 && (
                      <pre className="task-output">
                        {output.map((o, i) => (
                          <span key={i}>{o.chunk}</span>
                        ))}
                      </pre>
                    )}
                    {isActive && <div className="task-pulse">working</div>}
                  </div>
                );
              })}

              {Object.values(approvals).map((a) => (
                <div key={a.id} className="approval-card">
                  <div className="task-activity-head">
                    <span className="task-activity-title">Approval requested</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="approval-desc">{a.description}</div>
                  <div className="approval-meta">
                    <span>{a.type}</span>
                    <span className={`risk risk-${a.risk_level}`}>risk: {a.risk_level}</span>
                    <TimeText value={a.requested_at} />
                  </div>
                  {a.status === 'pending' && (
                    <div className="approval-actions">
                      <Button
                        variant="success"
                        disabled={!!responding[a.id]}
                        onClick={() => respondToApproval(a.id, true)}
                      >
                        {responding[a.id] === 'approve' ? 'Approving...' : 'Approve'}
                      </Button>
                      <Button
                        variant="danger"
                        disabled={!!responding[a.id]}
                        onClick={() => respondToApproval(a.id, false)}
                      >
                        {responding[a.id] === 'reject' ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </div>
                  )}
                  {a.reviewer_note && <div className="approval-note">{a.reviewer_note}</div>}
                </div>
              ))}
            </div>

            {streamTasks.length > 0 && (
              <div className="task-summary">
                {streamTasks.map((t) => (
                  <span key={t.id} className="tag">
                    {t.title || t.id} streaming
                  </span>
                ))}
              </div>
            )}

            <div className="composer">
              {sendError && <InlineError message={sendError} />}
              <div className="composer-row">
                <textarea
                  ref={inputRef}
                  className="input composer-input"
                  placeholder={connected ? 'Message AgentOS...' : 'Realtime disconnected - send may fail'}
                  value={input}
                  rows={2}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <Button
                  variant="primary"
                  onClick={sendMessage}
                  disabled={!input.trim() || sending || !selectedId}
                >
                  {sending ? 'Working...' : 'Send'}
                </Button>
              </div>
              <div className="composer-hint">Enter to send, Shift+Enter for a new line</div>
            </div>
          </div>
        )}
      </div>

      {showNewModal && (
        <Modal
          title="New conversation"
          onClose={() => setShowNewModal(false)}
          width="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setShowNewModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={createConversation}>
                Create
              </Button>
            </>
          }
        >
          <TextField
            label="Title"
            value={newTitle}
            onChange={setNewTitle}
            placeholder="Leave blank for auto title"
            autoFocus
          />
        </Modal>
      )}

      {renameTarget && (
        <Modal
          title="Rename conversation"
          onClose={() => setRenameTarget(null)}
          width="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  await updateConversation(renameTarget.id, { title: renameTitle.trim() });
                  setRenameTarget(null);
                }}
              >
                Rename
              </Button>
            </>
          }
        >
          <TextField label="Title" value={renameTitle} onChange={setRenameTitle} autoFocus />
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete conversation"
          message={`Delete "${deleteTarget.title || 'Untitled'}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={deleteConversation}
        />
      )}
    </div>
  );
}