import type { SceneCard } from './schemas/index.js';
import type { Project, SceneEntry } from './project.js';
import { hashValue, sha } from './util.js';

/**
 * Card hash covers story content only. Status and lock are workflow metadata,
 * so approving or locking a scene never makes its prose look stale.
 */
export function cardHash(card: SceneCard): string {
  const { status: _s, lock: _l, ...content } = card;
  return hashValue(content);
}

export function proseHash(body: string): string {
  return sha(body.replace(/\r\n/g, '\n').trim());
}

export type SyncState =
  /** No prose yet. */
  | 'unwritten'
  /** Card and prose agree with each other as of last reconciliation. */
  | 'in_sync'
  /** Card changed since prose was generated: regenerate or re-extract. */
  | 'card_ahead'
  /** Prose changed since last extraction: extract facts. */
  | 'prose_ahead'
  /** Both moved: the author must resolve before generation can run. */
  | 'conflict';

export interface SyncReport {
  scene: string;
  state: SyncState;
  cardHash: string;
  proseHash: string | null;
  generatedFrom: string | null;
  lastExtracted: string | null;
}

export function sceneSync(scene: SceneEntry): SyncReport {
  const ch = cardHash(scene.card);
  if (!scene.prose) {
    return { scene: scene.id, state: 'unwritten', cardHash: ch, proseHash: null, generatedFrom: null, lastExtracted: null };
  }
  const ph = proseHash(scene.prose.body);
  const { generated_from, last_extracted } = scene.prose.meta;
  const cardMoved = generated_from !== ch;
  const proseMoved = last_extracted !== ph;
  const state: SyncState = cardMoved && proseMoved ? 'conflict' : cardMoved ? 'card_ahead' : proseMoved ? 'prose_ahead' : 'in_sync';
  return { scene: scene.id, state, cardHash: ch, proseHash: ph, generatedFrom: generated_from, lastExtracted: last_extracted };
}

export function projectSync(p: Project): Map<string, SyncReport> {
  const m = new Map<string, SyncReport>();
  for (const s of p.scenes.values()) m.set(s.id, sceneSync(s));
  return m;
}

/** Generation for a scene is blocked while its card and prose are in conflict. */
export function canGenerate(scene: SceneEntry): { ok: boolean; reason?: string } {
  const s = sceneSync(scene);
  if (s.state === 'conflict') return { ok: false, reason: 'card and prose both changed since last reconciliation; resolve first' };
  if (scene.card.lock === 'prose' || scene.card.lock === 'both') return { ok: false, reason: 'prose is locked' };
  return { ok: true };
}
