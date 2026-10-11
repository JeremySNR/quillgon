import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adviceWording, checkSums, datedFigures, Engine, enoughForScene, initProject, leadingQuestion, nextRung, unbackedClaims, type AgentSuite } from '@quillgon/core';
import { ScriptedSuite } from '../src/index.js';

describe('checks a guide needs', () => {
  it('a figure needs the author or the evidence behind it; explanation does not', () => {
    const prose = [
      'Most of my clients double their reply rate in a month.',
      'Studies show that 80% of sales happen after the fifth call.',
      'In 2023, 61% of buyers said they had ignored a cold email.',
      'Follow-up is about being useful, not being persistent.',
    ].join(' ');
    const support = ['Most of my clients double their reply rate in a month', '61% of buyers said they had ignored a cold email in the last year'];
    expect(unbackedClaims(prose, support)).toEqual(['Studies show that 80% of sales happen after the fifth call.']);
  });

  it('finance: figures that date need a date, and advice wording is flagged', () => {
    const prose = 'The personal allowance is £12,570. In the 2025/26 tax year, the ISA allowance is £20,000. You should buy an index fund today. Index funds spread your money across many companies.';
    expect(datedFigures(prose, '')).toEqual(['The personal allowance is £12,570.']);
    expect(adviceWording(prose)).toEqual(['You should buy an index fund today.']);
    expect(adviceWording('This is a guaranteed return of 8% a year.')).toHaveLength(1);
  });

  it('worked examples are added up again', () => {
    const text = [
      '10% of £2,000 is £200.',
      '15% of £3,000 is £400.',
      '£150 × 12 = £1,900.',
      '£200 a month for 5 years comes to £12,000.',
      '£1,000 at 5% a year for 10 years grows to £1,629.',
      '£1,000 at 5% a year for 10 years grows to £1,500.',
    ].join(' ');
    const bad = checkSums(text);
    expect(bad.map((b) => b.stated)).toEqual([400, 1900, 1500]);
    expect(bad[0].expected).toBe(450);
    expect(bad[1].expected).toBe(1800);
    expect(bad[2].expected).toBe(1629);
  });

  it('a lesson climbs its own ladder', () => {
    const l = { idea: 'yes', case: 'no', when: 'no', steps: 'yes', mistakes: 'no', why: 'no', practice: 'no' } as const;
    expect(nextRung(l)).toBe('case');
    expect(enoughForScene({ ladder: l })).toBe(false);
    expect(enoughForScene({ ladder: { ...l, case: 'some', mistakes: 'some' } })).toBe(true);
  });

  it('another book’s view, quoted from research, is not a leading question', () => {
    const research = ['"The Follow-Up Book" by J. Smith teaches the five-touch plan.'];
    expect(leadingQuestion('Does the five-touch plan match what you do?', '', research)).toBeNull();
    expect(leadingQuestion('Do you always call on a Tuesday morning?', '', research)).not.toBeNull();
  });
});

async function guide(preset: 'coaching' | 'finance' = 'coaching', overrides: Partial<AgentSuite> = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guide-')), 'book');
  const store = await initProject(dir, { title: 'Close More', kind: 'guide', subject_name: 'Sam Reed', offline: true, guide: { preset, reader: 'new B2B sales reps', promise: 'book twice as many meetings', jurisdiction: preset === 'finance' ? 'UK' : '', as_of: preset === 'finance' ? '2025/26' : '' } });
  return { store, engine: new Engine(store, new ScriptedSuite(overrides)) };
}

