import { describe, expect, it } from 'vitest';
import type { Structure } from './types';
import { flatten, rebuild } from './outline';

const structure = {
  acts: [
    { id: 'a1', title: 'One', chapters: [{ id: 'c1', title: 'Arrival', scenes: ['s01', 's02'] }, { id: 'c2', title: 'Ledger', scenes: ['s03'] }] },
    { id: 'a2', title: 'Two', chapters: [{ id: 'c3', title: 'Storm', scenes: [] }] },
  ],
} as unknown as Structure;

describe('outline rows', () => {
  it('flattens acts, chapters and scenes in reading order', () => {
    expect(flatten(structure).map((r) => r.key)).toEqual(['act:a1', 'ch:c1', 's01', 's02', 'ch:c2', 's03', 'act:a2', 'ch:c3']);
  });

  it('round-trips unchanged', () => {
    expect(rebuild(structure, flatten(structure))).toEqual(structure);
  });

  it('moves a scene into the chapter above it, without touching the input', () => {
    const rows = flatten(structure);
    const s02 = rows.findIndex((r) => r.id === 's02');
    const [moved] = rows.splice(s02, 1);
    rows.push(moved); // after ch:c3
    const next = rebuild(structure, rows);
    expect(next.acts[0].chapters[0].scenes).toEqual(['s01']);
    expect(next.acts[1].chapters[0].scenes).toEqual(['s02']);
    expect(structure.acts[0].chapters[0].scenes).toEqual(['s01', 's02']);
  });

  it('puts scenes dragged above every chapter into the first chapter', () => {
    const rows = flatten(structure);
    const s03 = rows.findIndex((r) => r.id === 's03');
    const [moved] = rows.splice(s03, 1);
    rows.unshift(moved);
    expect(rebuild(structure, rows).acts[0].chapters[0].scenes).toEqual(['s03', 's01', 's02']);
  });
});
