import { createContext, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Handler = (data: unknown) => void;

interface RealtimeContextValue {
  connected: boolean;
  subscribe: (event: string, handler: Handler) => () => void;
}

export const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  subscribe: () => () => {},
});

const EVENT_NAME_MAP: Record<string, string> = {
  'task:status': 'task:status',
  'task:output': 'task:output',
  'task:opencode': 'task:opencode',
  'approval:new': 'approval:new',
  'approval:responded': 'approval:responded',
  'chat:event': 'chat:event',
  'memory:event': 'memory:event',
  'automation:event': 'automation:event',
  'system:status': 'system:status',
  task_status: 'task:status',
  task_output: 'task:output',
  task_opencode: 'task:opencode',
  approval_new: 'approval:new',
  approval_responded: 'approval:responded',
  chat_event: 'chat:event',
  memory_event: 'memory:event',
  automation_event: 'automation:event',
  system_status: 'system:status',
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<Handler>>>(new Map());
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/v1/realtime/events');
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (e) => {
      let data: unknown = null;
      try {
        data = JSON.parse(e.data);
      } catch {
        data = e.data;
      }
      const handlers = listenersRef.current.get('message');
      if (handlers) {
        handlers.forEach((h) => h(data));
      }
    };

    const register = (name: string, mapped: string) => {
      source.addEventListener(name, (e: MessageEvent) => {
        let data: unknown = null;
        try {
          data = JSON.parse(e.data);
        } catch {
          data = e.data;
        }
        const handlers = listenersRef.current.get(mapped);
        if (handlers) {
          handlers.forEach((h) => h(data));
        }
      });
    };

    Object.entries(EVENT_NAME_MAP).forEach(([sseName, mapped]) => register(sseName, mapped));

    return () => {
      source.close();
      sourceRef.current = null;
      listenersRef.current.forEach((set) => set.clear());
    };
  }, []);

  const subscribe = useCallback((event: string, handler: Handler) => {
    let set = listenersRef.current.get(event);
    if (!set) {
      set = new Set();
      listenersRef.current.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }, []);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}