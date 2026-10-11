import type { AgentSuite, AuthorSignal, GhostTurnOutput, StoryBrief } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import { EMPTY_LADDER, LADDER, type CharacterBio, type Ladder, type Session, type SessionTurn, type Story, type TalkChange, type TimelineEvent, type TurnRef } from '../schemas/index.js';
import { enoughForScene, ladderScore, leadingQuestion, lifeGaps, nextRung, probesFor, RUNG_QUESTION, touchesOffLimits } from '../life.js';
import { slugify } from '../util.js';

/**
 * The ghostwriter's interviews. A session has an agenda the ghostwriter planned from the gaps in
 * the book; each exchange files what the author said (stories, people, dates, quotes, questions
 * for later) as changes that can be undone, and asks the next question. Every question is checked
 * in code before it is asked: no leading questions, nothing off limits.
 */

const HISTORY = 14;
const RANK: Record<string, number> = { no: 0, some: 1, yes: 2 };

export interface AnswerInput {
  text: string;
  /** What the recogniser heard, when the answer was spoken. */
  raw?: string | null;
  /** Recordings kept for this answer (audio/<session>/<file>). */
  audio?: string[];
  seconds?: number;
  signal?: AuthorSignal | null;
}

export class Interviews {
  constructor(
    private store: GraphStore,
    private agents: AgentSuite,
  ) {}

  private get p() {
    return this.store.project;
  }

  narrator(): { id: string; name: string } {
    const id = this.p.book.life.narrator ?? '';
    return { id, name: this.p.characters.get(id)?.bio.name ?? 'the narrator' };
  }

  briefs(): StoryBrief[] {
    return [...this.p.stories.values()]
      .filter((s) => s.status !== 'cut')
      .map((s) => ({ id: s.id, title: s.title, when: s.when, chapter: s.chapter, depth: Math.round(ladderScore(s.ladder) * 100) / 100, next: nextRung(s.ladder), status: s.status, sensitive: s.sensitive }));
  }

  private people() {
    return [...this.p.characters.values()].map((c) => ({ id: c.id, name: c.bio.name, relationship: c.bio.relationship ?? c.bio.role ?? '' }));
  }

  /** Names the author's answers may mention: people, places, story titles. */
  private known(): string[] {
    return [...this.p.characters.values()].flatMap((c) => [c.bio.name, ...c.bio.aliases]).concat(this.p.locations.locations.map((l) => l.name), [...this.p.stories.values()].map((s) => s.title));
  }

  /** The session in progress, if any. */
  active(): Session | null {
    return [...this.p.sessions.values()].filter((s) => !s.ended).sort((a, b) => b.started.localeCompare(a.started))[0] ?? null;
  }

  session(id: string): Session {
    const s = this.p.sessions.get(id);
    if (!s) throw new Error(`no session "${id}"`);
    return s;
  }

  // ---------------------------------------------------------------- start

  async start(opts: { minutes?: number; speaker?: string } = {}): Promise<Session> {
    const open = this.active();
    if (open) return open;
    if (this.p.book.kind === 'novel') throw new Error('interviews are for life stories');
    const life = this.p.book.life;
    const nb = this.p.notebook;
    const queued = this.p.questions.questions.filter((q) => q.status === 'queued' && !q.ask && !touchesOffLimits(q.text, nb.off_limits));
    const whens = [...this.p.timeline.events.map((e) => e.when), ...[...this.p.stories.values()].map((s) => s.when)];
    const recent = [...this.p.sessions.values()].filter((s) => s.ended).sort((a, b) => b.started.localeCompare(a.started)).slice(0, 3);
    const minutes = opts.minutes ?? life.session_minutes;
    const plan = await this.agents.ghostPlan({
      minutes,
      speaker: opts.speaker ?? '',
      narrator: this.narrator().name,
      born: life.born,
      about: this.p.intent.premise,
      push: life.push,
      chapters: this.p.structure.acts.flatMap((a) => a.chapters).map((c) => ({ id: c.id, title: c.title, stage: c.stage ?? 'gathering', stories: c.stories ?? [] })),
      stories: this.briefs(),
      people: this.people(),
      gaps: lifeGaps(life.born, whens),
      questions: queued.sort((a, b) => a.priority - b.priority).slice(0, 25).map((q) => ({ id: q.id, text: q.text, why: q.why, about: q.about, priority: q.priority })),
      promises: nb.promises,
      off_limits: nb.off_limits,
      recent: recent.map((s) => ({ title: s.title, summary: s.summary })),
    });
    const agenda = plan.agenda.filter((a) => !touchesOffLimits(`${a.topic} ${a.question}`, nb.off_limits));
    if (!agenda.length) agenda.push({ topic: 'Anything you would like to tell me', why: 'Your choice today.', question: 'What would you like to talk about today?', story: null, question_id: null });
    const opening = this.vet(plan.opening, '') ?? agenda[0].question;
    const n = this.p.sessions.size + 1;
    const id = this.uniqueId(`session-${n}`, (x) => this.p.sessions.has(x));
    const asked = new Set(agenda.map((a) => a.question_id).filter(Boolean));
    if (asked.size) this.store.saveQuestions({ questions: this.p.questions.questions.map((q) => (asked.has(q.id) ? { ...q, status: 'asked', asked_in: id } : q)) });
    const session = this.store.saveSession({
      id,
      title: plan.title || `Session ${n}`,
      started: new Date().toISOString(),
      minutes,
      speaker: opts.speaker ?? '',
      agenda: agenda.map((a) => ({ topic: a.topic, why: a.why, question: a.question, story: a.story && this.p.stories.has(a.story) ? a.story : null, question_id: a.question_id && asked.has(a.question_id) ? a.question_id : null, done: false })),
      turns: [{ role: 'ghostwriter', text: opening, technique: plan.technique || 'Opening', why: agenda[0].why, story: agenda[0].story && this.p.stories.has(agenda[0].story) ? agenda[0].story : null }],
    });
    await this.store.commit(`Interview started: ${session.title}`);
    return session;
  }

