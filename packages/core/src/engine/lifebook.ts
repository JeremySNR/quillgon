import type { AgentSuite, GhostShapeOutput } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import type { Chapter, ChapterStage, LifeShape, MarginNote, Story, Structure } from '../schemas/index.js';
import { enoughForScene, gapMarkers, ladderScore, touchesOffLimits, unsourced } from '../life.js';
import { styleRules } from '../style-sheet.js';
import { slugify, uniq } from '../util.js';
import { Proposals } from './pipeline.js';

/**
 * A life story's chapters: proposing a shape from the stories gathered, drafting a chapter from
 * its stories only (with margin notes where it is thin and a code check that every sentence comes
 * from something the author said), answering the notes, and signing chapters off. Each chapter
 * moves through its own cycle: gathering → ready → draft → notes ⇄ revising → approved.
 */

export const STAGES: ChapterStage[] = ['gathering', 'ready', 'draft', 'notes', 'revising', 'approved'];

export interface ShapeProposal extends GhostShapeOutput {
  shape: LifeShape;
}

export class LifeBook {
  readonly proposals: Proposals;
  constructor(
    private store: GraphStore,
    private agents: AgentSuite,
  ) {
    this.proposals = new Proposals(store.dir);
  }

  private get p() {
    return this.store.project;
  }

  chapters(): Chapter[] {
    return this.p.structure.acts.flatMap((a) => a.chapters);
  }

  chapter(id: string): Chapter {
    const c = this.chapters().find((x) => x.id === id);
    if (!c) throw new Error(`no chapter "${id}"`);
    return c;
  }

  /** A chapter's stories, in order: the ones assigned to it, plus any story that names it. */
  storiesOf(id: string): Story[] {
    const c = this.chapter(id);
    const ids = uniq([...(c.stories ?? []), ...[...this.p.stories.values()].filter((s) => s.chapter === id).map((s) => s.id)]);
    return ids.map((s) => this.p.stories.get(s)).filter((s): s is Story => !!s && s.status !== 'cut');
  }

  /** The stage, worked out when the chapter has none yet: ready once its stories are scenes. */
  stageOf(id: string): ChapterStage {
    const c = this.chapter(id);
    if (c.stage && c.stage !== 'gathering' && c.stage !== 'ready') return c.stage;
    const stories = this.storiesOf(id).filter((s) => !s.sensitive);
    return stories.length && stories.every(enoughForScene) ? 'ready' : 'gathering';
  }

