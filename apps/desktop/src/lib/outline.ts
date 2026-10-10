import type { Structure } from './types';

/** One row of the outline: an act heading, a chapter heading, or a scene. */
export type Row = { key: string; kind: 'act' | 'chapter' | 'scene'; id: string };

/** The structure as the flat, draggable list the outline shows. */
export function flatten(st: Structure): Row[] {
  const rows: Row[] = [];
  for (const a of st.acts) {
    rows.push({ key: `act:${a.id}`, kind: 'act', id: a.id });
    for (const c of a.chapters) {
      rows.push({ key: `ch:${c.id}`, kind: 'chapter', id: c.id });
      for (const s of c.scenes) rows.push({ key: s, kind: 'scene', id: s });
    }
  }
  return rows;
}

/**
 * Put a reordered flat list back into the structure: each scene belongs to the nearest chapter
 * row above it (scenes above the first chapter go to the first chapter). Acts and chapters keep
 * their order; only scene membership and order change.
 */
export function rebuild(st: Structure, rows: Row[]): Structure {
  const next: Structure = structuredClone(st);
  const chapters = new Map(next.acts.flatMap((a) => a.chapters).map((c) => [c.id, c]));
  for (const c of chapters.values()) c.scenes = [];
  let current: Structure['acts'][number]['chapters'][number] | undefined = next.acts[0]?.chapters[0];
  for (const r of rows) {
    if (r.kind === 'chapter') current = chapters.get(r.id);
    else if (r.kind === 'scene' && current) current.scenes.push(r.id);
  }
  return next;
}
