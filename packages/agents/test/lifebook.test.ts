import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, initProject, unsourced, EMPTY_LADDER, type AgentSuite, type Story } from '@quillgon/core';
import { ScriptedSuite } from '../src/index.js';

const full = { ...EMPTY_LADDER, happened: 'yes', instance: 'yes', people: 'yes', senses: 'yes', words: 'yes', felt_then: 'yes', means_now: 'some' } as const;

async function bookWithStories(overrides: Partial<AgentSuite> = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lifebook-')), 'book');
  const store = await initProject(dir, { title: 'Harehills', kind: 'life-story', subject_name: 'Margaret Ellis', life: { born: '1948' }, offline: true });
  const engine = new Engine(store, new ScriptedSuite(overrides));
  store.saveCharacter({ bio: { id: 'jean-pickles', name: 'Jean Pickles', relationship: 'workmate' } });
  const stories: Partial<Story>[] = [
    {
      id: 'the-belt',
      title: 'The belt',
      when: '1962',
      place: "Burton's",
      people: ['jean-pickles'],
      ladder: full,
      details: [{ text: 'The belt came off the big machine with a crack like a gun', from: null, source: 'memory', certainty: 'sure' }],
      quotes: [{ text: "Don't you dare cry in front of him, love.", who: 'jean-pickles', from: null }],
      then: 'I froze.',
      now: 'I think she knew what he was like with the young girls.',
    },
    { id: 'scarborough', title: 'Scarborough', when: '1955', summary: 'We went to Scarborough on the train', ladder: { ...EMPTY_LADDER, happened: 'yes' }, versions: [{ text: 'We went by coach', from: null, by: 'Peter' }] },
    { id: 'dad', title: 'Dad', sensitive: true, ladder: full },
  ];
  for (const st of stories) store.saveStory(st);
  return { store, engine };
}

describe('the source check', () => {
  it('flags sentences nothing the author said supports, and quotes that are not word for word', () => {
    const material = ['The belt came off the big machine with a crack like a gun', 'Jean Pickles', "Burton's"];
    const quotes = ["Don't you dare cry in front of him, love."];
    const prose = [
      'The belt came off the big machine with a crack like a gun.',
      'The foreman docked a penny for every crooked seam, and the women whispered about his temper.',
      '“Don’t you dare cry in front of him, love.”',
      '“Never let them see you weep, my dear girl.”',
      'I went home.',
      '[TK: the street name] was quiet.',
    ].join(' ');
    const out = unsourced(prose, material, quotes);
    expect(out.map((x) => x.reason)).toEqual(['quote-changed', 'no-source']);
    expect(out[0].text).toContain('Never let them see you weep');
    expect(out[1].text).toContain('foreman docked a penny');
  });
});

