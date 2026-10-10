import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface AutosaveOptions<R> {
  /** Which document the text belongs to (the scene id). Changing it flushes the old one. */
  docKey: string;
  /** Persist text. `keepalive` is set when the page is unloading. */
  save: (key: string, text: string, opts: { keepalive: boolean }) => Promise<R>;
  onSaved?: (result: R, key: string, text: string) => void;
  /** A save failed. `retry` re-sends exactly that text (useful after the editor has gone). */
  onError?: (error: unknown, key: string, retry: () => Promise<boolean>) => void;
  delay?: number;
}

export interface ProseAutosave {
  /** The text the editor shows: always the user's latest, saved or not. */
  text: string;
  /** Record an edit and schedule a save. */
  edit: (text: string) => void;
  /** Save now if anything is unsaved. Resolves true once the server has the latest text. */
  flush: () => Promise<boolean>;
  /**
   * Take text from the server, unless the user has edits it does not have yet. Pass the
   * revision() read when the request started to also refuse answers that raced an edit or save.
   * Returns whether it was taken.
   */
  adopt: (serverText: string, asOf?: number) => boolean;
  /** Bumped by every edit and every finished save. */
  revision: () => number;
  /** Drop a pending or failed save (the document is being deleted). */
  discard: () => void;
  /** Anything typed that the server has not confirmed (pending, in flight, or failed). */
  hasUnsaved: () => boolean;
  status: AutosaveStatus;
  /** The last save error, cleared by the next successful save. */
  error: string | null;
}

/** Keepalive requests are capped at 64 KB in total; leave room for headers. */
const KEEPALIVE_LIMIT = 60_000;

/**
 * Debounced, serialised autosave for prose.
 *  - A failed save keeps the text, reports the error, and is retried by the next edit (or flush).
 *  - Saves run one at a time in order, so an older PUT can never land after a newer one.
 *  - Unmounting or switching docKey flushes a pending save instead of dropping it.
 *  - adopt() ignores server text while local edits are unsaved, so a refresh that raced a save
 *    cannot overwrite what was typed since.
 */
export function useProseAutosave<R = unknown>({ docKey, save, onSaved, onError, delay = 900 }: AutosaveOptions<R>): ProseAutosave {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<AutosaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);

  const keyRef = useRef(docKey);
  const textRef = useRef('');
  /** The text the server is known to have for keyRef. */
  const savedRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const failed = useRef(false);
  const rev = useRef(0);
  const cbs = useRef({ save, onSaved, onError });
  cbs.current = { save, onSaved, onError };

  const run = useCallback((key: string, value: string, keepalive = false): Promise<boolean> => {
    inflight.current++;
    if (key === keyRef.current) setStatus('saving');
    const attempt = async (): Promise<boolean> => {
      try {
        if (key === keyRef.current && value === savedRef.current && !failed.current) return true;
        const result = await cbs.current.save(key, value, { keepalive });
        if (key === keyRef.current) {
          savedRef.current = value;
          failed.current = false;
          setError(null);
        }
        cbs.current.onSaved?.(result, key, value);
        return true;
      } catch (e) {
        if (key === keyRef.current) {
          failed.current = true;
          setError(e instanceof Error ? e.message : String(e));
        }
        // A newer save of this document is already queued: let that one report if it fails too.
        if (!(key === keyRef.current && inflight.current > 1)) cbs.current.onError?.(e, key, () => run(key, value));
        return false;
      } finally {
        inflight.current--;
        rev.current++;
        if (key === keyRef.current) setStatus(failed.current ? 'error' : timer.current || textRef.current !== savedRef.current ? 'pending' : inflight.current ? 'saving' : 'saved');
      }
    };
    const p = chain.current.then(attempt, attempt);
    chain.current = p;
    return p;
  }, []);

  const hasUnsaved = useCallback(() => !!timer.current || inflight.current > 0 || failed.current || textRef.current !== savedRef.current, []);

  const edit = useCallback(
    (value: string) => {
      textRef.current = value;
      rev.current++;
      setText(value);
      if (timer.current) clearTimeout(timer.current);
      setStatus(failed.current ? 'error' : 'pending');
      timer.current = setTimeout(() => {
        timer.current = null;
        void run(keyRef.current, textRef.current);
      }, delay);
    },
    [delay, run],
  );

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (failed.current || textRef.current !== savedRef.current) return run(keyRef.current, textRef.current);
    return chain.current.then(() => !failed.current);
  }, [run]);

  const adopt = useCallback(
    (serverText: string, asOf?: number) => {
      if (hasUnsaved() || (asOf !== undefined && asOf !== rev.current)) return false;
      textRef.current = serverText;
      savedRef.current = serverText;
      setText(serverText);
      setStatus('saved');
      return true;
    },
    [hasUnsaved],
  );

  // Switching documents (and unmounting) flushes what was typed into the old one.
  useEffect(() => {
    keyRef.current = docKey;
    return () => {
      const pending = !!timer.current || failed.current || textRef.current !== savedRef.current;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const value = textRef.current;
      // Detach state from the old key before the save runs, so its outcome only reaches onSaved/onError.
      keyRef.current = '';
      textRef.current = '';
      savedRef.current = '';
      failed.current = false;
      if (pending) void run(docKey, value);
    };
  }, [docKey, run]);

  // Closing the window: flush unsaved prose with keepalive so it survives the unload.
  // Covers a pending debounce, an in-flight non-keepalive PUT that unload would abort, and retries.
  useEffect(() => {
    const h = () => {
      if (!hasUnsaved()) return;
      const value = textRef.current;
      if (new Blob([value]).size > KEEPALIVE_LIMIT) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      void run(keyRef.current, value, true);
    };
    window.addEventListener('pagehide', h);
    window.addEventListener('beforeunload', h);
    return () => {
      window.removeEventListener('pagehide', h);
      window.removeEventListener('beforeunload', h);
    };
  }, [run, hasUnsaved]);

  const revision = useCallback(() => rev.current, []);

  const discard = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    savedRef.current = textRef.current;
    failed.current = false;
    setError(null);
    setStatus('saved');
  }, []);

  return { text, edit, flush, adopt, hasUnsaved, revision, discard, status, error };
}
