import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProseAutosave, type AutosaveOptions } from './use-prose-autosave';

type Save = AutosaveOptions<string>['save'];

/** A save whose calls can be resolved or rejected one at a time. */
function controlledSave() {
  const calls: { key: string; text: string; keepalive: boolean; resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];
  const save = vi.fn<Save>(
    (key, text, { keepalive }) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ key, text, keepalive, resolve, reject });
      }),
  );
  return { save, calls };
}

const flushMicrotasks = () => act(async () => {});

describe('useProseAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces edits into one save of the latest text', async () => {
    const save = vi.fn<Save>(async (_k, text) => text);
    const onSaved = vi.fn();
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, onSaved, delay: 900 }));
    act(() => result.current.edit('a'));
    act(() => result.current.edit('ab'));
    act(() => result.current.edit('abc'));
    expect(result.current.status).toBe('pending');
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(900));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('s01', 'abc', { keepalive: false });
    expect(onSaved).toHaveBeenCalledWith('abc', 's01', 'abc');
    expect(result.current.status).toBe('saved');
    expect(result.current.hasUnsaved()).toBe(false);
  });

  it('keeps the text and reports when a save fails, then retries on the next edit', async () => {
    const { save, calls } = controlledSave();
    const onError = vi.fn();
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, onError, delay: 100 }));
    act(() => result.current.edit('first draft'));
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => calls[0].reject(new Error('disk full')));

    expect(result.current.text).toBe('first draft');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('disk full');
    expect(result.current.hasUnsaved()).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe('s01');

    act(() => result.current.edit('first draft, more'));
    await act(async () => vi.advanceTimersByTime(100));
    expect(calls[1].text).toBe('first draft, more');
    await act(async () => calls[1].resolve('ok'));
    expect(result.current.status).toBe('saved');
    expect(result.current.error).toBeNull();
    expect(result.current.hasUnsaved()).toBe(false);
  });

  it('retries the failed text with flush() even without a new edit', async () => {
    const save = vi.fn<Save>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok');
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, delay: 50 }));
    act(() => result.current.edit('words'));
    await act(async () => vi.advanceTimersByTime(50));
    expect(result.current.status).toBe('error');
    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(save).toHaveBeenLastCalledWith('s01', 'words', { keepalive: false });
    expect(result.current.status).toBe('saved');
  });

  it('flushes a pending save on unmount instead of dropping it', async () => {
    const save = vi.fn<Save>(async (_k, t) => t);
    const onSaved = vi.fn();
    const { result, unmount } = renderHook(() => useProseAutosave({ docKey: 's07', save, onSaved, delay: 900 }));
    act(() => result.current.edit('typed just before leaving'));
    unmount();
    await flushMicrotasks();
    expect(save).toHaveBeenCalledWith('s07', 'typed just before leaving', { keepalive: false });
    expect(onSaved).toHaveBeenCalledTimes(1);
    // The debounce timer was cancelled: no second save later.
    await act(async () => vi.advanceTimersByTime(2000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a failed flush after unmount with a retry that re-sends the same text', async () => {
    const save = vi.fn<Save>().mockRejectedValueOnce(new Error('server gone')).mockResolvedValue('ok');
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useProseAutosave({ docKey: 's07', save, onError }));
    act(() => result.current.edit('last words'));
    unmount();
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledTimes(1);
    const retry = onError.mock.calls[0][2] as () => Promise<boolean>;
    await act(async () => {
      expect(await retry()).toBe(true);
    });
    expect(save).toHaveBeenLastCalledWith('s07', 'last words', { keepalive: false });
  });

  it('does not save on unmount when nothing changed', async () => {
    const save = vi.fn<Save>(async (_k, t) => t);
    const { result, unmount } = renderHook(() => useProseAutosave({ docKey: 's01', save }));
    act(() => void result.current.adopt('from the server'));
    unmount();
    await flushMicrotasks();
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes the old document when the key changes', async () => {
    const save = vi.fn<Save>(async (_k, t) => t);
    const { result, rerender } = renderHook(({ k }) => useProseAutosave({ docKey: k, save, delay: 900 }), { initialProps: { k: 's01' } });
    act(() => result.current.edit('scene one text'));
    rerender({ k: 's02' });
    await flushMicrotasks();
    expect(save).toHaveBeenCalledWith('s01', 'scene one text', { keepalive: false });
    // The new document starts clean and takes the server's text.
    expect(result.current.hasUnsaved()).toBe(false);
    act(() => void result.current.adopt('scene two text'));
    expect(result.current.text).toBe('scene two text');
  });

  it('does not let a refresh clobber text typed since the last save', async () => {
    const { save, calls } = controlledSave();
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, delay: 100 }));
    act(() => void result.current.adopt('Original.'));

    // Typed, saved, in flight; a refresh with the old server text arrives meanwhile.
    act(() => result.current.edit('Original. New line'));
    await act(async () => vi.advanceTimersByTime(100));
    expect(calls).toHaveLength(1);
    let taken = true;
    act(() => {
      taken = result.current.adopt('Original.');
    });
    expect(taken).toBe(false);
    expect(result.current.text).toBe('Original. New line');

    // The save lands, the user keeps typing, and the SSE-driven refresh brings the saved text.
    await act(async () => calls[0].resolve('ok'));
    act(() => result.current.edit('Original. New line, and more'));
    act(() => {
      taken = result.current.adopt('Original. New line');
    });
    expect(taken).toBe(false);
    expect(result.current.text).toBe('Original. New line, and more');
  });

  it('refuses an answer to a request that started before an edit', async () => {
    const save = vi.fn<Save>(async (_k, t) => t);
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, delay: 10 }));
    act(() => void result.current.adopt('v1'));
    const asOf = result.current.revision();
    act(() => result.current.edit('v2'));
    await act(async () => vi.advanceTimersByTime(10));
    expect(result.current.hasUnsaved()).toBe(false);
    // The GET was sent before the edit, so its answer ("v1") is stale even though all is saved.
    let taken = true;
    act(() => {
      taken = result.current.adopt('v1', asOf);
    });
    expect(taken).toBe(false);
    expect(result.current.text).toBe('v2');
    // A fresh request is taken.
    act(() => {
      taken = result.current.adopt('v3 from elsewhere', result.current.revision());
    });
    expect(taken).toBe(true);
    expect(result.current.text).toBe('v3 from elsewhere');
  });

  it('runs saves one at a time, in order', async () => {
    const { save, calls } = controlledSave();
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, delay: 10 }));
    act(() => result.current.edit('one'));
    await act(async () => vi.advanceTimersByTime(10));
    act(() => result.current.edit('one two'));
    await act(async () => vi.advanceTimersByTime(10));
    // The second save waits for the first.
    expect(calls.map((c) => c.text)).toEqual(['one']);
    await act(async () => calls[0].resolve('ok'));
    expect(calls.map((c) => c.text)).toEqual(['one', 'one two']);
    await act(async () => calls[1].resolve('ok'));
    expect(result.current.status).toBe('saved');
  });

  it('only reports the newest failure when saves queue up', async () => {
    const { save, calls } = controlledSave();
    const onError = vi.fn();
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, onError, delay: 10 }));
    act(() => result.current.edit('a'));
    await act(async () => vi.advanceTimersByTime(10));
    act(() => result.current.edit('ab'));
    await act(async () => vi.advanceTimersByTime(10));
    await act(async () => calls[0].reject(new Error('blip')));
    expect(onError).not.toHaveBeenCalled();
    await act(async () => calls[1].resolve('ok'));
    expect(result.current.status).toBe('saved');
    expect(result.current.error).toBeNull();
  });

  it('sends a pending save with keepalive when the page unloads', async () => {
    const save = vi.fn<Save>(async (_k, t) => t);
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, delay: 900 }));
    act(() => result.current.edit('closing the lid'));
    await act(async () => void window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledWith('s01', 'closing the lid', { keepalive: true });
  });

  it('re-sends with keepalive on unload when an in-flight save is aborted', async () => {
    const { save, calls } = controlledSave();
    const { result } = renderHook(() => useProseAutosave({ docKey: 's01', save, onError: () => undefined, delay: 10 }));
    act(() => result.current.edit('already sending'));
    await act(async () => vi.advanceTimersByTime(10));
    expect(calls).toHaveLength(1);
    expect(calls[0].keepalive).toBe(false);
    // Unload queues a keepalive save behind the in-flight PUT (which the browser aborts).
    await act(async () => void window.dispatchEvent(new Event('pagehide')));
    await act(async () => calls[0].reject(new Error('aborted')));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ text: 'already sending', keepalive: true });
    await act(async () => calls[1].resolve('ok'));
  });

  it('discard() drops a pending save', async () => {
    const save = vi.fn<Save>(async (_k, t) => t);
    const { result, unmount } = renderHook(() => useProseAutosave({ docKey: 's01', save, delay: 900 }));
    act(() => result.current.edit('about to be deleted'));
    act(() => result.current.discard());
    unmount();
    await act(async () => vi.advanceTimersByTime(2000));
    expect(save).not.toHaveBeenCalled();
  });
});
