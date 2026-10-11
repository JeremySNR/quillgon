import type { AgentSuite, GhostReviseOutput, GhostShapeOutput } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import type { Chapter, ChapterStage, LifeShape, MarginNote, Story, Structure, TimelineEvent } from '../schemas/index.js';
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

/** Before the book goes to anyone: what is unsourced, unanswered, unconsented or sensitive. */
export interface ShareReview {
  /** Sentences nothing the author said covers, and quotes that are not word for word, still in the text. */
  unsourced: { scene: string; title: string; text: string; reason: 'no-source' | 'quote-changed' }[];
  gaps: { scene: string; title: string; marker: string }[];
  open_notes: { scene: string; title: string; count: number }[];
  people: { id: string; name: string; relationship: string; living: boolean | null; consent: string; naming: string; scenes: number; flag: 'high' | 'note' | null; why: string }[];
  sensitive: { story: string; title: string; scenes: string[] }[];
  unapproved: { id: string; title: string; stage: ChapterStage }[];
  authors_note: string;
}

/** One proposed change in a revision round, reviewed passage by passage like a ripple. */
export interface RevisionItem {
  id: string;
  scene: string;
  find: string;
  replace: string;
  reason: string;
  plan: number[];
  status: 'proposed' | 'accepted' | 'rejected';
  /** Set when the code check found something the author should know (a new claim with no source). */
  warning: string | null;
}

/** A revision round: what the author said, the plan the ghostwriter read back, and the edits. */
export interface Revision {
  chapter: string;
  round: number;
  feedback: string;
  created: string;
  plan: GhostReviseOutput['plan'];
  items: RevisionItem[];
  /** Edits the code refused (they would change the author's exact words, or did not match the text). */
  refused: { scene: string; find: string; why: string }[];
  resolved: string[];
  notes: GhostReviseOutput['notes'];
  /** Plan steps (pushbacks) the author overruled: recorded as decisions. */
  overruled: number[];
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

  // ---------------------------------------------------------------- revision rounds

  /**
   * Start a revision round from the author's feedback (and their answers to the notes). The
   * ghostwriter reads back a numbered plan and proposes span edits; the code refuses any edit
   * that would change words the author said word for word, and flags new claims with no source.
   */
  async revise(id: string, feedback = '', progress: (stage: string, detail?: string) => void = () => {}): Promise<Revision> {
    if (this.p.book.life.pen === 'interviewer') throw new Error('you are holding the pen: revise the text yourself, and the ghostwriter will check it.');
    const ch = this.chapter(id);
    if (ch.stage === 'approved') throw new Error('this chapter is signed off; reopen it first');
    if (!ch.scenes.length) throw new Error('there is no draft to revise yet');
    const stories = this.storiesOf(id).filter((s) => !s.sensitive);
    const verbatim = stories.flatMap((s) => s.quotes.map((q) => q.text));
    const scenes = ch.scenes.map((sid) => {
      const sc = this.p.scenes.get(sid)!;
      return {
        id: sid,
        title: sc.card.title,
        prose: sc.prose?.body ?? '',
        notes: (sc.notes?.notes ?? []).filter((n) => n.status !== 'resolved').map((n) => ({ id: n.id, kind: n.kind, quote: n.quote, text: n.text, answer: n.answer, status: n.status })),
      };
    });
    this.setStage(id, 'revising');
    progress('revising', `Reading your notes on “${ch.title}”`);
    const narrator = this.p.characters.get(this.p.book.life.narrator ?? '')?.bio.name ?? 'the narrator';
    const out = await this.agents.ghostRevise({
      narrator,
      chapter: { id, title: ch.title, round: ch.round ?? 1 },
      scenes,
      feedback,
      stories,
      voice_notes: this.p.notebook.voice,
      verbatim,
      decisions: this.p.notebook.decisions,
      style_rules: styleRules(this.p),
      hard_rules: [...this.p.intent.hard_rules, ...this.p.notebook.off_limits.map((t) => `Never mention: ${t}`)],
    });
    const material = this.material(stories.map((s) => s.id));
    const items: RevisionItem[] = [];
    const refused: Revision['refused'] = [];
    for (const [k, e] of out.edits.entries()) {
      const prose = scenes.find((x) => x.id === e.scene)?.prose;
      if (prose === undefined) {
        refused.push({ scene: e.scene, find: e.find, why: 'no such scene in this chapter' });
        continue;
      }
      const at = prose.indexOf(e.find);
      if (at < 0 || prose.indexOf(e.find, at + 1) >= 0) {
        refused.push({ scene: e.scene, find: e.find, why: at < 0 ? 'the text it would change is not in the scene' : 'the text it would change occurs more than once' });
        continue;
      }
      // Words said word for word survive every revision.
      const broken = verbatim.find((q) => {
        const qa = prose.indexOf(q);
        return qa >= 0 && qa < at + e.find.length && at < qa + q.length && !e.replace.includes(q);
      });
      if (broken) {
        refused.push({ scene: e.scene, find: e.find, why: `it would change your exact words: “${broken}”` });
        continue;
      }
      const fresh = unsourced(e.replace, [...material.text, feedback, ...scenes.flatMap((x) => x.notes.map((n) => n.answer))], verbatim, 3);
      items.push({ id: `e${k + 1}`, scene: e.scene, find: e.find, replace: e.replace, reason: e.reason, plan: e.plan, status: 'proposed', warning: fresh.length ? `Nothing you said covers “${fresh[0].text.slice(0, 80)}”` : null });
    }
    const revision: Revision = { chapter: id, round: (ch.round ?? 1) + 1, feedback, created: new Date().toISOString(), plan: out.plan, items, refused, resolved: out.resolved, notes: out.notes, overruled: [] };
    this.proposals.set(`revision-${id}`, revision);
    return revision;
  }

