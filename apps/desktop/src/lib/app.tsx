import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, post, runJob, subscribe } from './api';
import type { Job, Snapshot } from './types';
import { allowUnload, describeUnsaved, flushUnsaved, installUnloadGuard, unsavedChanges } from './unsaved';
import { useConfirm } from '../components/confirm';

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
  /** Set when an autosave failed (cleared by the next successful save). */
  saveProblem: string | null;
  markSaveFailed: (message: string | null) => void;
  /** A catch handler that reports a failure as an error toast (unless it was already reported). */
  fail: (message: string) => (e: unknown) => void;
  palette: boolean;
  setPalette: (v: boolean) => void;
  focus: boolean;
  setFocus: (v: boolean) => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

const REPORTED = Symbol.for('quillgon.reported');
/** Mark an error as already shown to the user, so the global handler does not toast it twice. */
export function markReported<E>(e: E): E {
  if (e && typeof e === 'object') (e as Record<symbol, unknown>)[REPORTED] = true;
  return e;
}
export const isReported = (e: unknown) => !!(e && typeof e === 'object' && (e as Record<symbol, unknown>)[REPORTED]);
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Unknown error');

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
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [focus, setFocus] = useState(false);
  const seq = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const confirm = useConfirm();
  /** The hash we last routed to, and whether the next hashchange was already approved. */
  const currentHash = useRef(location.hash);
  const navApproved = useRef(false);

  /** Ask before navigating away from unsaved edits. Resolves true when it is fine to leave. */
  const confirmLeave = useCallback(
    (what = unsavedChanges('navigate'), leaving = 'leave') =>
      what.length
        ? confirm({
            title: 'Discard unsaved changes?',
            message: `You have unsaved ${describeUnsaved(what)}. If you ${leaving} now they will be lost.`,
            confirmLabel: `Discard and ${leaving}`,
            cancelLabel: 'Keep editing',
            danger: true,
          })
        : Promise.resolve(true),
    [confirm],
  );

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
    const onHash = () => {
      // Back/forward and plain links bypass go(); put the old address back and ask first.
      if (!navApproved.current && location.hash !== currentHash.current && unsavedChanges('navigate').length) {
        const target = location.hash;
        history.replaceState(history.state, '', `${location.pathname}${location.search}${currentHash.current}`);
        confirmLeave().then((ok) => {
          if (!ok) return;
          navApproved.current = true;
          location.hash = target;
        });
        return;
      }
      navApproved.current = false;
      currentHash.current = location.hash;
      setRoute(parseHash());
    };
    window.addEventListener('hashchange', onHash);
    const off = subscribe((type, data) => {
      if (type === 'job') {
        setJobs((js) => {
          const rest = js.filter((j) => j.id !== data.id);
          return data.state === 'running' ? [...rest, data] : rest;
        });
      }
      if (type === 'store' || type === 'reloaded' || type === 'reconnected') {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(refresh, 250);
      }
    });
    return () => {
      window.removeEventListener('hashchange', onHash);
      off();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refresh, confirmLeave]);

  const go = useCallback(
    (r: Route | View, id?: string) => {
      const next = typeof r === 'string' ? { view: r, id } : r;
      const hash = `#/${next.view}${next.id ? `/${encodeURIComponent(next.id)}` : ''}`;
      if (hash === location.hash) return;
      const navigate = () => {
        navApproved.current = true;
        location.hash = hash;
      };
      // Navigate synchronously when nothing is unsaved, so callers can rely on the hash having changed.
      if (!unsavedChanges('navigate').length) navigate();
      else confirmLeave().then((ok) => ok && navigate());
    },
    [confirmLeave],
  );

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.action ? 6500 : t.kind === 'error' ? 8000 : 3500);
    },
    [dismiss],
  );

  const fail = useCallback(
    (message: string) => (e: unknown) => {
      if (isReported(e)) return;
      markReported(e);
      toast({ kind: 'error', message, detail: errorMessage(e) });
    },
    [toast],
  );

  const job = useCallback(
    async <T,>(path: string, body: unknown = {}, label?: string): Promise<T> => {
      try {
        return await runJob<T>(path, body);
      } catch (e) {
        fail(label ? `${label} failed` : 'Something went wrong')(e);
        throw e;
      } finally {
        refresh();
      }
    },
    [fail, refresh],
  );

  // Last-resort reporting: a promise nobody caught still reaches the user as a toast.
  useEffect(() => {
    const h = (e: PromiseRejectionEvent) => {
      if (isReported(e.reason)) {
        e.preventDefault();
        return;
      }
      fail('Something went wrong')(e.reason);
    };
    window.addEventListener('unhandledrejection', h);
    return () => window.removeEventListener('unhandledrejection', h);
  }, [fail]);

  // Closing or reloading the window with unsaved edits. Electron closes without a prompt, so
  // handle it in-app there: save what can be saved (pending prose), close if that was all,
  // otherwise ask. Closing quits the app and stops the server, so saves must land first.
  useEffect(
    () =>
      installUnloadGuard(
        window.quillgon
          ? () =>
              void (async () => {
                await flushUnsaved();
                const left = unsavedChanges('unload');
                if (left.length && !(await confirmLeave(left, 'close'))) return;
                allowUnload();
                window.close();
              })()
          : undefined,
      ),
    [confirmLeave],
  );

  const markSaved = useCallback(() => (setSavedAt(Date.now()), setSaveProblem(null)), []);
  const markSaveFailed = useCallback((message: string | null) => setSaveProblem(message), []);

  const value = useMemo<AppState>(
    () => ({ project, loading, openDir, route, go, refresh, toast, toasts, dismiss, jobs, job, savedAt, markSaved, saveProblem, markSaveFailed, fail, palette, setPalette, focus, setFocus }),
    [project, loading, openDir, route, go, refresh, toast, toasts, dismiss, jobs, job, savedAt, markSaved, saveProblem, markSaveFailed, fail, palette, focus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Open a project folder and reload. */
export async function openProject(dir: string) {
  await post('/open', { dir });
}
