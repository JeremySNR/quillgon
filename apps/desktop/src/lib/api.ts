import type { Job } from './types';

declare global {
  interface Window {
    quillgon?: { apiBase?: string; platform?: string; chooseFolder?: () => Promise<string | null>; reveal?: (p: string) => void };
  }
}

const BASE = window.quillgon?.apiBase ?? '';
/** The server injects a per-launch API token into index.html (the dev server does the same). */
const TOKEN = document.querySelector<HTMLMetaElement>('meta[name="quillgon-token"]')?.content ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, init?: { keepalive?: boolean }): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'x-quillgon-token': TOKEN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // keepalive lets a save started while the page unloads finish (bodies up to 64 KB).
    keepalive: init?.keepalive,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText, json);
  return json as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown, init?: { keepalive?: boolean }) => api<T>('PUT', p, b, init);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

type Listener = (type: string, data: any) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let dropped = false;

function emit(type: string, data: unknown) {
  for (const l of listeners) {
    try {
      l(type, data);
    } catch (e) {
      console.error(e);
    }
  }
}

function connect() {
  retryTimer = null;
  const es = new EventSource(`${BASE}/api/events?token=${encodeURIComponent(TOKEN)}`);
  source = es;
  for (const t of ['store', 'reloaded', 'job', 'hello']) {
    es.addEventListener(t, (e) => {
      let data: unknown = {};
      try {
        data = JSON.parse((e as MessageEvent).data || '{}');
      } catch {
        return;
      }
      emit(t, data);
    });
  }
  es.onopen = () => {
    retryDelay = 1000;
    // Events sent while we were disconnected are lost: tell listeners to catch up.
    if (dropped) (dropped = false), emit('reconnected', {});
  };
  es.onerror = () => {
    dropped = true;
    // The browser retries by itself while CONNECTING; once CLOSED (an HTTP error, a server
    // restart that refused us) it gives up, so reconnect with backoff.
    if (es.readyState !== EventSource.CLOSED) return;
    es.close();
    if (source === es) source = null;
    if (!retryTimer && listeners.size) {
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  };
}

/** Listen to server events (store changes, jobs). Also receives a synthetic 'reconnected' after the stream drops. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  if (!source && !retryTimer) connect();
  return () => listeners.delete(fn);
}

/** Start a background job and resolve with its result. Progress arrives via onProgress. */
export async function runJob<T = any>(path: string, body: unknown = {}, onProgress?: (j: Job) => void): Promise<T> {
  const { job } = await post<{ job: string }>(path, body);
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (j: Job) => {
      if (done) return;
      if (j.state === 'done') (done = true), off(), clearInterval(poll), resolve(j.result as T);
      else if (j.state === 'error') (done = true), off(), clearInterval(poll), reject(new ApiError(400, j.error ?? 'failed'));
      else onProgress?.(j);
    };
    const off = subscribe((type, data) => {
      if (type === 'job' && data.id === job) finish(data);
    });
    // Fast jobs can finish before we subscribed, and SSE can drop: check now, then poll.
    const check = () => get<Job>(`/jobs/${job}`).then(finish).catch(() => undefined);
    const poll = setInterval(check, 1000);
    check();
  });
}
