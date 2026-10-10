import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../lib/api';
import type { SceneCard, SceneDetail } from '../lib/types';
import { deepEqual } from '../lib/util';

const fetchDetail = (id: string) => get<SceneDetail>(`/scenes/${id}`);

/** The parts of useProseAutosave the loader coordinates with. */
export interface ProseSink {
  adopt: (text: string, asOf?: number) => boolean;
  revision: () => number;
}

/**
 * A scene's detail and its editable card. Reloads whenever `refreshKey` changes (the project
 * changed underneath: ripple applied, file edited elsewhere) without clobbering local work:
 * a dirty card is kept, and prose goes through the autosave's adopt(), which refuses text that
 * would overwrite unsaved typing.
 */
export function useSceneDetail(id: string, { refreshKey, prose, fetchScene = fetchDetail }: { refreshKey?: unknown; prose?: ProseSink; fetchScene?: (id: string) => Promise<SceneDetail> } = {}) {
  const [detail, setDetail] = useState<SceneDetail | null>(null);
  const [card, setCard] = useState<SceneCard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Memoised: only recomputed when the card or the server copy changes, not on every render.
  const cardDirty = useMemo(() => !!(detail && card) && card !== detail.card && !deepEqual(card, detail.card), [card, detail]);
  const dirtyRef = useRef(cardDirty);
  dirtyRef.current = cardDirty;
  const detailRef = useRef(detail);
  detailRef.current = detail;

  const seq = useRef(0);
  const deps = useRef({ prose, fetchScene });
  deps.current = { prose, fetchScene };

  const load = useCallback(async (): Promise<SceneDetail | null> => {
    const n = ++seq.current;
    const asOf = deps.current.prose?.revision();
    let d: SceneDetail;
    try {
      d = await deps.current.fetchScene(id);
    } catch (e) {
      if (n === seq.current) setLoadError(e instanceof Error ? e.message : String(e));
      return null;
    }
    // A newer load started, or the scene changed: this answer is stale.
    if (n !== seq.current) return null;
    setLoadError(null);
    setDetail(d);
    setCard((cur) => (cur && dirtyRef.current ? cur : d.card));
    deps.current.prose?.adopt(d.prose?.body ?? '', asOf);
    return d;
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setCard(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /** Take a server answer that includes the saved card. */
  const accept = useCallback((d: SceneDetail) => {
    seq.current++;
    setDetail(d);
    setCard(d.card);
  }, []);

  const discardCard = useCallback(() => setCard((cur) => detailRef.current?.card ?? cur), []);

  return { detail, setDetail, card, setCard, cardDirty, load, accept, discardCard, loadError };
}
