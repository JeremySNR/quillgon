import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ageAt, EMPTY_LADDER, enoughForScene, GraphStore, initProject, ladderScore, loadProject, nextRung, yearOf } from '../src/index.js';
import { copyFixture } from './helpers.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'life-')), 'book');

describe('life-story books', () => {
  it('creates a life story with a narrator, an opening question bank and recordings kept out of git', async () => {
    const dir = tmp();
    const store = await initProject(dir, { title: 'The House on Harehills Lane', kind: 'life-story', subject_name: 'Margaret Ellis', life: { born: '1948' }, offline: true });
    const p = store.project;
    expect(p.book).toMatchObject({ kind: 'life-story', pov_mode: 'first', stage: 'intent', genre: 'life story', target_words: 40000 });
    expect(p.book.life).toMatchObject({ subject: 'other', narrator: 'margaret-ellis', born: '1948', pen: 'ghostwriter', audience: 'family' });
    expect(p.characters.get('margaret-ellis')?.bio).toMatchObject({ name: 'Margaret Ellis', role: 'narrator', consent: 'not-asked', living: true });
    expect(p.questions.questions.map((q) => q.id)).toContain('q-chapters');
    expect(p.structure.acts).toEqual([{ id: 'life', title: '', chapters: [] }]);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('audio/');
    for (const d of ['stories', 'sessions', 'ghostwriter']) expect(fs.existsSync(path.join(dir, d))).toBe(true);
    expect(store.errors()).toEqual([]);
    store.close();

    const own = await initProject(tmp(), { title: 'Mine', kind: 'memoir', offline: true });
    expect(own.project.book.life).toMatchObject({ subject: 'self', narrator: 'me' });
    expect(own.project.characters.get('me')?.bio.consent).toBe('not-needed');
    own.close();
  });

  it('leaves a novel untouched: no life fields in its files, no audio rule', async () => {
    const dir = tmp();
    const store = await initProject(dir, { title: 'A Novel', offline: true });
    expect(store.project.book.kind).toBe('novel');
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).not.toContain('audio/');
    store.close();
    const fixture = copyFixture();
    const s = GraphStore.open(fixture, { noIndex: true });
    s.saveCharacter({ bio: s.project.characters.get('mara')!.bio });
    expect(fs.readFileSync(path.join(fixture, 'characters/mara/bio.md'), 'utf8')).not.toMatch(/consent|naming|relationship/);
    s.close();
  });

  it('saves and reloads stories, sessions, questions, notebook and margin notes, and checks their references', async () => {
    const dir = tmp();
    const store = await initProject(dir, { title: 'T', kind: 'life-story', offline: true });
    store.saveStructure({ acts: [{ id: 'life', title: '', chapters: [{ id: 'ch-1', title: "Burton's", scenes: [], stories: ['the-belt'] }] }] });
    store.saveSession({ id: 'session-1', started: '2026-10-11T10:00:00Z', turns: [{ role: 'ghostwriter', text: 'Tell me about Jean.' }, { role: 'author', text: 'She sat next to me.' }] });
    store.saveStory({ id: 'the-belt', title: 'The belt', people: ['me', 'jean'], chapter: 'ch-1', quotes: [{ text: "Don't you dare cry in front of him, love.", who: 'jean', from: { session: 'session-1', turn: 1 } }] });
    store.saveNotebook({ off_limits: ['the divorce'] });
    store.saveCard({ id: 's01', title: 'The felling table', pov: 'me', location: 'burtons', stories: ['the-belt'], then: 'I was fourteen.', now: 'I see what she meant.' });
    store.saveNotes('s01', { notes: [{ id: 'n1', kind: 'gap', quote: 'street?', text: 'Which street was Burton’s on?' }] });
    store.saveAudio('session-1', '01.wav', new Uint8Array([1, 2, 3]));
    expect(store.readAudio('session-1', '01.wav')).toEqual(Buffer.from([1, 2, 3]));
    expect(() => store.saveAudio('../x', '01.wav', new Uint8Array())).toThrow();
    const { project, issues } = loadProject(dir);
    expect(project.stories.get('the-belt')?.quotes[0].text).toContain('cry in front of him');
    expect(project.sessions.get('session-1')?.turns).toHaveLength(2);
    expect(project.notebook.off_limits).toEqual(['the divorce']);
    expect(project.scenes.get('s01')?.notes?.notes[0].kind).toBe('gap');
    expect(project.scenes.get('s01')?.card).toMatchObject({ then: 'I was fourteen.', stories: ['the-belt'] });
    expect(issues.filter((i) => i.message.includes('person "jean"'))).toHaveLength(1);
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
    store.close();
  });

  it('measures how far a story has been drawn out', () => {
    const l = { ...EMPTY_LADDER, happened: 'yes', instance: 'yes', people: 'yes', words: 'some', means_now: 'yes' } as const;
    expect(ladderScore(EMPTY_LADDER)).toBe(0);
    expect(ladderScore(l)).toBeCloseTo(4.5 / 7);
    expect(nextRung(l)).toBe('senses');
    expect(enoughForScene({ ladder: l })).toBe(true);
    expect(enoughForScene({ ladder: { ...l, instance: 'no' } })).toBe(false);
    expect(yearOf('summer 1962')).toBe(1962);
    expect(ageAt('1948', 'about 1962')).toBe(14);
    expect(ageAt('', '1962')).toBeNull();
  });
});
