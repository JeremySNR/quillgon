import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StyleReport } from '../lib/types';
import { useStyleCheck } from './use-style-check';

const report = (enforced: number) => ({ enforced, guided: 0, violations: [], stats: {} }) as unknown as StyleReport;

describe('useStyleCheck', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks once typing pauses', async () => {
    const check = vi.fn(async () => report(2));
    const { result, rerender } = renderHook(({ t }) => useStyleCheck(t, 'sheet', { check, delay: 450 }), { initialProps: { t: 'a' } });
    rerender({ t: 'ab' });
    rerender({ t: 'abc' });
    await act(async () => vi.advanceTimersByTime(450));
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('abc');
    expect(result.current?.enforced).toBe(2);
  });

  it('drops a slow answer that a newer check overtook', async () => {
    const answers: ((r: StyleReport) => void)[] = [];
    const check = vi.fn(() => new Promise<StyleReport>((resolve) => answers.push(resolve)));
    const { result, rerender } = renderHook(({ t }) => useStyleCheck(t, 'sheet', { check, delay: 10 }), { initialProps: { t: 'first' } });
    await act(async () => vi.advanceTimersByTime(10));
    rerender({ t: 'second' });
    await act(async () => vi.advanceTimersByTime(10));
    await act(async () => answers[1](report(1)));
    await act(async () => answers[0](report(9)));
    expect(result.current?.enforced).toBe(1);
  });

  it('clears for empty text and stays quiet on failure', async () => {
    const check = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result, rerender } = renderHook(({ t }) => useStyleCheck(t, 'sheet', { check, delay: 10 }), { initialProps: { t: 'words' } });
    await act(async () => vi.advanceTimersByTime(10));
    expect(result.current).toBeNull();
    rerender({ t: '   ' });
    await act(async () => vi.advanceTimersByTime(10));
    expect(check).toHaveBeenCalledTimes(1);
  });
});
