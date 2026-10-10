import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDraft } from './use-draft';

describe('useDraft', () => {
  it('is clean until edited, and dirty is structural', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: { spelling: 'uk', never: ['delve'] } } });
    expect(result.current.dirty).toBe(false);
    // A refresh that returns an equal copy is not a change.
    rerender({ v: { spelling: 'uk', never: ['delve'] } });
    expect(result.current.dirty).toBe(false);
    act(() => result.current.set((cur) => ({ ...cur, spelling: 'us' })));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.value.spelling).toBe('uk');
    expect(result.current.dirty).toBe(false);
  });

  it('follows the server while untouched', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: 'old samples' } });
    rerender({ v: 'samples edited on disk' });
    expect(result.current.value).toBe('samples edited on disk');
  });

  it('never lets a refresh wipe local edits', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: { max: 30 } } });
    act(() => result.current.set({ max: 25 }));
    rerender({ v: { max: 40 } });
    expect(result.current.value).toEqual({ max: 25 });
    expect(result.current.dirty).toBe(true);
    // Discarding goes back to the latest server copy.
    act(() => result.current.reset());
    expect(result.current.value).toEqual({ max: 40 });
  });

  it('is clean once the server has what was saved', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: { max: 30 } } });
    act(() => result.current.set({ max: 25 }));
    rerender({ v: { max: 25 } });
    expect(result.current.dirty).toBe(false);
  });
});
