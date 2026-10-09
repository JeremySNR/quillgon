import type { GraphStore } from './store.js';
import type { StylePassReport } from './engine/style-passes.js';
import { checkStyle } from './style-check.js';
import { sceneOrder } from './project.js';

export interface SceneStyle {
  scene: string;
  enforced: number;
  guided: number;
  checked_at: string;
}

/** Per-scene style status for the outline and dashboard (reports/style-latest.json). */
export function readStyleStatus(store: GraphStore): Record<string, SceneStyle> {
  try {
    return JSON.parse(store.readReport('style-latest.json') ?? '{}');
  } catch {
    return {};
  }
}

export function recordStyleReport(store: GraphStore, scene: string, r: Pick<StylePassReport, 'enforcedAfter' | 'guidedAfter'>) {
  const all = readStyleStatus(store);
  all[scene] = { scene, enforced: r.enforcedAfter, guided: r.guidedAfter, checked_at: new Date().toISOString() };
  store.writeReport('style-latest.json', JSON.stringify(all, null, 2));
}

/** Check every written scene against the style sheet (mechanical; no model calls). */
export function runStyleCheck(store: GraphStore): Record<string, SceneStyle> {
  const p = store.project;
  const all: Record<string, SceneStyle> = {};
  for (const id of sceneOrder(p)) {
    const prose = p.scenes.get(id)?.prose?.body;
    if (!prose) continue;
    const r = checkStyle(prose, p.style.sheet, { book: p.book, banned: p.style.banned });
    all[id] = { scene: id, enforced: r.enforced, guided: r.guided, checked_at: new Date().toISOString() };
  }
  store.writeReport('style-latest.json', JSON.stringify(all, null, 2));
  return all;
}
