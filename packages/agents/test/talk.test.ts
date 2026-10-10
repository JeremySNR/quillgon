import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTalk, Engine, IdeaBoard, initProject, revertTalk, TalkOutput } from '@quillgon/core';
import { museTalk, OfflineSuite, ScriptedSuite } from '../src/index.js';

const reply = (p: Partial<TalkOutput> = {}) => TalkOutput.parse({ reply: 'Go on.', ...p });

async function newBook(agents = new ScriptedSuite()) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'book-')), 'talk');
  const store = await initProject(dir, { title: 'Talk', offline: true });
  return { store, agents, engine: new Engine(store, agents) };
}

describe('talking it through: applying a turn to the board', () => {
  const board = IdeaBoard.parse({
    seed: 'A glasshouse watered every night',
    logline: 'Ines inherits a glasshouse someone still tends.',
    pile: [{ id: 'what-if-tended-0', kind: 'what-if', text: 'What if the gardener is her mother', status: 'new' }],
    cast: [{ id: 'ines', name: 'Ines', role: 'protagonist', want: 'to sell', need: '', wound: '', lie: '', arc: '' }],
  });

  it("files the author's words as theirs and the partner's as ideas to sort", () => {
    const { board: b, changes } = applyTalk(
      board,
      reply({
        set: { seed: null, genre: null, logline: null, paragraph: null, synopsis: null, tone: 'Humid, hushed, never spooky', ending: null },
        never: ['Never explain who waters the orchids'],
        ideas: [
          { kind: 'note', text: 'Her grandmother kept a watering log in Hungarian', from: 'author', probability: 0.5 },
          { kind: 'twist', text: 'The neighbour has been paying the water bill', from: 'partner', probability: 0.1 },
        ],
        keep: ['what-if-tended-0', 'no-such-idea'],
        cast: [
          { id: 'ines', want: '', need: 'to stop running from her family' },
          { id: 'teo', name: 'Teo', role: 'neighbour' },
          { id: 'nameless' },
        ],
      }),
    );
    expect(b.tone).toBe('Humid, hushed, never spooky');
    expect(b.never).toEqual(['Never explain who waters the orchids']);
    const mine = b.pile.find((i) => i.text.startsWith('Her grandmother'))!;
    expect(mine).toMatchObject({ mine: true, status: 'kept', persona: 'you' });
    expect(b.pile.find((i) => i.text.startsWith('The neighbour'))).toMatchObject({ mine: false, status: 'new', probability: 0.1 });
    expect(b.pile.find((i) => i.id === 'what-if-tended-0')!.status).toBe('kept');
    // Only fields the turn filled in change; unknown ids and nameless newcomers are ignored.
    expect(b.cast.find((c) => c.id === 'ines')).toMatchObject({ want: 'to sell', need: 'to stop running from her family' });
    expect(b.cast.map((c) => c.id)).toEqual(['ines', 'teo']);
    expect(b.logline).toBe(board.logline);
    expect(changes.map((c) => c.label)).toEqual([
      'Tone written',
      'Never updated',
      'Noted: Her grandmother kept a watering log in Hungarian',
      'Suggested: The neighbour has been paying the water bill',
      'Kept: What if the gardener is her mother',
      'Ines: need',
      'Added Teo',
    ]);
  });

  it('undo restores exactly what the turn replaced, and leaves later edits alone', () => {
    const { board: b, changes } = applyTalk(
      board,
      reply({
        set: { seed: null, genre: null, logline: 'Ines must decide whether to keep a glasshouse that someone else loves more.', paragraph: null, synopsis: null, tone: 'Hushed', ending: null },
        ideas: [{ kind: 'what-if', text: 'What if the orchids are evidence', from: 'partner', probability: 0.2 }],
        cast: [{ id: 'teo', name: 'Teo', role: 'neighbour' }],
        uncast: ['ines'],
      }),
    );
    expect(revertTalk(b, changes)).toEqual(board);
    // The author rewrote the tone after the turn: undo keeps their version.
    const edited = { ...b, tone: 'Warm and wet' };
    const back = revertTalk(edited, changes);
    expect(back.tone).toBe('Warm and wet');
    expect(back.logline).toBe(board.logline);
    expect(back.cast).toEqual(board.cast);
    expect(back.pile).toEqual(board.pile);
  });

  it('a turn that repeats what is already there changes nothing', () => {
    const { changes } = applyTalk(board, reply({ set: { seed: board.seed, genre: null, logline: ` ${board.logline} `, paragraph: null, synopsis: null, tone: null, ending: null }, themes: [] }));
    expect(changes).toEqual([]);
  });

  it('empty lists leave settled themes, never-rules and open questions alone', () => {
    const settled = { ...board, themes: ['inheritance'], never: ['Never explain the watering'], open: ['Who pays?'] };
    const { board: b, changes } = applyTalk(settled, reply({ themes: [], never: [], open: [] }));
    expect(b.themes).toEqual(['inheritance']);
    expect(b.never).toEqual(['Never explain the watering']);
    expect(b.open).toEqual(['Who pays?']);
    expect(changes).toEqual([]);
  });
});