  private saveChapter(id: string, patch: Partial<Chapter>) {
    const st: Structure = structuredClone(this.p.structure);
    for (const a of st.acts) a.chapters = a.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c));
    this.store.saveStructure(st);
  }

  // ---------------------------------------------------------------- shape

  async proposeShape(shape?: LifeShape): Promise<ShapeProposal> {
    const life = this.p.book.life;
    const chosen = shape ?? life.shape ?? 'chronological';
    const narrator = this.p.characters.get(life.narrator ?? '')?.bio.name ?? 'the narrator';
    const stories = [...this.p.stories.values()].filter((s) => s.status !== 'cut');
    if (!stories.length) throw new Error('there are no stories yet: start with an interview session');
    const out = await this.agents.ghostShape({
      narrator,
      born: life.born,
      about: this.p.intent.premise,
      shape: chosen,
      target_words: this.p.book.target_words,
      stories: stories.map((s) => ({ id: s.id, title: s.title, summary: s.summary, when: s.when, key: s.key, depth: Math.round(ladderScore(s.ladder) * 100) / 100, sensitive: s.sensitive })),
      chapters: this.chapters().map((c) => ({ id: c.id, title: c.title, stories: c.stories ?? [] })),
    });
    const known = new Set(stories.map((s) => s.id));
    const seen = new Set<string>();
    const proposal: ShapeProposal = {
      ...out,
      shape: chosen,
      // Every story in at most one chapter, and only stories that exist.
      chapters: out.chapters.map((c) => ({ ...c, id: slugify(c.id || c.title), stories: c.stories.filter((s) => known.has(s) && !seen.has(s) && (seen.add(s), true)) })),
      left_out: out.left_out.filter((x) => known.has(x.id)),
    };
    this.proposals.set('shape', proposal);
    return proposal;
  }

  /** Adopt a proposed shape: chapters (keeping existing ones and their scenes), and each story's chapter. */
  async acceptShape(proposal = this.proposals.get<ShapeProposal>('shape')): Promise<Chapter[]> {
    if (!proposal) throw new Error('no shape has been proposed');
    const existing = new Map(this.chapters().map((c) => [c.id, c]));
    const chapters: Chapter[] = proposal.chapters.map((c) => {
      const prev = existing.get(c.id);
      return { ...(prev ?? { planned_scenes: 0, scenes: [] }), id: c.id, title: c.title, summary: c.summary, stories: c.stories, stage: prev?.stage, round: prev?.round };
    });
    // Chapters already drafted stay, even if the new shape left them out.
    for (const c of existing.values()) if (!chapters.some((x) => x.id === c.id) && c.scenes.length) chapters.push(c);
    const st: Structure = structuredClone(this.p.structure);
    if (!st.acts.length) st.acts.push({ id: 'life', title: '', chapters: [] });
    st.acts = [{ ...st.acts[0], chapters }, ...st.acts.slice(1).map((a) => ({ ...a, chapters: [] }))];
    this.store.saveStructure(st);
    const where = new Map(chapters.flatMap((c) => (c.stories ?? []).map((s) => [s, c.id] as const)));
    for (const s of this.p.stories.values()) {
      const ch = where.get(s.id) ?? null;
      if (s.chapter !== ch) this.store.saveStory({ ...s, chapter: ch });
    }
    this.store.updateBook({ life: { ...this.p.book.life, shape: proposal.shape } });
    this.proposals.delete('shape');
    await this.store.commit(`Shape the book: ${proposal.shape}, ${chapters.length} chapters`);
    return chapters;
  }

  /** Move a story into a chapter (or out of all chapters). */
  assignStory(storyId: string, chapterId: string | null) {
    const story = this.p.stories.get(storyId);
    if (!story) throw new Error(`no story "${storyId}"`);
    if (chapterId) this.chapter(chapterId);
    const st: Structure = structuredClone(this.p.structure);
    for (const a of st.acts)
      for (const c of a.chapters) {
        const has = (c.stories ?? []).includes(storyId);
        if (c.id === chapterId && !has) c.stories = [...(c.stories ?? []), storyId];
        if (c.id !== chapterId && has) c.stories = (c.stories ?? []).filter((x) => x !== storyId);
      }
    this.store.saveStructure(st);
    this.store.saveStory({ ...story, chapter: chapterId });
  }

  // ---------------------------------------------------------------- draft

  /**
   * Draft a chapter from its stories. Scenes are written as generated prose, each with its
   * margin notes: the ghostwriter's own (gaps, versions, thin passages, voice) and the code's
   * (sentences nothing the author said supports, quotes that are not word for word).
   */
  async draftChapter(id: string, progress: (stage: string, detail?: string) => void = () => {}): Promise<string[]> {
    const life = this.p.book.life;
    if (life.pen === 'interviewer') throw new Error('you are holding the pen: the ghostwriter only asks and checks. Change who holds the pen in Settings → Book.');
    const ch = this.chapter(id);
    if (ch.stage === 'approved') throw new Error('this chapter is signed off; reopen it first');
    const stories = this.storiesOf(id).filter((s) => !s.sensitive);
    if (!stories.length) throw new Error('this chapter has no stories yet (sensitive stories stay out until you say)');
    const chapters = this.chapters();
    const number = chapters.findIndex((c) => c.id === id) + 1;
    const narratorId = life.narrator ?? 'me';
    const narrator = this.p.characters.get(narratorId)?.bio.name ?? 'the narrator';
    const voiceChapter = life.voice_sample && life.voice_sample !== id ? this.prose(life.voice_sample).slice(0, 12000) : '';
    const prev = chapters[number - 2];
    const previousEnding = prev ? this.prose(prev.id).slice(-1200) : '';
    const words = Math.round(this.p.book.target_words / Math.max(chapters.length, 1));
    progress('drafting', `Writing “${ch.title}” from ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`);
    const out = await this.agents.ghostDraft({
      narrator,
      born: life.born,
      pen: life.pen,
      chapter: { id, title: ch.title, summary: ch.summary, number },
      stories,
      people: [...this.p.characters.values()].map((c) => ({ id: c.id, name: c.bio.name, relationship: c.bio.relationship ?? c.bio.role, naming: c.bio.naming ?? 'real' })),
      voice_notes: this.p.notebook.voice,
      voice_samples: this.spokenWords(6000),
      voice_chapter: voiceChapter,
      previous_ending: previousEnding,
      style_rules: styleRules(this.p),
      words,
      hard_rules: [...this.p.intent.hard_rules, ...this.p.notebook.off_limits.map((t) => `Never mention: ${t}`)],
    });
    progress('saving', 'Checking every sentence against what you said');
    const round = (ch.round ?? 0) + 1;
    const ids = out.scenes.map((_, i) => ch.scenes[i] ?? this.newSceneId(id));
    for (const old of ch.scenes.slice(out.scenes.length)) this.store.deleteScene(old);
    const placeId = (place: string) => (place ? slugify(place) : 'somewhere');
    out.scenes.forEach((sc, i) => {
      const sid = ids[i];
      const people = sc.people.filter((x) => this.p.characters.has(x));
      const storyIds = sc.stories.filter((x) => this.p.stories.has(x));
      this.store.saveCard({ id: sid, title: sc.title, pov: narratorId, location: placeId(sc.place), time: sc.when, purpose: storyIds.map((x) => this.p.stories.get(x)!.title).join('; '), characters: uniq([narratorId, ...people]), stories: storyIds, then: sc.then, now: sc.now });
      this.store.saveProse(sid, sc.prose, 'generated');
      this.store.markInSync(sid);
      const material = this.material(storyIds.length ? storyIds : stories.map((s) => s.id));
      const checks = unsourced(sc.prose, material.text, material.quotes);
      const notes: MarginNote[] = [
        ...sc.notes.map((n, k) => ({ id: `r${round}-${k + 1}`, kind: n.kind, quote: sc.prose.includes(n.quote) ? n.quote : '', text: n.text, options: n.options, status: 'open' as const, answer: '', round })),
        // Gap markers the draft left without a note still get one.
        ...gapMarkers(sc.prose)
          .filter((g) => !sc.notes.some((n) => n.quote === g))
          .map((g, k) => ({ id: `r${round}-g${k + 1}`, kind: 'gap' as const, quote: g, text: `${g.slice(4, -1).trim() || 'Something is missing here'}: can you tell me?`, options: [], status: 'open' as const, answer: '', round })),
        ...checks.map((c, k) => ({
          id: `r${round}-s${k + 1}`,
          kind: 'source' as const,
          quote: c.text,
          text: c.reason === 'quote-changed' ? 'This is not word for word what you said. Keep your exact words?' : 'Nothing you said covers this. Is it true, or should it go?',
          options: c.reason === 'quote-changed' ? ['Use my exact words', 'This is right'] : ['It’s true', 'Mark as reconstructed', 'Take it out'],
          status: 'open' as const,
          answer: '',
          round,
        })),
      ];
      this.store.saveNotes(sid, { notes });
    });
    const st: Structure = structuredClone(this.p.structure);
    for (const a of st.acts) a.chapters = a.chapters.map((c) => (c.id === id ? { ...c, scenes: ids, stage: 'notes', round } : c));
    this.store.saveStructure(st);
    // The first chapter drafted becomes the voice sample unless the author has chosen one.
    if (!life.voice_sample) this.store.updateBook({ life: { ...life, voice_sample: id } });
    await this.store.commit(`Draft ${round}: ${ch.title}`);
    return ids;
  }

  /** The chapter's prose, scenes joined. */
  prose(chapterId: string): string {
    const c = this.chapters().find((x) => x.id === chapterId);
    return (c?.scenes ?? []).map((s) => this.p.scenes.get(s)?.prose?.body ?? '').filter(Boolean).join('\n\n');
  }

  /** Everything the author said about some stories, for the source check: filed details and the turns they came from. */
  material(storyIds: string[]): { text: string[]; quotes: string[] } {
    const text: string[] = [];
    const quotes: string[] = [];
    const turn = (ref: { session: string; turn: number } | null) => (ref ? this.p.sessions.get(ref.session)?.turns[ref.turn] : undefined);
    for (const id of storyIds) {
      const s = this.p.stories.get(id);
      if (!s) continue;
      text.push(s.title, s.summary, s.place, s.when, s.then, s.now, ...s.details.map((d) => d.text), ...s.versions.map((v) => v.text));
      for (const q of s.quotes) quotes.push(q.text), text.push(q.text);
      for (const x of [...s.details, ...s.quotes]) {
        const t = turn(x.from);
        if (t && !t.off_record) text.push(t.text);
      }
      for (const p of s.people) text.push(this.p.characters.get(p)?.bio.name ?? '');
      // Answers to margin notes count as things the author said.
      for (const sc of this.p.scenes.values()) if (sc.card.stories?.includes(id)) for (const n of sc.notes?.notes ?? []) if (n.answer) text.push(n.answer);
    }
    text.push(this.p.characters.get(this.p.book.life.narrator ?? '')?.bio.name ?? '');
    return { text: text.filter(Boolean), quotes };
  }

  /** The author's own words from the interviews, newest first, for the voice. */
  spokenWords(max: number): string {
    const turns = [...this.p.sessions.values()].sort((a, b) => b.started.localeCompare(a.started)).flatMap((s) => s.turns.filter((t) => t.role === 'author' && !t.off_record && t.text.split(/\s+/).length > 8));
    let out = '';
    for (const t of turns) {
      if (out.length + t.text.length > max) break;
      out += `${t.text}\n\n`;
    }
    return out.trim();
  }

  private newSceneId(chapterId: string): string {
    for (let n = 1; ; n++) {
      const id = `${chapterId}-s${n}`;
      if (!this.p.scenes.has(id)) return id;
    }
  }

  // ---------------------------------------------------------------- notes

  /**
   * Answer a margin note. The answer becomes material (the source check and the next revision
   * use it); "later" turns the note into a question for the next session.
   */
  answerNote(sceneId: string, noteId: string, patch: { answer?: string; status?: MarginNote['status'] }): MarginNote {
    const scene = this.p.scenes.get(sceneId);
    if (!scene) throw new Error(`no scene "${sceneId}"`);
    const notes = structuredClone(scene.notes?.notes ?? []);
    const note = notes.find((n) => n.id === noteId);
    if (!note) throw new Error(`no note "${noteId}"`);
    if (patch.answer !== undefined) note.answer = patch.answer.trim();
    note.status = patch.status ?? (note.answer ? 'answered' : note.status);
    if (note.status === 'later') {
      const qs = structuredClone(this.p.questions.questions);
      const text = note.text;
      if (!qs.some((q) => q.text === text) && !touchesOffLimits(text, this.p.notebook.off_limits))
        qs.push({ id: `q-note-${slugify(`${sceneId}-${noteId}`)}`, text, why: `A margin note on “${scene.card.title}”.`, technique: '', about: `scene:${sceneId}`, ask: '', priority: 1, status: 'queued', asked_in: null });
      this.store.saveQuestions({ questions: qs });
    }
    // A note's answer is something the author said about the story.
    if (note.answer && note.status === 'answered' && note.kind !== 'source') {
      const storyId = scene.card.stories?.[0];
      const story = storyId ? this.p.stories.get(storyId) : null;
      if (story && !story.details.some((d) => d.text === note.answer)) this.store.saveStory({ ...story, details: [...story.details, { text: note.answer, from: null, source: 'memory', certainty: 'sure' }] });
    }
    this.store.saveNotes(sceneId, { notes });
    return note;
  }

  openNotes(chapterId: string): { scene: string; note: MarginNote }[] {
    return this.chapter(chapterId).scenes.flatMap((s) => (this.p.scenes.get(s)?.notes?.notes ?? []).filter((n) => n.status === 'open').map((note) => ({ scene: s, note })));
  }

  // ---------------------------------------------------------------- sign-off

  /** Sign a chapter off: its scenes approved and locked. The first approved chapter sets the voice. */
  async approve(id: string) {
    const ch = this.chapter(id);
    if (!ch.scenes.length) throw new Error('there is no draft to approve yet');
    for (const s of ch.scenes) this.store.setSceneStatus(s, { status: 'approved', lock: 'both' });
    this.saveChapter(id, { stage: 'approved' });
    await this.store.commit(`Approve chapter: ${ch.title}`);
  }

  /** Reopen an approved chapter for another round. */
  async reopen(id: string) {
    const ch = this.chapter(id);
    for (const s of ch.scenes) this.store.setSceneStatus(s, { status: 'draft', lock: 'none' });
    this.saveChapter(id, { stage: 'notes' });
    await this.store.commit(`Reopen chapter: ${ch.title}`);
  }

  setStage(id: string, stage: ChapterStage) {
    this.saveChapter(id, { stage });
  }
}
