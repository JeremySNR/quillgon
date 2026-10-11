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
