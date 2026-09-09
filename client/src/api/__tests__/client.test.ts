import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../client';

describe('api client', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses a successful JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/test')).resolves.toEqual({ ok: true });
    const called = fetchMock.mock.calls[0];
    expect(called[0]).toBe('/api/v1/test');
    expect(called[1].credentials).toBe('include');
  });

  it('dispatches auth:unauthorized on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    );
    const dispatched = vi.fn();
    window.addEventListener('auth:unauthorized', dispatched);

    await expect(api.get('/test')).rejects.toThrow('Unauthorized');
    expect(dispatched).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth:unauthorized', dispatched);
  });

  it('rejects with a timeout error when the request never settles', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_res, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = api.get('/slow').catch((err) => err);
    await vi.advanceTimersByTimeAsync(31000);
    const err = await promise;
    expect((err as Error).message).toBe('Request timed out after 30s');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});