describe('a guide, offline end to end', () => {
  it('starts with the reader and the promise, not a life', async () => {
    const { store } = await guide('finance');
    const b = store.project.book;
    expect(b.kind).toBe('guide');
    expect(b.guide).toMatchObject({ preset: 'finance', reader: 'new B2B sales reps', jurisdiction: 'UK' });
    expect(b.life.audience).toBe('public');
    const ids = store.project.questions.questions.map((q) => q.id);
    expect(ids.slice(0, 3)).toEqual(['q-reader', 'q-promise', 'q-wrong']);
    expect(ids).toContain('q-where');
    expect(ids).not.toContain('q-earliest');
  });

  it('files a lesson by its parts, drafts it with gaps rather than inventions, and checks the sums', async () => {
    const { store, engine } = await guide();
    let s = await engine.interviews.start();
    s = await engine.interviews.answer(s.id, { text: 'The third call is where deals are won. First, you open with what changed since last time. Then you ask one question about their deadline. Most people give up after two calls. It works because buyers are busy, not uninterested. 10% of 2,000 is 300.' });
    const lesson = [...store.project.stories.values()][0];
    expect(lesson.ladder).toMatchObject({ idea: 'yes', steps: 'yes', mistakes: 'yes', why: 'yes', case: 'no' });
    expect(lesson.ladder.happened).toBeUndefined();
    expect(lesson.details.filter((d) => d.part === 'step')).toHaveLength(2);
    // The next question climbs the lesson ladder: a real case.
    expect(s.turns.at(-1)!.text).toMatch(/last time you used it/);
    // The file keeps only a lesson's rungs.
    const yaml = fs.readFileSync(path.join(store.dir, 'stories', `${lesson.id}.yaml`), 'utf8');
    expect(yaml).not.toMatch(/felt_then|senses/);
    await engine.interviews.end(s.id);

    await engine.life.proposeShape();
    const [ch] = await engine.life.acceptShape();
    expect(store.project.book.guide.shape).toBe('framework');
    const [sid] = await engine.life.draftChapter(ch.id);
    const prose = store.project.scenes.get(sid)!.prose!.body;
    expect(prose).toContain('[TK: a real example]');
    expect(prose).toContain('1. First, you open with what changed since last time.');
    const kinds = (store.project.scenes.get(sid)!.notes?.notes ?? []).map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['gap', 'example', 'maths']));
    const maths = store.project.scenes.get(sid)!.notes!.notes.find((n) => n.kind === 'maths')!;
    expect(maths.text).toMatch(/200/);

    const review = engine.life.shareReview();
    expect(review.claims.map((c) => c.kind)).toContain('maths');
    // Explanation in the ghostwriter's words is not flagged as unsourced in a guide.
    expect(review.unsourced.filter((u) => u.reason === 'no-source')).toEqual([]);
  });

  it('a finance guide gets a disclaimer, and the draft only states facts from the evidence it was given', async () => {
    let seen: Parameters<AgentSuite['ghostDraft']>[0] | null = null;
    const { store, engine } = await guide('finance', {
      ghostDraft: async (i) => {
        seen = i;
        return { scenes: [{ title: 'Your allowance', stories: [i.stories[0].id], when: '', place: '', people: [], then: '', now: '', prose: 'The personal allowance is £12,570. Studies show 70% of people never check their tax code. You should buy premium bonds.', notes: [] }], needs_decision: [] };
      },
    });
    store.saveResearch({
      sources: [{ id: 'web-gov', kind: 'web', title: 'Income Tax rates and Personal Allowances', publisher: 'GOV.UK', url: 'https://www.gov.uk/income-tax-rates' }],
      evidence: [
        { id: 'ev-allowance', claim: 'The standard Personal Allowance is £12,570', quote: 'The standard Personal Allowance is £12,570', source: 'web-gov', check: 'found', topic: 'personal allowance tax', as_of: '2025/26', jurisdiction: 'UK' },
        { id: 'ev-other', claim: 'Something about mortgages and housing', quote: 'x', source: 'web-gov', check: 'found', topic: 'mortgages' },
        { id: 'ev-bad', claim: 'Personal allowance tax trick', quote: 'y', source: 'web-gov', check: 'not-found', topic: 'personal allowance' },
      ],
    });
    store.saveStory({ id: 'tax-code', title: 'Check your tax code', summary: 'Your personal allowance and tax code decide how much tax comes off your pay', ladder: { idea: 'yes', case: 'yes', steps: 'yes', mistakes: 'yes' } });
    await engine.life.proposeShape();
    const [ch] = await engine.life.acceptShape();
    const [sid] = await engine.life.draftChapter(ch.id);
    expect(seen!.kind).toBe('guide');
    expect(seen!.evidence.map((e) => e.id)).toEqual(['ev-allowance']);
    expect(seen!.evidence[0]).toMatchObject({ source: 'GOV.UK: Income Tax rates and Personal Allowances', as_of: '2025/26' });
    const kinds = store.project.scenes.get(sid)!.notes!.notes.map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['dated', 'evidence', 'advice']));
    // The allowance is backed by the evidence; the unsourced statistic is not.
    expect(store.project.scenes.get(sid)!.notes!.notes.find((n) => n.kind === 'evidence')!.quote).toMatch(/^Studies show 70%/);
    const note = engine.life.authorsNote();
    expect(note).toMatch(/not personal financial advice/);
    expect(note).toMatch(/for UK as of 2025\/26/);
  });
});