  // ---------------------------------------------------------------- one exchange

  async answer(id: string, input: AnswerInput): Promise<Session> {
    const s = structuredClone(this.session(id));
    if (s.ended) throw new Error('this session has ended');
    const signal = input.signal ?? null;
    const offRecord = signal === 'off-record';
    const text = input.text.trim();
    if (!text && !signal) throw new Error('say something first');
    const authorTurn: SessionTurn = {
      role: 'author',
      text: text || SIGNAL_TEXT[signal!],
      technique: '',
      why: '',
      audio: input.audio ?? [],
      raw: input.raw ?? null,
      seconds: input.seconds ?? 0,
      off_record: offRecord,
      story: null,
      changes: [],
      undone: false,
    };
    s.turns.push(authorTurn);
    const turnIndex = s.turns.length - 1;
    const lastAsk = [...s.turns].reverse().find((t) => t.role === 'ghostwriter');
    const story = lastAsk?.story ? (this.p.stories.get(lastAsk.story) ?? null) : null;
    authorTurn.story = story?.id ?? null;
    const nb = this.p.notebook;
    const life = this.p.book.life;
    const history = s.turns.slice(-HISTORY - 1, -1).map((t) => ({ role: t.role, text: t.off_record ? '(off the record)' : t.text }));
    const base = {
      speaker: s.speaker,
      narrator: this.narrator().name,
      born: life.born,
      push: life.push,
      agenda: s.agenda.map((a) => ({ topic: a.topic, question: a.question, done: a.done })),
      story,
      next_rung: story ? nextRung(story.ladder) : null,
      stories: this.briefs(),
      people: this.people(),
      history,
      answer: offRecord ? '(The author said something off the record. File nothing from it.)' : text,
      signal,
      probes: signal ? [] : probesFor(text),
      off_limits: nb.off_limits,
      retry: null as string | null,
    };
    const said = s.turns.filter((t) => t.role === 'author' && !t.off_record).map((t) => t.text).join(' ') + ' ' + (story ? [story.title, story.summary, ...story.details.map((d) => d.text)].join(' ') : '');
    let out = await this.agents.ghostTurn(base);
    let refused = this.refusal(out.reply, said);
    if (refused) {
      out = await this.agents.ghostTurn({ ...base, retry: refused });
      refused = this.refusal(out.reply, said);
    }
    const ref: TurnRef = { session: s.id, turn: turnIndex };
    const changes = offRecord ? [] : this.file(s, out, ref, story, signal);
    const storyId = offRecord ? (story?.id ?? null) : (changes.find((c) => c.path.startsWith('story:'))?.path.slice(6) ?? story?.id ?? null);
    const reply = refused ? this.fallback(s, storyId ? (this.p.stories.get(storyId) ?? null) : null, signal) : out.reply.trim();
    for (const n of out.agenda_done) if (s.agenda[n]) s.agenda[n].done = true;
    // Moving on: the next question is about the next agenda item's story, if it has one.
    const moving = signal === 'move-on' || signal === 'dont-remember';
    const nextItem = moving ? s.agenda.find((a) => !a.done) : null;
    s.turns.push({
      role: 'ghostwriter',
      text: reply,
      technique: refused ? 'Open question' : out.technique,
      why: refused ? 'The proposed question was replaced: it suggested a detail or touched a topic off limits.' : out.why,
      audio: [],
      raw: null,
      seconds: 0,
      off_record: false,
      story: moving ? (nextItem?.story ?? null) : storyId,
      changes,
      undone: false,
    });
    return this.store.saveSession(s);
  }