describe('chapters of a life story', () => {
  it('proposes a shape from the stories and adopts it', async () => {
    const { store, engine } = await bookWithStories();
    const proposal = await engine.life.proposeShape('chronological');
    // By decade; the undated story goes with the chapter before it.
    expect(proposal.chapters.map((c) => [c.title, c.stories])).toEqual([
      ['The 1950s', ['scarborough']],
      ['The 1960s', ['the-belt', 'dad']],
    ]);
    const chapters = await engine.life.acceptShape();
    expect(chapters.map((c) => c.id)).toEqual(['the-1950s', 'the-1960s']);
    expect(store.project.stories.get('the-belt')?.chapter).toBe('the-1960s');
    expect(store.project.book.life.shape).toBe('chronological');
    expect(engine.life.stageOf('the-1960s')).toBe('ready');
    expect(engine.life.stageOf('the-1950s')).toBe('gathering');
  });

  it('drafts a chapter from its stories only, with notes where it is thin', async () => {
    const { store, engine } = await bookWithStories();
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    const ids = await engine.life.draftChapter('the-1950s');
    expect(ids).toEqual(['the-1950s-s1']);
    const scene = store.project.scenes.get(ids[0])!;
    expect(scene.card).toMatchObject({ pov: 'margaret-ellis', stories: ['scarborough'], time: '1955' });
    expect(scene.prose?.body).toContain('[TK: where this happened]');
    const kinds = scene.notes!.notes.map((n) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['gap', 'thin', 'versions']));
    expect(scene.notes!.notes.find((n) => n.kind === 'versions')?.options).toContain('Peter');
    expect(store.project.structure.acts[0].chapters.find((c) => c.id === 'the-1950s')).toMatchObject({ stage: 'notes', round: 1, scenes: ids });
    expect(store.project.book.life.voice_sample).toBe('the-1950s');
    expect(store.sceneSync(ids[0]).state).toBe('in_sync');
  });

  it('adds a note for every invented sentence and altered quote', async () => {
    const { store, engine } = await bookWithStories({
      ghostDraft: async () => ({
        scenes: [
          {
            title: 'The belt',
            stories: ['the-belt'],
            when: '1962',
            place: "Burton's",
            people: ['jean-pickles'],
            then: '',
            now: '',
            prose: 'The belt came off the big machine with a crack like a gun. “Never let them see you weep, my dear girl,” said Jean. The foreman docked a penny for every crooked seam, and the women whispered about his temper.',
            notes: [],
          },
        ],
        needs_decision: [],
      }),
    });
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    const [id] = await engine.life.draftChapter('the-1960s');
    const notes = store.project.scenes.get(id)!.notes!.notes;
    expect(notes.map((n) => n.kind)).toEqual(['source', 'source']);
    expect(notes[0].text).toMatch(/word for word/);
    expect(notes[1].quote).toContain('foreman docked a penny');
  });

  it('turns answers into material, and "later" into a question for the next session', async () => {
    const { store, engine } = await bookWithStories();
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    const [id] = await engine.life.draftChapter('the-1950s');
    const gap = store.project.scenes.get(id)!.notes!.notes.find((n) => n.kind === 'gap')!;
    engine.life.answerNote(id, gap.id, { answer: 'The station at Leeds, then the front at Scarborough' });
    expect(store.project.stories.get('scarborough')?.details.map((d) => d.text)).toContain('The station at Leeds, then the front at Scarborough');
    const thin = store.project.scenes.get(id)!.notes!.notes.find((n) => n.kind === 'thin')!;
    engine.life.answerNote(id, thin.id, { status: 'later' });
    expect(store.project.questions.questions.find((q) => q.about === `scene:${id}`)).toMatchObject({ status: 'queued', priority: 1 });
    expect(engine.life.openNotes('the-1950s').map((x) => x.note.kind)).toEqual(['versions']);
  });

  it('signs a chapter off, and keeps the pen with the author when asked', async () => {
    const { store, engine } = await bookWithStories();
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    const [id] = await engine.life.draftChapter('the-1950s');
    await engine.life.approve('the-1950s');
    expect(store.project.scenes.get(id)!.card).toMatchObject({ status: 'approved', lock: 'both' });
    await expect(engine.life.draftChapter('the-1950s')).rejects.toThrow(/reopen/);
    await engine.life.reopen('the-1950s');
    expect(store.project.scenes.get(id)!.card.lock).toBe('none');
    store.updateBook({ life: { ...store.project.book.life, pen: 'interviewer' } });
    await expect(engine.life.draftChapter('the-1960s')).rejects.toThrow(/holding the pen/);
  });

  it('keeps sensitive stories out of drafts', async () => {
    const { store, engine } = await bookWithStories();
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    engine.life.assignStory('dad', 'the-1960s');
    const ids = await engine.life.draftChapter('the-1960s');
    expect(ids.map((x) => store.project.scenes.get(x)!.card.stories)).toEqual([['the-belt']]);
  });
});

