import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SceneCard, SceneDetail } from '../lib/types';
import { useProseAutosave } from './use-prose-autosave';
import { useSceneDetail } from './use-scene-detail';

const card = (over: Partial<SceneCard> = {}): SceneCard =>
  ({ id: 's01', title: 'Funeral Eve', pov: 'mara', location: 'harbour', time: '', purpose: 'Open', beats: ['a', 'b'], outcome: '', characters: [], threads_touched: [], plot_points: [], reveals: [], mentions: [], sets_up: [], pays_off: [], status: 'draft', lock: 'none', ...over }) as unknown as SceneCard;

const detail = (body: string, c: SceneCard = card()): SceneDetail =>
  ({ id: 's01', card: c, prose: { meta: {}, body }, facts: null, sync: { state: 'in_sync' }, prev: null, next: 's02', states: [] }) as unknown as SceneDetail;

/** The server: GETs answer with whatever is stored when they are resolved. */
function fakeServer(initial: SceneDetail) {
  let stored = initial;
  const gets: ((d: SceneDetail) => void)[] = [];
  return {
    get stored() {
      return stored;
    },
    set stored(d) {
      stored = d;
    },
    fetchScene: vi.fn(() => new Promise<SceneDetail>((resolve) => gets.push(resolve))),
    answerGet: (i: number, d = stored) => gets[i](d),
    pendingGets: () => gets.length,
  };
}

/** SceneEditor's wiring of the two hooks, without the UI. */
function useEditor(server: ReturnType<typeof fakeServer>, refreshKey: number, save = vi.fn(async (_k: string, body: string) => ((server.stored = detail(body, server.stored.card)), server.stored))) {
  const prose = useProseAutosave<SceneDetail>({ docKey: 's01', save, delay: 20 });
  const scene = useSceneDetail('s01', { refreshKey, prose, fetchScene: server.fetchScene });
  return { prose, scene, save };
}

describe('useSceneDetail', () => {
  it('loads the card and prose', async () => {
    const server = fakeServer(detail('Once.'));
    const { result } = renderHook(() => useEditor(server, 0));
    await act(async () => server.answerGet(0));
    expect(result.current.scene.card?.title).toBe('Funeral Eve');
    expect(result.current.prose.text).toBe('Once.');
    expect(result.current.scene.cardDirty).toBe(false);
  });

  it('memoises cardDirty and clears it when edits are undone', async () => {
    const server = fakeServer(detail('Once.'));
    const { result } = renderHook(() => useEditor(server, 0));
    await act(async () => server.answerGet(0));
    act(() => result.current.scene.setCard({ ...result.current.scene.card!, title: 'Wake' }));
    expect(result.current.scene.cardDirty).toBe(true);
    act(() => result.current.scene.setCard({ ...result.current.scene.card!, title: 'Funeral Eve' }));
    expect(result.current.scene.cardDirty).toBe(false);
    act(() => result.current.scene.setCard({ ...result.current.scene.card!, title: 'Wake' }));
    act(() => result.current.scene.discardCard());
    expect(result.current.scene.card).toBe(result.current.scene.detail!.card);
  });

  it('keeps a dirty card when the project refreshes underneath', async () => {
    const server = fakeServer(detail('Once.'));
    const { result, rerender } = renderHook(({ k }) => useEditor(server, k), { initialProps: { k: 0 } });
    await act(async () => server.answerGet(0));
    act(() => result.current.scene.setCard({ ...result.current.scene.card!, purpose: 'My edit' }));

    // Something else changed the scene on the server (a ripple was applied).
    server.stored = detail('Once.', card({ outcome: 'Changed elsewhere' }));
    rerender({ k: 1 });
    await act(async () => server.answerGet(1));
    expect(result.current.scene.card?.purpose).toBe('My edit');
    expect(result.current.scene.detail?.card.outcome).toBe('Changed elsewhere');
    expect(result.current.scene.cardDirty).toBe(true);
  });

  it('takes a clean card and prose from a refresh', async () => {
    const server = fakeServer(detail('Once.'));
    const { result, rerender } = renderHook(({ k }) => useEditor(server, k), { initialProps: { k: 0 } });
    await act(async () => server.answerGet(0));
    server.stored = detail('Rewritten by a ripple.', card({ title: 'Renamed' }));
    rerender({ k: 1 });
    await act(async () => server.answerGet(1));
    expect(result.current.scene.card?.title).toBe('Renamed');
    expect(result.current.prose.text).toBe('Rewritten by a ripple.');
  });

  it('does not let the refresh after a save clobber text typed since', async () => {
    const server = fakeServer(detail('Once.'));
    let resolveSave: (() => void) | null = null;
    const save = vi.fn(
      (_k: string, body: string) =>
        new Promise<SceneDetail>((resolve) => {
          resolveSave = () => resolve((server.stored = detail(body)));
        }),
    );
    const { result, rerender } = renderHook(({ k }) => useEditor(server, k, save), { initialProps: { k: 0 } });
    await act(async () => server.answerGet(0));

    act(() => result.current.prose.edit('Once. Upon'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The PUT is in flight; the store event from it triggers a refresh whose GET was answered
    // before the write landed.
    rerender({ k: 1 });
    await act(async () => server.answerGet(1, detail('Once.')));
    expect(result.current.prose.text).toBe('Once. Upon');

    // The PUT lands, the user keeps typing, and another refresh brings the saved text.
    await act(async () => resolveSave!());
    act(() => result.current.prose.edit('Once. Upon a time'));
    rerender({ k: 2 });
    await act(async () => server.answerGet(2));
    expect(server.stored.prose?.body).toBe('Once. Upon');
    expect(result.current.prose.text).toBe('Once. Upon a time');

    // Once everything is saved, refreshes are taken again.
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await act(async () => resolveSave!());
    expect(result.current.prose.hasUnsaved()).toBe(false);
    server.stored = detail('Edited on disk.');
    rerender({ k: 3 });
    await act(async () => server.answerGet(3));
    expect(result.current.prose.text).toBe('Edited on disk.');
  });

  it('drops answers to superseded loads', async () => {
    const server = fakeServer(detail('first'));
    const { result, rerender } = renderHook(({ k }) => useEditor(server, k), { initialProps: { k: 0 } });
    rerender({ k: 1 });
    expect(server.pendingGets()).toBe(2);
    await act(async () => server.answerGet(1, detail('newer')));
    await act(async () => server.answerGet(0, detail('older')));
    expect(result.current.prose.text).toBe('newer');
  });

  it('reports a load failure', async () => {
    const fetchScene = vi.fn().mockRejectedValue(new Error('no such scene'));
    const { result } = renderHook(() => useSceneDetail('s99', { fetchScene }));
    await waitFor(() => expect(result.current.loadError).toBe('no such scene'));
    expect(result.current.detail).toBeNull();
  });
});
