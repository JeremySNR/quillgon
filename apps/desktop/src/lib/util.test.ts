import { afterEach, describe, expect, it, vi } from 'vitest';
import { ago, cx, deepEqual, factLabel, firstName, hue, loadPref, money, plural, savePref } from './util';

describe('util', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('plural', () => {
    expect(plural(1, 'scene')).toBe('1 scene');
    expect(plural(2, 'scene')).toBe('2 scenes');
    expect(plural(0, 'fix', 'fixes')).toBe('0 fixes');
    expect(plural(12000, 'word')).toBe('12,000 words');
  });

  it('ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));
    expect(ago(null)).toBe('never');
    expect(ago(Date.now() - 5_000)).toBe('just now');
    expect(ago(Date.now() - 30_000)).toBe('30s ago');
    expect(ago(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(ago(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3h ago');
    expect(ago('2026-01-02T12:00:00Z')).toMatch(/Jan|2/);
  });

  it('money', () => {
    expect(money(0)).toBe('$0.00');
    expect(money(0.004)).toBe('<$0.01');
    expect(money(1.234)).toBe('$1.23');
  });

  it('cx drops falsy parts', () => {
    expect(cx('btn', false, null, undefined, 'primary')).toBe('btn primary');
  });

  it('hue is stable and from the palette', () => {
    expect(hue('mara')).toBe(hue('mara'));
    expect([62, 150, 235, 300, 28, 190, 95, 330, 265, 120]).toContain(hue('anything'));
  });

  it('factLabel and firstName fall back to the id', () => {
    const facts = [{ id: 'debt', statement: 'Eliza holds the debts' }];
    expect(factLabel(facts, 'debt')).toBe('Eliza holds the debts');
    expect(factLabel(facts, 'tide-ledger')).toBe('tide ledger');
    const chars = [{ id: 'mara', bio: { name: 'Mara Penrose' } }];
    expect(firstName(chars, 'mara')).toBe('Mara');
    expect(firstName(chars, 'jory')).toBe('jory');
  });

  it('loadPref and savePref round-trip, with fallbacks', () => {
    expect(loadPref('missing', 7)).toBe(7);
    savePref('rail', true);
    expect(loadPref('rail', false)).toBe(true);
    localStorage.setItem('ne.theme', 'dark');
    expect(loadPref('theme', 'system')).toBe('dark');
    localStorage.setItem('ne.broken', '{not json');
    expect(loadPref('broken', 'fallback')).toBe('fallback');
  });

  it('deepEqual compares structure, not identity or key order', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: [] }, { a: {} })).toBe(false);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
});