describe('talking it through: the conversation', () => {
  it('sends the board, history and focus; records both sides; keeps edits the author made meanwhile', async () => {
    let engine!: Engine;
    const agents = new ScriptedSuite({
      talk: async (i) => {
        // The author keeps an idea while the partner is thinking.
        if (i.history.length) engine.ideation.mark(engine.ideation.board.pile[0].id, 'kept');
        return reply({ reply: `About ${i.focus ?? 'everything'}.`, ideas: [{ kind: 'image', text: i.history.length ? 'A rusted key under the watering can' : 'Orchids blooming out of season', from: 'partner', probability: 0.2 }] });
      },
    });
    ({ engine } = await newBook(agents));
    const I = engine.ideation;
    I.start('A glasshouse watered every night');
    await I.talk('I have a half-formed idea.');
    const b = await I.talk('  Tell me about the ending.  ', 'ending');
    const last = agents.calls.filter((c) => c.method === 'talk').at(-1)!.input as any;
    expect(last.board.seed).toBe('A glasshouse watered every night');
    expect(last.board).not.toHaveProperty('talk');
    expect(last.history.map((h: any) => h.role)).toEqual(['author', 'partner']);
    expect(last).toMatchObject({ message: 'Tell me about the ending.', focus: 'ending' });
    expect(b.talk.map((t) => [t.role, t.text])).toEqual([
      ['author', 'I have a half-formed idea.'],
      ['partner', 'About everything.'],
      ['author', 'Tell me about the ending.'],
      ['partner', 'About ending.'],
    ]);
    expect(b.talk[2].focus).toBe('ending');
    expect(b.pile[0].status).toBe('kept');
    expect(b.pile).toHaveLength(2);
    // Saved to idea.yaml, so it survives a reload.
    engine.store.reload();
    expect(engine.store.project.idea.talk).toHaveLength(4);
  });

  it('undoes one turn, once, and clearing the conversation keeps the board', async () => {
    const { engine } = await newBook(new ScriptedSuite({ talk: async () => reply({ set: { seed: null, genre: null, logline: null, paragraph: null, synopsis: null, tone: 'Hushed', ending: null } }) }));
    const I = engine.ideation;
    await I.talk('It should feel hushed.');
    expect(I.board.tone).toBe('Hushed');
    I.undoTalk(1);
    expect(I.board.tone).toBe('');
    expect(I.board.talk[1].undone).toBe(true);
    expect(() => I.undoTalk(1)).toThrow(/nothing to undo/);
    expect(() => I.undoTalk(0)).toThrow(/nothing to undo/);
    await I.talk('Hushed, really.');
    I.clearTalk();
    expect(I.board.talk).toEqual([]);
    expect(I.board.tone).toBe('Hushed');
  });

  it('what was settled in conversation reaches the intent, and the interviewer does not ask it again', async () => {
    const { store, engine, agents } = await newBook(new ScriptedSuite({ interview: async () => ({ done: true, questions: [], intent: { premise: 'P', themes: [], tone: '', ending_type: '', hard_rules: [], notes: '' }, needs_decision: [] }) }));
    const I = engine.ideation;
    I.start('A glasshouse watered every night');
    I.choose('logline', 'Ines inherits a glasshouse someone still tends.');
    I.update({ tone: 'Hushed', ending: 'She keeps it and never learns who.', themes: ['inheritance'], never: ['Never explain the watering'], open: ['Who pays the water bill?'] });
    await I.finish();
    expect(store.project.intent).toMatchObject({ tone: 'Hushed', ending_type: 'She keeps it and never learns who.', themes: ['inheritance'], hard_rules: ['Never explain the watering'] });
    expect(store.project.intent.notes).toMatch(/Still open:\n- Who pays the water bill\?/);
    const state = await engine.pipeline.interview(store.project.intent.premise);
    const notes = store.project.intent.notes;
    expect((agents.calls.find((c) => c.method === 'interview')!.input as any).known).toEqual({ themes: ['inheritance'], tone: 'Hushed', ending_type: 'She keeps it and never learns who.', hard_rules: ['Never explain the watering'], notes });
    // The interviewer left them out of its draft; they survive anyway.
    expect(state.intent).toMatchObject({ premise: 'P', tone: 'Hushed', themes: ['inheritance'], hard_rules: ['Never explain the watering'], notes });
    expect(state.intent!.notes).toMatch(/Still open:\n- Who pays the water bill\?/);
  });

  it('the update route only touches the settled fields', async () => {
    const { engine } = await newBook();
    const b = engine.ideation.update({ tone: 'Dry', done: true, pile: [] } as never);
    expect(b.tone).toBe('Dry');
    expect(b.done).toBe(false);
  });
});

