import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, GhostTurnOutput, initProject, leadingQuestion, lifeGaps, probesFor, touchesOffLimits, type AgentSuite } from '@quillgon/core';
import { ScriptedSuite } from '../src/index.js';

const turn = (p: Partial<GhostTurnOutput> = {}) => GhostTurnOutput.parse({ reply: 'Who was there?', ...p });

async function lifeBook(overrides: Partial<AgentSuite> = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'life-')), 'book');
  const store = await initProject(dir, { title: 'Harehills', kind: 'life-story', subject_name: 'Margaret Ellis', life: { born: '1948' }, offline: true });
  const agents = new ScriptedSuite(overrides);
  return { store, agents, engine: new Engine(store, agents) };
}

describe('interview checks in code', () => {
  it('finds what to follow up', () => {
    expect(probesFor('It was fine.')[0]).toMatch(/vague/);
    expect(probesFor('We always went to Scarborough in August, every summer.').join(' ')).toMatch(/one particular occasion/);
    expect(probesFor('Nobody knew, but my father had another family in Hull.').join(' ')).toMatch(/surprising/);
    expect(probesFor('I was so ashamed I cried all the way home on the bus that night.').join(' ')).toMatch(/strong feeling/);
  });

  it('refuses leading questions and off-limits topics', () => {
    expect(leadingQuestion('Was it raining that morning?', 'I walked to the factory that morning')).toMatch(/raining/);
    expect(leadingQuestion('What was the weather like, if you remember?', '')).toBeNull();
    expect(leadingQuestion('Was Jean there?', 'Jean sat next to me')).toBeNull();
    expect(leadingQuestion('Was Jean older than you?', 'Jean sat next to me')).toMatch(/older/);
    expect(touchesOffLimits('How did the divorce affect Claire?', ['the divorce'])).toBe('the divorce');
    expect(touchesOffLimits('Tell me about the wedding.', ['the divorce'])).toBeNull();
  });

  it('finds empty stretches of a life', () => {
    expect(lifeGaps('1948', ['1955', '1962', '1966', '1983', '1994'], 2000)).toEqual(['1949 to 1954', '1956 to 1961', '1967 to 1982', '1984 to 1993']);
    expect(lifeGaps('1948', ['1955', '1962', '1966', '1983', '1994'], 2000, 11)).toEqual(['1967 to 1982']);
    expect(lifeGaps('', [], 2000)).toEqual([]);
  });
});