  /** Why a proposed question may not be asked, or null when it may. */
  private refusal(q: string, said: string): string | null {
    const off = touchesOffLimits(q, this.p.notebook.off_limits);
    if (off) return `It touches "${off}", which the author put off limits.`;
    return leadingQuestion(q, said, this.known());
  }

  private vet(q: string, said: string): string | null {
    return q.trim() && !this.refusal(q, said) ? q.trim() : null;
  }

  /** A safe open question when the ghostwriter's own was refused twice. */
  private fallback(s: Session, story: Story | null, signal: AuthorSignal | null): string {
    if (signal === 'hard') return 'Thank you for telling me that much. We can leave it there. Would you like to talk about something else, or stop for today?';
    const rung = story && signal !== 'move-on' && signal !== 'dont-remember' ? nextRung(story.ladder) : null;
    if (story && rung) return RUNG_QUESTION[rung](story.title);
    return s.agenda.find((a) => !a.done)?.question ?? 'What else would you like to tell me about today?';
  }

  // ---------------------------------------------------------------- filing

  /** Write what the answer gave the book; return the changes, so the exchange can be undone. */
  private file(s: Session, out: GhostTurnOutput, ref: TurnRef, current: Story | null, signal: AuthorSignal | null): TalkChange[] {
    const changes: TalkChange[] = [];
    const p = this.p;
    const record = (path: string, label: string, before: unknown, after: unknown) => changes.push({ path, label, before: structuredClone(before ?? null), after: structuredClone(after ?? null) });
    const other = !!s.speaker && s.speaker !== p.book.life.narrator;

    // People first, so stories can point at them.
    const personIds = new Map<string, string>();
    for (const person of out.people) {
      const existing = p.characters.get(person.id) ?? [...p.characters.values()].find((c) => c.bio.name.toLowerCase() === person.name.toLowerCase());
      if (existing) {
        personIds.set(person.id, existing.id);
        if (!existing.bio.relationship && person.relationship) {
          const before = structuredClone(existing.bio);
          const bio = { ...existing.bio, relationship: person.relationship };
          this.store.saveCharacter({ bio });
          record(`person:${existing.id}`, `${existing.bio.name}: ${person.relationship}`, before, bio);
        }
        continue;
      }
      const id = this.uniqueId(slugify(person.id || person.name), (x) => p.characters.has(x));
      const bio: CharacterBio = { id, name: person.name, role: 'person', goals: [], aliases: [], want: '', need: '', wound: '', lie: '', arc: '', background: '', relationship: person.relationship, naming: 'real', consent: 'not-asked' };
      this.store.saveCharacter({ bio });
      personIds.set(person.id, id);
      record(`person:${id}`, `New person: ${person.name}`, null, bio);
    }

    // The story.
    let storyId = current?.id ?? null;
    if (out.story) {
      const existing = p.stories.get(out.story.id);
      const before = existing ? structuredClone(existing) : null;
      const id = existing ? existing.id : this.uniqueId(slugify(out.story.id || out.story.title), (x) => p.stories.has(x));
      const st: Story = existing
        ? structuredClone(existing)
        : { id, title: out.story.title || out.story.id.replace(/-/g, ' '), summary: '', when: '', people: [], place: '', chapter: null, key: null, ladder: { ...EMPTY_LADDER }, quotes: [], details: [], versions: [], then: '', now: '', sensitive: false, status: 'gathering' };
      const o = out.story;
      if (o.summary && !st.summary) st.summary = o.summary;
      if (o.when && !st.when) st.when = o.when;
      if (o.precision && !st.precision) st.precision = o.precision;
      if (o.place && !st.place) st.place = o.place;
      if (o.key && !st.key) st.key = o.key;
      storyId = id;
      this.mergeIntoStory(st, out, ref, personIds, other ? s.speaker : '');
      if (signal === 'hard') st.sensitive = true;
      if (st.status === 'gathering' && enoughForScene(st)) st.status = 'enough';
      if (!before || JSON.stringify(before) !== JSON.stringify(st)) {
        this.store.saveStory(st);
        record(`story:${id}`, before ? `${st.title}: ${this.climbed(before.ladder, st.ladder) || 'more detail'}` : `New story: ${st.title}`, before, st);
      }
    } else if (current && (out.details.length || out.quotes.length || out.then || out.now || Object.keys(out.ladder).length || signal === 'hard')) {
      const before = structuredClone(current);
      const st = structuredClone(current);
      this.mergeIntoStory(st, out, ref, personIds, other ? s.speaker : '');
      if (signal === 'hard') st.sensitive = true;
      if (st.status === 'gathering' && enoughForScene(st)) st.status = 'enough';
      this.store.saveStory(st);
      record(`story:${st.id}`, `${st.title}: ${this.climbed(before.ladder, st.ladder) || (signal === 'hard' ? 'marked sensitive' : 'more detail')}`, before, st);
    }

    // Dated events.
    if (out.events.length) {
      const before = structuredClone(p.timeline.events);
      const events: TimelineEvent[] = structuredClone(p.timeline.events);
      let added = 0;
      for (const e of out.events) {
        if (events.some((x) => x.description.toLowerCase() === e.description.toLowerCase())) continue;
        const id = this.uniqueId(slugify(e.description).slice(0, 40), (x) => events.some((y) => y.id === x));
        events.push({ id, when: e.when, description: e.description, scenes: [], ...(e.precision ? { precision: e.precision } : {}), ...(e.key ? { key: e.key } : {}), source: other ? 'someone-else' : 'memory', ...(storyId ? { stories: [storyId] } : {}) });
        added++;
      }
      if (added) {
        this.store.saveTimeline({ events });
        record('timeline', `${added} date${added > 1 ? 's' : ''} on the timeline`, before, this.p.timeline.events);
      }
    }

    // Questions for later.
    if (out.questions.length) {
      const before = structuredClone(p.questions.questions);
      const qs = structuredClone(before);
      let added = 0;
      for (const q of out.questions) {
        if (qs.some((x) => x.text.toLowerCase() === q.text.toLowerCase()) || touchesOffLimits(q.text, p.notebook.off_limits)) continue;
        const ask = q.ask ? (personIds.get(q.ask) ?? (p.characters.has(q.ask) ? q.ask : '')) : '';
        qs.push({ id: this.uniqueId(`q-${slugify(q.text).slice(0, 36)}`, (x) => qs.some((y) => y.id === x)), text: q.text, why: q.why, technique: '', about: q.about || (storyId ? `story:${storyId}` : 'book'), ask, priority: q.priority, status: 'queued', asked_in: null });
        added++;
      }
      if (added) {
        this.store.saveQuestions({ questions: qs });
        record('questions', `${added} question${added > 1 ? 's' : ''} for later`, before, qs);
      }
    }

    // The notebook.
    const promises = out.promises.filter((x) => !p.notebook.promises.includes(x));
    const voice = out.voice.filter((x) => !p.notebook.voice.includes(x));
    if (promises.length || voice.length) {
      const before = structuredClone(p.notebook);
      const nb = { ...p.notebook, promises: [...p.notebook.promises, ...promises], voice: [...p.notebook.voice, ...voice] };
      this.store.saveNotebook(nb);
      record('notebook', voice.length ? `Noted how you talk: ${voice[0]}` : `Promised to come back to: ${promises[0]}`, before, nb);
    }
    return changes;
  }