describe('talking it through: offline and prompt', () => {
  it('the offline partner builds the board from what the author says', async () => {
    const { engine } = await newBook(new OfflineSuite() as unknown as ScriptedSuite);
    const I = engine.ideation;
    let b = await I.talk('A glasshouse whose orchids are watered every night, though the house has been empty for a year.');
    expect(b.seed).toMatch(/^A glasshouse/);
    expect(b.open[0]).toMatch(/one sentence/i);
    b = await I.talk('It belongs to Ines Varga now, and her neighbour Teo says nobody has a key.');
    expect(b.cast.map((c) => c.name)).toEqual(['Ines Varga', 'Teo']);
    expect(b.cast[0].role).toBe('protagonist');
    b = await I.talk('It ends with her keeping the glasshouse and never finding out.');
    expect(b.ending).toMatch(/keeping the glasshouse/);
    b = await I.talk('She wants to sell it before winter.', 'cast:ines');
    expect(b.cast[0].want).toMatch(/sell it/);
    expect(b.pile.filter((i) => !i.mine).length).toBeGreaterThan(0);
    expect(b.talk.at(-1)!.text.length).toBeGreaterThan(0);
  });

  it('the offline interviewer asks only what is not settled', async () => {
    const s = new OfflineSuite();
    const q = await s.interview({ premise: 'P', answers: [], known: { tone: 'Hushed', hard_rules: ['No ghosts'] } });
    expect(q.questions).toEqual(['What is this book really about, underneath the plot?', 'How should it end, and what does the ending cost?']);
    const done = await s.interview({ premise: 'P', answers: q.questions.map((question) => ({ question, answer: question.startsWith('What') ? 'grief' : 'Bittersweet' })), known: { tone: 'Hushed', hard_rules: ['No ghosts'] } });
    expect(done.intent).toMatchObject({ themes: ['grief'], ending_type: 'Bittersweet', tone: 'Hushed', hard_rules: ['No ghosts'] });
  });

  it('shows the partner the board, binned ideas, the conversation and what the author points at', () => {
    const board = IdeaBoard.parse({
      seed: 'A glasshouse',
      pile: [
        { id: 'a-0', kind: 'what-if', text: 'Kept idea', status: 'kept' },
        { id: 'b-1', kind: 'twist', text: 'Binned idea', status: 'discarded' },
      ],
      cast: [{ id: 'teo', name: 'Teo', role: '', want: '', need: '', wound: '', lie: '', arc: '' }],
    });
    const { talk, logline_options, paragraph_options, synopsis_options, done, ...rest } = board;
    const text = museTalk.render(museTalk.input.parse({ board: rest, history: [{ role: 'author', text: 'Hello' }, { role: 'partner', text: 'Who?', undone: true }], message: 'He is lying.', focus: 'cast:teo' }));
    expect(text).toMatch(/- a-0 \[kept\] \(what-if\) Kept idea/);
    expect(text).toMatch(/## Binned[^]*- Binned idea/);
    expect(text).not.toMatch(/b-1/);
    expect(text).toMatch(/\*\*You:\*\* Who\?\n\(The author undid/);
    expect(text).toMatch(/## The author says \(about the character Teo \(id teo\)\)\nHe is lying\./);
  });
});
