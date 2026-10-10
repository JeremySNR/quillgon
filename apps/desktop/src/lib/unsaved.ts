import { useEffect, useRef } from 'react';

/**
 * Unsaved-change registry. Views register what they would lose ("scene card edits"); in-app
 * navigation asks before discarding them and closing or reloading the window is blocked.
 */
interface Entry {
  what: string;
  dirty: () => boolean;
  /** false: only guard window unload (the view saves on unmount by itself). */
  inApp: boolean;
  /** Try to save now; resolves true once nothing is left unsaved. */
  flush?: () => Promise<boolean>;
}

const entries = new Set<Entry>();

/** Descriptions of everything currently unsaved. `unload` includes entries that only guard closing the window. */
export function unsavedChanges(scope: 'navigate' | 'unload' = 'navigate'): string[] {
  const out: string[] = [];
  for (const e of entries) if ((scope === 'unload' || e.inApp) && e.dirty()) out.push(e.what);
  return out;
}

/** Save whatever can be saved right now (e.g. pending autosaves) before asking about the rest. */
export async function flushUnsaved(): Promise<void> {
  await Promise.all([...entries].filter((e) => e.flush && e.dirty()).map((e) => e.flush!().catch(() => false)));
}

export function useUnsavedChanges(dirty: boolean | (() => boolean), what: string, { inApp = true, flush }: { inApp?: boolean; flush?: () => Promise<boolean> } = {}) {
  const ref = useRef(dirty);
  ref.current = dirty;
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const entry: Entry = {
      what,
      inApp,
      dirty: () => (typeof ref.current === 'function' ? ref.current() : ref.current),
      flush: () => (flushRef.current ? flushRef.current() : Promise.resolve(false)),
    };
    entries.add(entry);
    return () => void entries.delete(entry);
  }, [what, inApp]);
}

/** "scene card edits and style dials" */
export function describeUnsaved(what: string[]): string {
  const unique = [...new Set(what)];
  if (unique.length <= 1) return unique[0] ?? 'changes';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

let bypass = false;
/** Let the next unload through without asking (after the user chose to discard). */
export function allowUnload() {
  bypass = true;
}

/**
 * Block closing or reloading while something is unsaved. Browsers show their own prompt.
 * Electron closes silently instead of prompting, so there `onBlocked` gets a chance to ask
 * in-app and then call allowUnload() and window.close().
 */
export function installUnloadGuard(onBlocked?: (what: string[]) => void): () => void {
  const h = (e: BeforeUnloadEvent) => {
    if (bypass) return;
    const what = unsavedChanges('unload');
    if (!what.length) return;
    e.preventDefault();
    // Legacy browsers (and Electron) look at returnValue.
    e.returnValue = '';
    onBlocked?.(what);
  };
  window.addEventListener('beforeunload', h);
  return () => window.removeEventListener('beforeunload', h);
}
