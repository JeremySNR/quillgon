import { describe, expect, it } from 'vitest';
import { fieldTarget } from './dictate';

/** A controlled field whose React state only catches up when `render()` is called. */
function field(initial: string) {
  let state = initial;
  let rendered = initial;
  const el = document.createElement('textarea');
  el.value = initial;
  el.setSelectionRange(initial.length, initial.length);
  const target = fieldTarget(() => el, () => rendered, (v) => (state = v));
  const render = () => {
    rendered = state;
    el.value = state;
  };
  return { target, render, value: () => state };
}

describe('dictating into a field', () => {
  it('the next piece of a long take joins the last one, even before React has rendered it', () => {
    const f = field('We lived on');
    f.target.insert(' Harehills Lane.');
    // No render yet: the next piece must still see the first one before the cursor.
    expect(f.target.context()).toEqual({ before: 'We lived on Harehills Lane.', after: '' });
    f.target.insert(' Number 14.');
    expect(f.value()).toBe('We lived on Harehills Lane. Number 14.');
  });

  it('once React catches up, it reads the field again', () => {
    const f = field('Dad');
    f.target.insert(' drove buses.');
    f.render();
    expect(f.target.context().before).toBe('Dad drove buses.');
  });

  it('undoing the tidy-up before a render swaps the right words', () => {
    const f = field('It was');
    const swap = f.target.insert(' nineteen sixty two.');
    swap(' um, sixty-two, I think.');
    expect(f.value()).toBe('It was um, sixty-two, I think.');
  });
});