describe('an interview session', () => {
  it('plans from the question queue, files an answer into a story, and climbs the ladder', async () => {
    const { store, engine } = await lifeBook({
      ghostTurn: async () =>
        turn({
          reply: 'Can you remember one particular day with her?',
          technique: 'One particular time',
          story: { id: 'burtons', title: "Starting at Burton's", summary: null, when: '1962', precision: 'year', place: "Burton's, Hudson Road", key: 'turning' },
          ladder: { happened: 'yes', people: 'some' },
          details: [{ text: 'Forty machines going at once', certainty: 'sure' }],
          quotes: [{ text: "Don't you dare cry in front of him, love.", who: 'jean-pickles' }],
          people: [{ id: 'jean-pickles', name: 'Jean Pickles', relationship: "workmate at Burton's" }],
          events: [{ when: '1962', description: "Started at Burton's", precision: 'year', key: 'turning' }],
          questions: [{ text: 'Ask Peter whether Dad walked you there', why: 'He may remember', about: 'story:burtons', ask: '', priority: 2 }],
          voice: ['says "our Peter"'],
          agenda_done: [0],
        }),
    });
    const s = await engine.interviews.start();
    expect(s.turns[0].role).toBe('ghostwriter');
    expect(s.turns[0].text).toContain('chapters');
    expect(s.agenda[0].question_id).toBe('q-chapters');
    expect(store.project.questions.questions.find((q) => q.id === 'q-chapters')?.status).toBe('asked');

    const after = await engine.interviews.answer(s.id, { text: "I started at Burton's in 1962. Jean Pickles sat next to me.", raw: 'um I started at Burtons', audio: ['01.wav'], seconds: 6 });
    const p = store.project;
    const story = p.stories.get('burtons')!;
    expect(story).toMatchObject({ title: "Starting at Burton's", when: '1962', key: 'turning', people: ['jean-pickles'] });
    expect(story.ladder).toMatchObject({ happened: 'yes', people: 'some', instance: 'no' });
    expect(story.quotes[0]).toMatchObject({ text: "Don't you dare cry in front of him, love.", from: { session: s.id, turn: 1 } });
    expect(p.characters.get('jean-pickles')?.bio).toMatchObject({ name: 'Jean Pickles', relationship: "workmate at Burton's", consent: 'not-asked' });
    expect(p.timeline.events.map((e) => e.description)).toContain("Started at Burton's");
    expect(p.questions.questions.some((q) => q.text.startsWith('Ask Peter'))).toBe(true);
    expect(p.notebook.voice).toEqual(['says "our Peter"']);
    const gw = after.turns[2];
    expect(gw).toMatchObject({ role: 'ghostwriter', text: 'Can you remember one particular day with her?', story: 'burtons' });
    expect(gw.changes.map((c) => c.path)).toEqual(['person:jean-pickles', 'story:burtons', 'timeline', 'questions', 'notebook']);
    expect(after.turns[1]).toMatchObject({ role: 'author', audio: ['01.wav'], raw: 'um I started at Burtons', story: null });
    expect(after.agenda[0].done).toBe(true);

    // Undo takes back what the exchange filed (the new person stays, as a name).
    const undone = engine.interviews.undo(s.id, 2);
    expect(undone.turns[2].undone).toBe(true);
    expect(store.project.stories.has('burtons')).toBe(false);
    expect(store.project.timeline.events).toEqual([]);
    expect(store.project.notebook.voice).toEqual([]);

    const ended = await engine.interviews.end(s.id);
    expect(ended.ended).not.toBeNull();
    expect(ended.summary).toMatch(/We talked/);
    expect(store.project.questions.questions.find((q) => q.id === 'q-chapters')?.status).toBe('answered');
    expect(engine.interviews.active()).toBeNull();
  });

  it('replaces a leading question, twice refused, with an open one', async () => {
    let calls = 0;
    const { engine, agents } = await lifeBook({
      ghostTurn: async (i) => {
        calls++;
        return turn({ reply: i.retry ? 'Was the foreman cruel to you?' : 'Was it raining that morning?', story: { id: 'first-day', title: 'First day', summary: null, when: null, precision: null, place: null, key: null }, ladder: { happened: 'yes' } });
      },
    });
    const s = await engine.interviews.start();
    const out = await engine.interviews.answer(s.id, { text: 'My first day I walked down Hudson Road to the gate.' });
    expect(calls).toBe(2);
    expect((agents as ScriptedSuite).calls.filter((c) => c.method === 'ghostTurn')[1].input).toMatchObject({ retry: expect.stringContaining('raining') });
    const last = out.turns.at(-1)!;
    expect(last.text).toBe('Can you remember one particular time? Tell me about that one.');
    expect(last.technique).toBe('Open question');
  });

  it('files nothing said off the record, and never sends it to the model', async () => {
    const { store, engine, agents } = await lifeBook({ ghostTurn: async () => turn({ reply: 'That stays off the record. Shall we go on?', story: { id: 'secret', title: 'Secret', summary: null, when: null, precision: null, place: null, key: null }, details: [{ text: 'x', certainty: 'sure' }] }) });
    const s = await engine.interviews.start();
    const out = await engine.interviews.answer(s.id, { text: 'My father had another family.', signal: 'off-record' });
    expect(out.turns[1]).toMatchObject({ off_record: true });
    expect(out.turns[2].changes).toEqual([]);
    expect(store.project.stories.size).toBe(0);
    const sent = JSON.stringify((agents as ScriptedSuite).calls.filter((c) => c.method === 'ghostTurn').map((c) => c.input));
    expect(sent).not.toContain('another family');
  });

  it('keeps someone else’s account as their version of the story', async () => {
    const { store, engine } = await lifeBook({
      ghostTurn: async () => turn({ story: { id: 'burtons', title: "Burton's", summary: null, when: null, precision: null, place: null, key: null }, details: [{ text: 'Dad drove her there in the van', certainty: 'sure' }] }),
    });
    const s = await engine.interviews.start({ speaker: 'Peter' });
    await engine.interviews.answer(s.id, { text: 'Dad drove her there in the van.' });
    const story = store.project.stories.get('burtons')!;
    expect(story.details).toEqual([]);
    expect(story.versions[0]).toMatchObject({ by: 'Peter', text: 'Dad drove her there in the van' });
  });

  it('never plans or asks about what is off limits', async () => {
    const { store, engine } = await lifeBook({
      ghostPlan: async () => ({ title: 'x', agenda: [{ topic: 'Your divorce', why: '', question: 'Tell me about the divorce.', story: null, question_id: null }], opening: 'Tell me about the divorce.', technique: '' }),
    });
    store.saveNotebook({ off_limits: ['the divorce'] });
    const s = await engine.interviews.start();
    expect(s.agenda.map((a) => a.topic)).toEqual(['Anything you would like to tell me']);
    expect(s.turns[0].text).toBe('What would you like to talk about today?');
  });

  it('runs a whole session with the offline ghostwriter', async () => {
    const { store, engine } = await lifeBook({});
    const s = await engine.interviews.start();
    let cur = await engine.interviews.answer(s.id, { text: "In 1962 I started at Burton's on Hudson Road. Jean Pickles sat next to me and showed me the felling." });
    const story = [...store.project.stories.values()][0];
    expect(story.ladder.happened).toBe('yes');
    expect(store.project.characters.has('jean-pickles')).toBe(true);
    cur = await engine.interviews.answer(s.id, { text: 'The machines were so loud. Jean said "Don\'t you dare cry in front of him, love." I felt scared. Looking back, I think she was protecting me.' });
    expect(store.project.stories.get(story.id)!.quotes[0].text).toBe("Don't you dare cry in front of him, love.");
    cur = await engine.interviews.answer(s.id, { text: '', signal: 'dont-remember' });
    expect(cur.turns.at(-1)!.text).toMatch(/^That’s fine\./);
    const ended = await engine.interviews.end(s.id);
    expect(ended.summary).toMatch(/We talked for 3 answers/);
  });
});