describe('revision rounds', () => {
  const prose = "Whilst the other girls talked, I sat alone. The belt came off the big machine with a crack like a gun. Jean leaned over. “Don't you dare cry in front of him, love.” And I didn't.";
  async function drafted(revise: AgentSuite['ghostRevise']) {
    const { store, engine } = await bookWithStories({
      ghostDraft: async () => ({ scenes: [{ title: 'The belt', stories: ['the-belt'], when: '1962', place: "Burton's", people: ['jean-pickles'], then: '', now: '', prose, notes: [] }], needs_decision: [] }),
      ghostRevise: revise,
    });
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    const [id] = await engine.life.draftChapter('the-1960s');
    return { store, engine, id };
  }

  it('reads back a plan, guards the author’s exact words, and applies the round as one commit', async () => {
    const { store, engine, id } = await drafted(async () => ({
      plan: [
        { text: 'Use “while” instead of “whilst”, here and in every chapter.', kind: 'rule', never: ['whilst'], prefer: [{ avoid: 'whilst', use: 'while' }], guidance: [], question: '' },
        { text: 'Make Jean’s line gentler.', kind: 'edit', never: [], prefer: [], guidance: [], question: '' },
        { text: 'I would keep the last line short; it lands harder.', kind: 'pushback', never: [], prefer: [], guidance: [], question: '' },
        { text: 'Ask for a moment that shows what Dad was like then.', kind: 'question', never: [], prefer: [], guidance: [], question: 'Can you tell me about a moment that shows what Dad was like then?' },
      ],
      edits: [
        { scene: id, find: 'Whilst the other girls talked', replace: 'While the other girls talked', reason: 'Your word.', plan: [0] },
        { scene: id, find: "“Don't you dare cry in front of him, love.”", replace: '“Chin up, pet.”', reason: 'Gentler.', plan: [1] },
        { scene: id, find: 'not in the text', replace: 'x', reason: '', plan: [] },
        { scene: id, find: 'And I didn\'t.', replace: 'And I didn\'t. The foreman glared at the whole row of trembling apprentices.', reason: '', plan: [] },
      ],
      resolved: [],
      notes: [],
    }));
    const r = await engine.life.revise('the-1960s', "It's too posh. I'd never say whilst.");
    expect(store.project.structure.acts[0].chapters.find((c) => c.id === 'the-1960s')?.stage).toBe('revising');
    expect(r.items.map((x) => x.find)).toEqual(['Whilst the other girls talked', "And I didn't."]);
    expect(r.refused.map((x) => x.why)).toEqual([expect.stringContaining('your exact words'), expect.stringContaining('not in the scene')]);
    expect(r.items[1].warning).toMatch(/Nothing you said covers/);

    engine.life.decide('the-1960s', { item: r.items[1].id, decision: 'rejected' });
    engine.life.decide('the-1960s', { overrule: 2 });
    const before = (await store.repo.log(1))[0];
    const out = await engine.life.applyRevision('the-1960s');
    expect(out).toEqual({ applied: 1, rules: 1, questions: 1 });
    const body = store.project.scenes.get(id)!.prose!.body;
    expect(body).toContain('While the other girls talked');
    expect(body).toContain("Don't you dare cry in front of him, love.");
    expect(body).not.toContain('foreman glared');
    expect(store.project.style.sheet.never).toContain('whilst');
    expect(store.project.style.sheet.prefer).toContainEqual({ avoid: 'whilst', use: 'while' });
    expect(store.project.questions.questions.some((q) => q.about === 'chapter:the-1960s')).toBe(true);
    expect(store.project.notebook.decisions[0]).toMatch(/Kept as I wrote it/);
    expect(store.project.structure.acts[0].chapters.find((c) => c.id === 'the-1960s')).toMatchObject({ stage: 'notes', round: 2 });
    const after = (await store.repo.log(1))[0];
    expect(after.hash).not.toBe(before.hash);
    expect(after.message).toBe('Revision 2: The 1960s');
    expect(engine.life.revision('the-1960s')).toBeNull();
  });

  it('revises with the answers to the notes, offline', async () => {
    const { store, engine } = await bookWithStories();
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    const [id] = await engine.life.draftChapter('the-1950s');
    const gap = store.project.scenes.get(id)!.notes!.notes.find((n) => n.kind === 'gap')!;
    engine.life.answerNote(id, gap.id, { answer: 'the station at Leeds' });
    const r = await engine.life.revise('the-1950s', 'I would never say whilst');
    expect(r.plan.map((p) => p.kind)).toEqual(['edit', 'rule']);
    await engine.life.applyRevision('the-1950s');
    const scene = store.project.scenes.get(id)!;
    expect(scene.prose!.body).toContain('In 1955, the station at Leeds.');
    expect(scene.prose!.body).not.toContain('[TK:');
    expect(scene.notes!.notes.find((n) => n.id === gap.id)?.status).toBe('resolved');
  });

  it('refuses to revise a signed-off chapter or when the author holds the pen', async () => {
    const { store, engine } = await drafted(async () => ({ plan: [{ text: 'x', kind: 'edit', never: [], prefer: [], guidance: [], question: '' }], edits: [], resolved: [], notes: [] }));
    await engine.life.approve('the-1960s');
    await expect(engine.life.revise('the-1960s', 'x')).rejects.toThrow(/reopen/);
    await engine.life.reopen('the-1960s');
    store.updateBook({ life: { ...store.project.book.life, pen: 'interviewer' } });
    await expect(engine.life.revise('the-1960s', 'x')).rejects.toThrow(/holding the pen/);
  });
});