  private mergeIntoStory(st: Story, out: GhostTurnOutput, from: TurnRef, personIds: Map<string, string>, by: string) {
    for (const r of LADDER) {
      const v = out.ladder[r];
      if (v && RANK[v] > RANK[st.ladder[r]]) st.ladder[r] = v;
    }
    const people = out.people.map((x) => personIds.get(x.id)).filter((x): x is string => !!x);
    st.people = [...new Set([...st.people, ...people])];
    if (by) {
      // Someone else's account: kept as their version, never merged into the narrator's memory.
      const text = [...out.details.map((d) => d.text), ...out.quotes.map((q) => `"${q.text}"${q.who ? ` (${q.who})` : ''}`)].join(' ');
      if (text) st.versions.push({ text, from, by });
      return;
    }
    for (const d of out.details) if (!st.details.some((x) => x.text === d.text)) st.details.push({ text: d.text, from, source: 'memory', certainty: d.certainty });
    for (const q of out.quotes) if (!st.quotes.some((x) => x.text === q.text)) st.quotes.push({ text: q.text, who: q.who, from });
    if (out.then) st.then = st.then ? `${st.then} ${out.then}` : out.then;
    if (out.now) st.now = st.now ? `${st.now} ${out.now}` : out.now;
  }

  private climbed(a: Ladder, b: Ladder): string {
    const up = LADDER.filter((r) => RANK[b[r]] > RANK[a[r]]);
    return up.length ? up.map((r) => RUNG_SHORT[r]).join(', ') : '';
  }

