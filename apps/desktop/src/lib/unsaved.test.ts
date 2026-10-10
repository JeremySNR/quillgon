import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { describeUnsaved, flushUnsaved, installUnloadGuard, unsavedChanges, useUnsavedChanges } from './unsaved';

describe('unsaved changes', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => uninstall?.());

  it('registers only while dirty and mounted', () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChanges(dirty, 'scene card edits'), { initialProps: { dirty: false } });
    expect(unsavedChanges()).toEqual([]);
    rerender({ dirty: true });
    expect(unsavedChanges()).toEqual(['scene card edits']);
    unmount();
    expect(unsavedChanges()).toEqual([]);
  });

  it('keeps unload-only entries out of in-app navigation', () => {
    const { unmount } = renderHook(() => useUnsavedChanges(() => true, 'scene prose', { inApp: false }));
    expect(unsavedChanges('navigate')).toEqual([]);
    expect(unsavedChanges('unload')).toEqual(['scene prose']);
    unmount();
  });

  it('blocks unload while something is unsaved', () => {
    uninstall = installUnloadGuard();
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChanges(dirty, 'style dials'), { initialProps: { dirty: false } });
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    rerender({ dirty: true });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    unmount();
  });

  it('saves what it can before asking: pending prose is flushed, then no longer unsaved', async () => {
    let pending = true;
    const flushes: number[] = [];
    const { unmount } = renderHook(() =>
      useUnsavedChanges(() => pending, 'scene prose', {
        inApp: false,
        flush: async () => {
          flushes.push(1);
          pending = false;
          return true;
        },
      }),
    );
    expect(unsavedChanges('unload')).toEqual(['scene prose']);
    await flushUnsaved();
    expect(flushes).toHaveLength(1);
    expect(unsavedChanges('unload')).toEqual([]);
    await flushUnsaved(); // nothing dirty: nothing flushed
    expect(flushes).toHaveLength(1);
    unmount();
  });

  it('describes what would be lost', () => {
    expect(describeUnsaved([])).toBe('changes');
    expect(describeUnsaved(['style dials'])).toBe('style dials');
    expect(describeUnsaved(['scene card edits', 'style dials', 'style dials'])).toBe('scene card edits and style dials');
    expect(describeUnsaved(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