describe('the timeline and the pre-sharing check', () => {
  it('carries a corrected date into the stories and scenes it belongs to, with a note to check', async () => {
    const { store, engine } = await bookWithStories();
    const ev = engine.life.addEvent({ when: '1955', description: 'Scarborough trip', stories: ['scarborough'] });
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    const [id] = await engine.life.draftChapter('the-1950s');
    const out = engine.life.updateEvent(ev.id, { when: '1956' });
    expect(out.affected).toEqual([id]);
    expect(store.project.stories.get('scarborough')?.when).toBe('1956');
    expect(store.project.scenes.get(id)?.card.time).toBe('1956');
    expect(store.project.scenes.get(id)?.notes?.notes.at(-1)?.text).toMatch(/changed from 1955 to 1956/);
    expect(store.sceneSync(id).state).toBe('in_sync');
  });

  it('lists what to settle before the book is shared, and writes an author’s note from the choices made', async () => {
    const { store, engine } = await bookWithStories({
      ghostDraft: async () => ({
        scenes: [{ title: 'The belt', stories: ['the-belt'], when: '1962', place: "Burton's", people: ['jean-pickles'], then: '', now: '', prose: 'The belt came off the big machine with a crack like a gun. The foreman docked a penny for every crooked seam, and the women whispered about his temper. [TK: what happened next]', notes: [] }],
        needs_decision: [],
      }),
    });
    store.updateBook({ life: { ...store.project.book.life, audience: 'public' } });
    store.saveCharacter({ bio: { ...store.project.characters.get('jean-pickles')!.bio, living: true, naming: 'pseudonym' } });
    await engine.life.proposeShape();
    await engine.life.acceptShape();
    await engine.life.draftChapter('the-1960s');
    const r = engine.life.shareReview();
    expect(r.unsourced.map((u) => u.text)).toEqual([expect.stringContaining('foreman docked a penny')]);
    expect(r.gaps.map((g) => g.marker)).toEqual(['[TK: what happened next]']);
    expect(r.people[0]).toMatchObject({ id: 'jean-pickles', flag: 'high', scenes: 1 });
    expect(r.unapproved.map((c) => c.id)).toEqual(['the-1960s']);
    expect(r.authors_note).toMatch(/Some names have been changed/);
    expect(r.authors_note).not.toMatch(/written for my family/);
    // Confirming the sentence is true clears it from the check.
    const note = store.project.scenes.get('the-1960s-s1')!.notes!.notes.find((n) => n.kind === 'source')!;
    engine.life.answerNote('the-1960s-s1', note.id, { answer: 'It’s true', status: 'answered' });
    expect(engine.life.shareReview().unsourced).toEqual([]);
  });
});