  private uniqueId(base: string, taken: (id: string) => boolean): string {
    const root = slugify(base) || 'item';
    if (!taken(root)) return root;
    for (let i = 2; ; i++) if (!taken(`${root}-${i}`)) return `${root}-${i}`;
  }

  // ---------------------------------------------------------------- undo, end

  /** Take back what one exchange filed. Only the latest exchange that filed anything can be undone. */
  undo(id: string, turn: number): Session {
    const s = structuredClone(this.session(id));
    const t = s.turns[turn];
    if (!t || t.role !== 'ghostwriter' || t.undone || !t.changes.length) throw new Error('that exchange filed nothing to undo');
    const later = s.turns.slice(turn + 1).some((x) => x.changes.length && !x.undone);
    if (later) throw new Error('undo the later exchanges first');
    for (const c of [...t.changes].reverse()) this.restore(c);
    t.undone = true;
    return this.store.saveSession(s);
  }

  private restore(c: TalkChange) {
    const [kind, ...rest] = c.path.split(':');
    const key = rest.join(':');
    if (kind === 'story') {
      if (c.before) this.store.saveStory(c.before);
      else this.store.deleteStory(key);
    } else if (kind === 'person') {
      if (c.before) this.store.saveCharacter({ bio: c.before });
      // A person created by the exchange stays (stories elsewhere may name them); only their details revert.
    } else if (kind === 'timeline') this.store.saveTimeline({ events: c.before ?? [] });
    else if (kind === 'questions') this.store.saveQuestions({ questions: c.before ?? [] });
    else if (kind === 'notebook') this.store.saveNotebook(c.before ?? {});
  }

  async end(id: string): Promise<Session> {
    const s = structuredClone(this.session(id));
    if (s.ended) return s;
    const history = s.turns.map((t) => ({ role: t.role, text: t.off_record ? '(off the record)' : t.text }));
    const spoke = s.turns.some((t) => t.role === 'author');
    if (spoke) {
      const out = await this.agents.ghostWrap({ narrator: this.narrator().name, agenda: s.agenda.map((a) => ({ topic: a.topic, done: a.done })), history, stories: this.briefs() });
      s.title = out.title || s.title;
      s.summary = out.summary;
      const nb = this.p.notebook;
      const promises = out.promises.filter((x) => !nb.promises.includes(x));
      const voice = out.voice.filter((x) => !nb.voice.includes(x));
      if (promises.length || voice.length) this.store.saveNotebook({ ...nb, promises: [...nb.promises, ...promises], voice: [...nb.voice, ...voice] });
      const qs = structuredClone(this.p.questions.questions);
      for (const q of out.questions) {
        if (qs.some((x) => x.text.toLowerCase() === q.text.toLowerCase()) || touchesOffLimits(q.text, nb.off_limits)) continue;
        qs.push({ id: this.uniqueId(`q-${slugify(q.text).slice(0, 36)}`, (x) => qs.some((y) => y.id === x)), text: q.text, why: q.why, technique: '', about: q.about, ask: this.p.characters.has(q.ask) ? q.ask : '', priority: q.priority, status: 'queued', asked_in: null });
      }
      if (qs.length !== this.p.questions.questions.length) this.store.saveQuestions({ questions: qs });
    }
    // Questions the session covered are answered; asked but not reached go back in the queue.
    const covered = new Set(s.agenda.filter((a) => a.done && a.question_id).map((a) => a.question_id!));
    this.store.saveQuestions({
      questions: this.p.questions.questions.map((q) => (q.asked_in === s.id && q.status === 'asked' ? (covered.has(q.id) ? { ...q, status: 'answered' } : { ...q, status: 'queued', asked_in: null }) : q)),
    });
    s.ended = new Date().toISOString();
    const saved = this.store.saveSession(s);
    await this.store.commit(`Interview: ${s.title}`);
    return saved;
  }
}

const SIGNAL_TEXT: Record<AuthorSignal, string> = {
  'dont-remember': 'That’s all I remember.',
  'move-on': 'Let’s move on.',
  'off-record': '(Off the record.)',
  hard: 'This is hard to talk about.',
};

const RUNG_SHORT: Record<(typeof LADDER)[number], string> = {
  happened: 'what happened',
  instance: 'one particular time',
  people: 'who was there',
  senses: 'what you saw and heard',
  words: 'what was said',
  felt_then: 'how you felt',
  means_now: 'what it means now',
};
