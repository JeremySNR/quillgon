import { describe, expect, it, vi } from 'vitest';
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

// ------------------------------------------------------------------ the hook

const h = vi.hoisted(() => ({
  stops: [] as ((v: { wav: Blob; seconds: number } | null) => void)[],
  posted: [] as string[],
}));

vi.mock('../lib/app', () => ({ useApp: () => ({ project: { dictation: { ready: true } }, toast: () => undefined, fail: () => () => undefined }) }));
vi.mock('../lib/api', () => ({
  post: async (_path: string, body: { audio: string }) => {
    h.posted.push(body.audio);
    return { raw: body.audio, text: ` ${body.audio}`, level: 'verbatim', provider: 'offline', seconds: 1, flags: [] };
  },
}));
vi.mock('../lib/recorder', () => ({
  blobToBase64: async (b: Blob) => b.text(),
  Recorder: class {
    static supported = () => true;
    async start() {}
    stop() {
      return new Promise((resolve) => h.stops.push(resolve));
    }
  },
}));

describe('stopping dictation', () => {
  it('a second stop waits for the last piece of the first, so a send right after a key release has every word', async () => {
    const { act, renderHook } = await import('@testing-library/react');
    const { useDictation } = await import('./dictate');
    let text = '';
    const target = { context: () => ({ before: text, after: '' }), insert: (t: string) => ((text += t), () => undefined) };
    const { result } = renderHook(() => useDictation({ target, long: true }));
    await act(() => result.current.start());
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.stop(); // the key is released
      second = result.current.stop(); // send, a moment later
    });
    let secondDone = false;
    void second.then(() => (secondDone = true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      expect(secondDone).toBe(false); // the recorder has not handed over its last piece yet
      h.stops[0]({ wav: new Blob(['the last words']), seconds: 1 });
      await second;
    });
    expect(text).toBe(' the last words');
    await first;
    expect(result.current.state).toBe('idle');
  });
});
