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
}

const entries = new Set<Entry>();

/** Descriptions of everything currently unsaved. `unload` includes entries that only guard closing the window. */
export function unsavedChanges(scope: 'navigate' | 'unload' = 'navigate'): string[] {
  const out: string[] = [];
  for (const e of entries) if ((scope === 'unload' || e.inApp) && e.dirty()) out.push(e.what);
  return out;
}

export function useUnsavedChanges(dirty: boolean | (() => boolean), what: string, { inApp = true }: { inApp?: boolean } = {}) {
  const ref = useRef(dirty);
  ref.current = dirty;
  useEffect(() => {
    const entry: Entry = { what, inApp, dirty: () => (typeof ref.current === 'function' ? ref.current() : ref.current) };
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
 * Block closing or reloading while something is unsaved. Browsers show their own prompt;
 * Electron's main process shows a native one (will-prevent-unload). `onBlocked` is for
 * hosts that do neither.
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
