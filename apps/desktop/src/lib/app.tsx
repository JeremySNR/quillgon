import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, post, runJob, subscribe } from './api';
import type { Job, Snapshot } from './types';

export type View = 'dashboard' | 'build' | 'outline' | 'scene' | 'ripple' | 'threads' | 'characters' | 'reader' | 'covers' | 'history' | 'settings';
export interface Route {
  view: View;
  id?: string;
}

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warning';
  message: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  project: Snapshot | null;
  loading: boolean;
  openDir: string | null;
  route: Route;
  go: (r: Route | View, id?: string) => void;
  refresh: () => Promise<void>;
  toast: (t: Omit<Toast, 'id'>) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  jobs: Job[];
  /** Run a background job with status-bar progress and error toasts. */
  job: <T = any>(path: string, body?: unknown, label?: string) => Promise<T>;
  savedAt: number | null;
  markSaved: () => void;
  palette: boolean;
  setPalette: (v: boolean) => void;
  focus: boolean;
  setFocus: (v: boolean) => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, id] = h.split('/');
  return { view: (view as View) || 'dashboard', id: id ? decodeURIComponent(id) : undefined };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [openDir, setOpenDir] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [focus, setFocus] = useState(false);
  const seq = useRef(0);
  const refreshTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const h = await get<{ open: string | null }>('/health').catch(() => ({ open: null }));
    setOpenDir(h.open);
    if (!h.open) {
      setProject(null);
      setLoading(false);
      return;
    }
    const p = await get<Snapshot>('/project').catch(() => null);
    setProject(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    const off = subscribe((type, data) => {
      if (type === 'job') {
        setJobs((js) => {
          const rest = js.filter((j) => j.id !== data.id);
          return data.state === 'running' ? [...rest, data] : rest;
        });
      }
      if (type === 'store' || type === 'reloaded') {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(refresh, 250);
      }
    });
    return () => {
      window.removeEventListener('hashchange', onHash);
      off();
    };
  }, [refresh]);

  const go = useCallback((r: Route | View, id?: string) => {
    const next = typeof r === 'string' ? { view: r, id } : r;
    location.hash = `/${next.view}${next.id ? `/${encodeURIComponent(next.id)}` : ''}`;
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.action ? 6500 : t.kind === 'error' ? 8000 : 3500);
    },
    [dismiss],
  );

  const job = useCallback(
    async <T,>(path: string, body: unknown = {}, label?: string): Promise<T> => {
      try {
        return await runJob<T>(path, body);
      } catch (e) {
        toast({ kind: 'error', message: label ? `${label} failed` : 'Something went wrong', detail: (e as Error).message });
        throw e;
      } finally {
        refresh();
      }
    },
    [toast, refresh],
  );

  const markSaved = useCallback(() => setSavedAt(Date.now()), []);

  const value = useMemo<AppState>(
    () => ({ project, loading, openDir, route, go, refresh, toast, toasts, dismiss, jobs, job, savedAt, markSaved, palette, setPalette, focus, setFocus }),
    [project, loading, openDir, route, go, refresh, toast, toasts, dismiss, jobs, job, savedAt, markSaved, palette, focus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Open a project folder and reload. */
export async function openProject(dir: string) {
  await post('/open', { dir });
}