  revision(id: string): Revision | null {
    return this.proposals.get<Revision>(`revision-${id}`);
  }

  /** Accept or reject one proposed edit; or overrule (or reinstate) a pushback step. */
  decide(id: string, patch: { item?: string; decision?: 'accepted' | 'rejected' | 'proposed'; overrule?: number; keep?: boolean }): Revision {
    const r = this.revision(id);
    if (!r) throw new Error('no revision in progress for this chapter');
    if (patch.item) {
      const it = r.items.find((x) => x.id === patch.item);
      if (!it) throw new Error(`no edit "${patch.item}"`);
      it.status = patch.decision ?? 'accepted';
    }
    if (patch.overrule !== undefined) r.overruled = patch.keep === false ? r.overruled.filter((n) => n !== patch.overrule) : uniq([...r.overruled, patch.overrule]);
    this.proposals.set(`revision-${id}`, r);
    return r;
  }

  /**
   * Apply the round as one commit: accepted edits into the prose, rules into the style sheet,
   * questions into the queue, overruled pushbacks into the notebook's decisions. Edits still
   * pending count as accepted (the author applied the round); rejected ones are dropped.
   */
  async applyRevision(id: string): Promise<{ applied: number; rules: number; questions: number }> {
    const r = this.revision(id);
    if (!r) throw new Error('no revision in progress for this chapter');
    const ch = this.chapter(id);
    let applied = 0;
    for (const sid of ch.scenes) {
      const sc = this.p.scenes.get(sid);
      if (!sc?.prose) continue;
      let prose = sc.prose.body;
      for (const it of r.items.filter((x) => x.scene === sid && x.status !== 'rejected')) {
        const at = prose.indexOf(it.find);
        if (at < 0) continue;
        prose = prose.slice(0, at) + it.replace + prose.slice(at + it.find.length);
        applied++;
      }
      if (prose !== sc.prose.body) {
        this.store.saveProse(sid, prose.replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' '), 'generated');
        this.store.markInSync(sid);
      }
      // Notes the round dealt with are resolved; new notes join the rest.
      const notes = (sc.notes?.notes ?? []).map((n) => (r.resolved.includes(n.id) || (n.status === 'answered' && r.items.some((it) => it.scene === sid && it.status !== 'rejected' && n.quote && it.find.includes(n.quote))) ? { ...n, status: 'resolved' as const } : n));
      const fresh = r.notes.filter((n) => n.scene === sid).map((n, k) => ({ id: `r${r.round}-${k + 1}`, kind: n.kind, quote: n.quote, text: n.text, options: n.options, status: 'open' as const, answer: '', round: r.round }));
      this.store.saveNotes(sid, { notes: [...notes, ...fresh] });
    }
    // Standing preferences become the book's rules, checked on every word from now on.
    const rules = r.plan.filter((p, n) => p.kind === 'rule' && !r.overruled.includes(n));
    if (rules.length) {
      const sheet = this.p.style.sheet;
      this.store.saveStyleSheet({
        ...sheet,
        never: uniq([...sheet.never, ...rules.flatMap((x) => x.never)]),
        prefer: [...sheet.prefer, ...rules.flatMap((x) => x.prefer).filter((x) => !sheet.prefer.some((y) => y.avoid === x.avoid))],
        guidance: uniq([...sheet.guidance, ...rules.flatMap((x) => x.guidance)]),
      });
    }
    const questions = r.plan.filter((p) => p.kind === 'question' && p.question);
    if (questions.length) {
      const qs = structuredClone(this.p.questions.questions);
      for (const q of questions) if (!qs.some((x) => x.text === q.question) && !touchesOffLimits(q.question, this.p.notebook.off_limits)) qs.push({ id: `q-${slugify(q.question).slice(0, 36)}-${r.round}`, text: q.question, why: q.text, technique: '', about: `chapter:${id}`, ask: '', priority: 1, status: 'queued', asked_in: null });
      this.store.saveQuestions({ questions: qs });
    }
    const overruled = r.overruled.map((n) => r.plan[n]).filter((p) => p?.kind === 'pushback');
    if (overruled.length) this.store.saveNotebook({ ...this.p.notebook, decisions: uniq([...this.p.notebook.decisions, ...overruled.map((p) => `Kept as I wrote it: ${p.text}`)]) });
    this.saveChapter(id, { stage: 'notes', round: r.round });
    this.proposals.delete(`revision-${id}`);
    await this.store.commit(`Revision ${r.round}: ${ch.title}`);
    return { applied, rules: rules.length, questions: questions.length };
  }

  discardRevision(id: string) {
    this.proposals.delete(`revision-${id}`);
    const ch = this.chapter(id);
    if (ch.stage === 'revising') this.setStage(id, 'notes');
  }

  // ---------------------------------------------------------------- the timeline

  /**
   * Correct a dated event. A new date carries into the stories filed with it and the scenes told
   * from them, and each affected scene gets a note to check its text still fits: a life story's
   * version of a ripple.
   */
  updateEvent(id: string, patch: Partial<TimelineEvent>): { affected: string[] } {
    const events = structuredClone(this.p.timeline.events);
    const e = events.find((x) => x.id === id);
    if (!e) throw new Error(`no event "${id}"`);
    const before = e.when;
    Object.assign(e, patch, { id });
    this.store.saveTimeline({ events });
    const affected: string[] = [];
    if (patch.when && patch.when !== before) {
      for (const sid of e.stories ?? []) {
        const st = this.p.stories.get(sid);
        if (st && (st.when === before || !st.when)) this.store.saveStory({ ...st, when: patch.when });
        for (const sc of this.p.scenes.values()) {
          if (!sc.card.stories?.includes(sid) || affected.includes(sc.id)) continue;
          if (sc.card.time === before) this.store.saveCard({ ...sc.card, time: patch.when }, { adoptIntoProse: true });
          if (sc.prose) {
            const notes = sc.notes?.notes ?? [];
            this.store.saveNotes(sc.id, { notes: [...notes, { id: `date-${notes.length + 1}`, kind: 'source', quote: '', text: `The date changed from ${before || 'unknown'} to ${patch.when}. Does the text still fit?`, options: ['It still fits'], status: 'open', answer: '', round: 0 }] });
          }
          affected.push(sc.id);
        }
      }
    }
    return { affected };
  }

  addEvent(e: Omit<TimelineEvent, 'id' | 'scenes'> & { id?: string }): TimelineEvent {
    const events = structuredClone(this.p.timeline.events);
    let id = slugify(e.id || e.description).slice(0, 40) || 'event';
    for (let n = 2; events.some((x) => x.id === id); n++) id = `${slugify(e.description).slice(0, 36)}-${n}`;
    const ev: TimelineEvent = { ...e, id, scenes: [] };
    events.push(ev);
    this.store.saveTimeline({ events });
    return ev;
  }

  deleteEvent(id: string) {
    this.store.saveTimeline({ events: this.p.timeline.events.filter((x) => x.id !== id) });
  }

  // ---------------------------------------------------------------- before you share

  shareReview(): ShareReview {
    const p = this.p;
    const chapters = this.chapters();
    const sceneIds = chapters.flatMap((c) => c.scenes).filter((s) => p.scenes.get(s)?.prose);
    const title = (sid: string) => p.scenes.get(sid)?.card.title || sid;
    const confirmed = (sid: string) =>
      new Set((p.scenes.get(sid)?.notes?.notes ?? []).filter((n) => n.kind === 'source' && (n.status === 'resolved' || (n.status === 'answered' && !/take it out|exact words/i.test(n.answer)) || n.status === 'dismissed')).map((n) => n.quote));
    const unsourcedList: ShareReview['unsourced'] = [];
    const gaps: ShareReview['gaps'] = [];
    const open: ShareReview['open_notes'] = [];
    for (const sid of sceneIds) {
      const sc = p.scenes.get(sid)!;
      const ok = confirmed(sid);
      const stories = sc.card.stories?.length ? sc.card.stories : [];
      if (stories.length) {
        const m = this.material(stories);
        for (const u of unsourced(sc.prose!.body, m.text, m.quotes, 20)) if (!ok.has(u.text)) unsourcedList.push({ scene: sid, title: title(sid), text: u.text, reason: u.reason });
      }
      for (const g of gapMarkers(sc.prose!.body)) gaps.push({ scene: sid, title: title(sid), marker: g });
      const n = (sc.notes?.notes ?? []).filter((x) => x.status === 'open').length;
      if (n) open.push({ scene: sid, title: title(sid), count: n });
    }
    const publicBook = p.book.life.audience === 'public';
    const appearances = new Map<string, number>();
    for (const sid of sceneIds) for (const c of new Set(p.scenes.get(sid)!.card.characters)) appearances.set(c, (appearances.get(c) ?? 0) + 1);
    const people: ShareReview['people'] = [...p.characters.values()]
      .filter((c) => c.id !== p.book.life.narrator)
      .map((c) => {
        const scenes = appearances.get(c.id) ?? 0;
        const consent = c.bio.consent ?? 'not-asked';
        const living = c.bio.living ?? null;
        let flag: 'high' | 'note' | null = null;
        let why = '';
        if (scenes && consent === 'objected') (flag = 'high'), (why = 'They have objected to being in the book.');
        else if (scenes && living !== false && !['approved', 'not-needed'].includes(consent))
          (flag = publicBook ? 'high' : 'note'), (why = publicBook ? 'Living, in a published book, and has not agreed. Consider asking, a pseudonym, or a signed release.' : 'Living and not yet asked. Family books are often shared further than planned.');
        else if (c.bio.sensitive && scenes) (flag = 'note'), (why = 'Marked sensitive.');
        return { id: c.id, name: c.bio.name, relationship: c.bio.relationship ?? '', living, consent, naming: c.bio.naming ?? 'real', scenes, flag, why };
      })
      .sort((a, b) => (b.flag === 'high' ? 2 : b.flag ? 1 : 0) - (a.flag === 'high' ? 2 : a.flag ? 1 : 0) || b.scenes - a.scenes);
    const sensitive = [...p.stories.values()]
      .filter((s) => s.sensitive)
      .map((s) => ({ story: s.id, title: s.title, scenes: sceneIds.filter((sid) => p.scenes.get(sid)!.card.stories?.includes(s.id)) }))
      .filter((s) => s.scenes.length);
    const unapproved = chapters.filter((c) => c.scenes.length && this.stageOf(c.id) !== 'approved').map((c) => ({ id: c.id, title: c.title, stage: this.stageOf(c.id) }));
    return { unsourced: unsourcedList, gaps, open_notes: open, people, sensitive, unapproved, authors_note: this.authorsNote() };
  }

  /** A short author's note from the choices made: memory, reconstructed dialogue, changed names, other versions. */
  authorsNote(): string {
    const p = this.p;
    const people = [...p.characters.values()];
    const changed = people.some((c) => c.bio.naming === 'pseudonym');
    const composite = people.some((c) => c.bio.naming === 'composite');
    const versions = [...p.stories.values()].some((s) => s.versions.length);
    const reconstructed = [...p.scenes.values()].some((sc) => (sc.notes?.notes ?? []).some((n) => /reconstruct/i.test(n.answer)));
    const lines = [p.book.life.subject === 'self' ? 'This is a true story, told as I remember it.' : 'This is a true story, told as it was told to me, in the words of the person who lived it.'];
    lines.push('Memory is not a recording. Where I was sure, I have said so plainly; where I was not, I have said that too.');
    lines.push(reconstructed ? 'Some conversations are written as they are remembered rather than word for word. Where the exact words survived, they are the words that were said.' : 'Where the book quotes someone, those are the words as they were remembered and told.');
    if (versions) lines.push('Where others remember things differently, I have said so.');
    if (changed) lines.push('Some names have been changed to protect the privacy of the people involved.');
    if (composite) lines.push('One or two people are composites of several real people.');
    if (p.book.life.audience === 'family') lines.push('It was written for my family.');
    return lines.join(' ');
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
