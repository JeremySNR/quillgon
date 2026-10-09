import { describe, expect, it } from 'vitest';
import { analyseImpact, GraphStore, mechanicalShape, obligationIssues, obligationsForScene, writerContext } from '../src/index.js';
import { copyFixture } from './helpers.js';

describe('obligations ledger: setups and payoffs', () => {
  it('the fixture ledger is complete: every setup planted and paid', () => {
    const store = GraphStore.open(copyFixture(), { memoryIndex: true });
    expect(store.project.obligations.size).toBe(5);
    expect(obligationIssues(store.project)).toEqual([]);
    expect(mechanicalShape(store.project)).toEqual([]);
    store.close();
  });

  it('the writer is told what to plant, what to pay, and what to keep open', () => {
    const store = GraphStore.open(copyFixture(), { memoryIndex: true });
    const s05 = obligationsForScene(store.project, 's05');
    expect(s05.plant.map((o) => o.id)).toEqual(['two-inks']);
    // Open at s05: the storm question and Tom's silence are set up earlier and paid later.
    expect(s05.keep_open.map((o) => o.id)).toEqual(expect.arrayContaining(['storm-entry', 'tom-holds-back']));
    const s10 = obligationsForScene(store.project, 's10');
    expect(s10.pay.map((o) => o.id).sort()).toEqual(['storm-entry', 'two-inks']);
    expect(writerContext(store.project, 's10', store.index).obligations.pay).toHaveLength(2);
    store.close();
  });

  it('cutting a payoff leaves the setup dangling, and the ledger says so', () => {
    const store = GraphStore.open(copyFixture(), { memoryIndex: true });
    const c = store.scene('s11').card;
    store.saveCard({ ...c, pays_off: [] });
    store.saveObligation({ ...store.project.obligations.get('walter-letter-sent')!, payoff_scene: null, status: 'open' });
    const issues = obligationIssues(store.project);
    expect(issues).toEqual([expect.objectContaining({ obligation: 'walter-letter-sent', scene: 's06', message: expect.stringMatching(/never paid off/) })]);
    expect(mechanicalShape(store.project).map((f) => f.kind)).toContain('unpaid-setup');
    store.close();
  });

  it('a payoff moved before its setup, or before it is allowed, is flagged', () => {
    const store = GraphStore.open(copyFixture(), { memoryIndex: true });
    store.saveObligation({ ...store.project.obligations.get('two-inks')!, payoff_scene: 's08' });
    const messages = obligationIssues(store.project).map((i) => i.message);
    expect(messages.some((m) => /before it is allowed \(s09\)/.test(m))).toBe(true);
    store.saveObligation({ ...store.project.obligations.get('two-inks')!, payoff_scene: 's04' });
    expect(obligationIssues(store.project).some((i) => /before it is set up/.test(i.message))).toBe(true);
    store.close();
  });

  it('changing an obligation ripples to the scenes that plant and pay it', () => {
    const store = GraphStore.open(copyFixture(), { memoryIndex: true });
    const before = store.project.obligations.get('two-inks')!;
    const after = { ...before, description: 'The storm entry is in pencil, gone over in ink' };
    const impact = analyseImpact(store.project, { kind: 'obligation', before, after }, store.index);
    const scenes = impact.impacts.map((i) => i.scene);
    expect(scenes).toEqual(expect.arrayContaining(['s05', 's10']));
    store.close();
  });
});
