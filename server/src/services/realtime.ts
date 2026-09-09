import { EventEmitter } from 'node:events';

export interface HubEvent {
  type: string;
  ts?: number;
  [key: string]: unknown;
}

/**
 * In-process event bus used to fan task/output events out to SSE and WebSocket
 * connections, and to coordinate between the worker and the UI.
 */
class RealtimeHub extends EventEmitter {
  private history: HubEvent[] = [];
  private maxHistory = 2000;

  emit(type: string, payload: Record<string, unknown> = {}): boolean {
    const evt: HubEvent = { type, ...payload, ts: Date.now() };
    this.history.push(evt);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    return super.emit('*', evt);
  }

  subscribe(listener: (evt: HubEvent) => void): () => void {
    this.on('*', listener);
    return () => this.off('*', listener);
  }

  getHistory(): HubEvent[] {
    return this.history.slice();
  }
}

export const hub = new RealtimeHub();

// Standard event builders
export const emitTaskStatus = (taskId: string, status: string, extra: Record<string, unknown> = {}) =>
  hub.emit('task:status', { taskId, status, ...extra });
export const emitTaskOutput = (taskId: string, chunk: string, stream: string = 'stdout') =>
  hub.emit('task:output', { taskId, chunk, stream });
export const emitApproval = (approvalId: string, data: Record<string, unknown> = {}) =>
  hub.emit('approval:new', { approvalId, ...data });
export const emitApprovalResponded = (approvalId: string, status: string) =>
  hub.emit('approval:responded', { approvalId, status });
export const emitSystemStatus = (data: Record<string, unknown>) =>
  hub.emit('system:status', data);
export const emitAutomationEvent = (data: Record<string, unknown>) =>
  hub.emit('automation:event', data);
export const emitMemoryEvent = (data: Record<string, unknown>) =>
  hub.emit('memory:event', data);
export const emitChatEvent = (conversationId: string, data: Record<string, unknown>) =>
  hub.emit('chat:event', { conversationId, ...data });