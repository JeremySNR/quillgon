import type { Job } from './types';

declare global {
  interface Window {
    novel?: { apiBase?: string; platform?: string; chooseFolder?: () => Promise<string | null>; reveal?: (p: string) => void };
  }
}

const BASE = window.novel?.apiBase ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText, json);
  return json as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

type Listener = (type: string, data: any) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  if (!source) {
    source = new EventSource(`${BASE}/api/events`);
    for (const t of ['store', 'reloaded', 'job', 'hello']) {
      source.addEventListener(t, (e) => {
        const data = JSON.parse((e as MessageEvent).data || '{}');
        for (const l of listeners) l(t, data);
      });
    }
  }
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
