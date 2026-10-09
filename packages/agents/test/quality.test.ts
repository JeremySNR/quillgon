import { describe, expect, it } from 'vitest';
import { latestReaderReport, mechanicalContinuity, predictionMatch, voiceReport, type ReaderOutput } from '@novel/core';
import { fixtureEngine } from './helpers.js';

/** A scripted reader: engagement and predictions per scene number. */
function reader(script: Record<number, Partial<ReaderOutput>>) {
  return async (i: { scene_number: number; prose: string }) => ({
    believes: i.prose.slice(0, 80),
    expects: 'more',
    confusions: [],
    resolved_confusions: [],
    engagement: 3,
    predictions: [],
    ...script[i.scene_number],
  });
}

describe('phase 6: quality systems', () => {
  it('the twist planted for s10 is not called early when the reader only suspects Eliza', async () => {
    const { engine } = await fixtureEngine({
      read: reader({
        4: { predictions: ['Eliza Trevaskis had Walter killed to stop him reporting her.'] },
        8: { predictions: ['Eliza drowned him; Jory is covering for her out of debt.'] },
      }),
    });
    const r = await engine.reader();
    expect(r.engagement).toHaveLength(12);
    expect(r.predictions.find((p) => p.fact === 'jory-forged-ledger')).toBeUndefined();
  });

  it('a reader who guesses the forgery early is reported with how early', async () => {
    const { engine, store } = await fixtureEngine({
      read: reader({
        5: { predictions: ['Jory wrote the storm into the ledger himself, to hide something about that night.'], engagement: 4 },
        10: { engagement: 5 },
      }),
    });
    const r = await engine.reader();
    const hit = r.predictions.find((p) => p.fact === 'jory-forged-ledger');
    expect(hit).toMatchObject({ guessed_in: 's05', revealed_in: 's10', early_by: 5 });
    expect(latestReaderReport(store)!.id).toBe(r.id);
    expect(store.book.health.reader_mean_engagement).toBeCloseTo((10 * 3 + 4 + 5) / 12);
  });

  it('confusions are tracked to resolution and boredom runs are found', async () => {
    const { engine } = await fixtureEngine({
      read: reader({
        2: { confusions: [{ id: '2a', text: 'Why would he write a storm that never came?' }] },
        6: { engagement: 2 },
        7: { engagement: 1 },
        8: { engagement: 2 },
        10: { resolved_confusions: ['2a'] },
      }),
    });
    const r = await engine.reader();
    expect(r.confusions).toEqual([{ id: '2a', scene: 's02', text: 'Why would he write a storm that never came?', resolved_in: 's10' }]);
    expect(r.boredom).toEqual([{ from: 's06', to: 's08', scenes: ['s06', 's07', 's08'] }]);
  });

  it('prediction matching needs the right person, not just the right words', () => {
    const statement = "Jory wrote the storm into the ledger to hide his part in Walter's death.";
    expect(predictionMatch('Jory faked the ledger entry himself', statement, ['Jory', 'Walter', 'Eliza'])).toBeGreaterThan(0.34);
    expect(predictionMatch('Eliza wrote the storm into the ledger', statement, ['Jory', 'Walter', 'Eliza'])).toBe(0);
  });

  it('the fixture is clean, and a hand-made knowledge error is caught', async () => {
    const { store, engine } = await fixtureEngine();
    expect(mechanicalContinuity(store.project)).toEqual([]);
    // Mara accuses Eliza of knowing about the forgery in s05, long before she can know it.
    const card = store.scene('s05').card;
    store.saveCard({ ...card, mentions: [...card.mentions, { character: 'mara', fact: 'eliza-knew' }] });
    const report = await engine.continuity({ model: false });
    expect(report.mechanical).toEqual([expect.objectContaining({ kind: 'unknown-fact', scene: 's05', severity: 'high' })]);
    expect(store.book.health.open_continuity_issues).toBe(1);
  });

  it('catches the dead acting, payoffs before setups and backwards time', async () => {
    const { store } = await fixtureEngine();
    const tom = store.project.characters.get('tom')!;
    store.saveCharacterState('tom', { ...tom.state, s06: { ...tom.state.s06, alive: false } });
    store.saveThread({ ...store.project.threads.get('cannery-debt')!, setup_scene: 's11', payoff_scene: 's04' });
    store.saveCard({ ...store.scene('s03').card, time: '1926-03-11 morning' });
    const kinds = mechanicalContinuity(store.project).map((i) => `${i.kind}:${i.scene}`);
    expect(kinds).toEqual(expect.arrayContaining(['dead-acts:s07', 'dead-acts:s09', 'dead-acts:s11', 'payoff-before-setup:s04', 'time-backwards:s03']));
  });

  it('model-assisted continuity runs incrementally on changed pairs only', async () => {
    const { store, engine, agents } = await fixtureEngine();
    await engine.continuity();
    expect(agents.count('continuity')).toBe(11);
    store.saveProse('s07', store.scene('s07').prose!.body + '\n\nThe landlord came back up.', 'author');
    await engine.continuity();
    expect(agents.count('continuity')).toBe(13);
  });

  it('voice and repetition: repeated phrases, banned hits and indistinguishable voices', async () => {
    const { store } = await fixtureEngine();
    const r = voiceReport(store.project);
    expect(r.repeated_phrases.map((x) => x.phrase)).toContain('for a long time');
    expect(r.banned).toEqual([]);
    // Make Tom talk exactly like Eliza.
    for (const id of ['s03', 's06', 's09']) {
      const eliza = store.scene('s04').prose!.body.match(/'[^']+'/g)!.join(' Tom said. ');
      store.saveProse(id, store.scene(id).prose!.body.replace(/'[^']+'/g, '') + `\n\n${eliza} Tom said.`, 'author');
    }
    store.saveProse('s05', store.scene('s05').prose!.body + '\n\nIt was a testament to the delve of it.', 'author');
    const r2 = voiceReport(store.project);
    expect(r2.banned.map((b) => b.label)).toEqual(expect.arrayContaining(['delve', 'a testament to']));
  });
});
