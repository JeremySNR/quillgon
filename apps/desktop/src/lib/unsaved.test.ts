import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { describeUnsaved, installUnloadGuard, unsavedChanges, useUnsavedChanges } from './unsaved';

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

  it('describes what would be lost', () => {
    expect(describeUnsaved([])).toBe('changes');
    expect(describeUnsaved(['style dials'])).toBe('style dials');
    expect(describeUnsaved(['scene card edits', 'style dials', 'style dials'])).toBe('scene card edits and style dials');
    expect(describeUnsaved(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
