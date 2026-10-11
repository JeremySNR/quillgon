import type {
  AgentSuite,
  CritiqueOutput,
  DivergeOutput,
  ExpandOutput,
  JudgeOutput,
  LineEditOutput,
  SampleTurnsOutput,
  TalkOutput,
  CardsOutput,
  ExtractOutput,
  InterviewOutput,
  PlotPointsOutput,
  ReaderOutput,
  ReviseCardOutput,
  StructureAlternative,
  StructureOutput,
} from '@quillgon/core';
import { cleanDictation, joinToCursor, EMPTY_LADDER, enoughForScene, LADDER, nextRung, quotedSpeech, RUNG_QUESTION, slugify, touchesOffLimits, yearOf, type GhostDraftOutput, type GhostPlanOutput, type GhostReviseOutput, type GhostShapeOutput, type GhostTurnOutput, type GhostWrapOutput, type Ladder } from '@quillgon/core';

/**
 * A deterministic, model-free stand-in for every agent. It makes the whole app usable
 * without an API key (provider: offline) and gives tests a predictable baseline.
 * Its prose is placeholder text built from the card; it is not meant to be good.
 */
const STOP = new Set('nobody somebody someone everyone anyone nothing everything never always about above after again against around because before being below between could every first other their there these thing those through under until where which while whose would should'.split(' '));

export class OfflineSuite implements AgentSuite {
  // ---------------------------------------------------------------- ghostwriter (life stories)
  // Deterministic stand-ins: an interviewer that files what it can find by pattern and climbs
  // the ladder with stock open questions. Enough to use and test every screen without a model.

  async ghostPlan(i: Parameters<AgentSuite['ghostPlan']>[0]): Promise<GhostPlanOutput> {
    const agenda: GhostPlanOutput['agenda'] = [];
    const thin = i.stories.filter((s) => s.status === 'gathering' && !s.sensitive && s.next).sort((a, b) => a.depth - b.depth)[0];
    if (thin) agenda.push({ topic: thin.title, why: 'This story is a gist so far, not yet a scene.', question: RUNG_QUESTION[thin.next as keyof typeof RUNG_QUESTION](thin.title), story: thin.id, question_id: null });
    for (const q of [...i.questions].sort((a, b) => a.priority - b.priority)) {
      if (agenda.length >= 3) break;
      if (touchesOffLimits(q.text, i.off_limits)) continue;
      agenda.push({ topic: shorten(q.text, 7), why: q.why || 'Next in the question queue.', question: q.text, story: null, question_id: q.id });
    }
    if (agenda.length < 3 && i.gaps[0]) agenda.push({ topic: `The years ${i.gaps[0]}`, why: 'Nothing is on the timeline for these years yet.', question: `What was happening in your life between ${i.gaps[0].replace(' to ', ' and ')}?`, story: null, question_id: null });
    if (!agenda.length) agenda.push({ topic: 'Anything you would like to tell me', why: 'Your choice today.', question: 'What would you like to talk about today?', story: null, question_id: null });
    return { title: agenda[0].topic, agenda, opening: agenda[0].question, technique: thin ? 'Picking up a story' : 'Opening question' };
  }

  async ghostTurn(i: Parameters<AgentSuite['ghostTurn']>[0]): Promise<GhostTurnOutput> {
    const empty: GhostTurnOutput = { reply: '', technique: '', why: '', story: null, ladder: {}, details: [], quotes: [], then: null, now: null, people: [], events: [], questions: [], promises: [], voice: [], agenda_done: [] };
    const current = i.agenda.findIndex((a) => !a.done);
    const nextItem = (skip: number) => i.agenda.find((a, n) => !a.done && n !== skip);
    const moveOn = (lead: string, done = current) => {
      const next = nextItem(done);
      return { ...empty, reply: `${lead} ${next ? next.question : 'Is there anything else you would like to tell me today?'}`.trim(), technique: 'Moving on', why: 'Following your lead.', agenda_done: done >= 0 ? [done] : [], story: null };
    };
    if (i.signal === 'off-record') return { ...moveOn('That stays off the record.', -1), agenda_done: [] };
    if (i.signal === 'hard') return { ...empty, reply: 'Thank you for telling me that much. We can leave it there. Would you like to talk about something else, or stop for today?', technique: 'Check in', why: 'You said it is hard to talk about.' };
    if (i.signal === 'dont-remember' || i.signal === 'move-on') return moveOn('That’s fine.');

    const text = i.answer.trim();
    const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => x.split(/\s+/).length >= 3);
    const known = new Set(i.people.flatMap((p) => [p.name.toLowerCase(), ...p.name.toLowerCase().split(/\s+/)]));
    // People: a first and last name together ("Jean Pickles"), not a place ("Hudson Road").
    const names = [...new Set([...text.matchAll(/\b([A-Z][a-z]{2,} [A-Z][a-z]{2,})\b/g)].map((m) => m[1]))].filter(
      (n) => !n.split(' ').some((w) => STOP_NAMES.has(w) || PLACE_WORDS.has(w)) && !known.has(n.toLowerCase()) && !known.has(n.split(' ')[0].toLowerCase()),
    );
    const year = yearOf(text);
    const story = i.story
      ? { id: i.story.id, title: i.story.title, summary: null, when: !i.story.when && year ? String(year) : null, precision: null, place: null, key: null }
      : { id: slugify(shorten(sentences[0] ?? text, 6)), title: shorten(sentences[0] ?? text, 6), summary: sentences[0] ?? text, when: year ? String(year) : null, precision: year ? ('year' as const) : null, place: null, key: null };
    const quotes = quotedSpeech(text).map((q) => ({ text: q, who: '' }));
    const ladder: Partial<Ladder> = { happened: 'yes' };
    if (!/\b(always|used to|every)\b/i.test(text) && (i.story || text.split(/\s+/).length > 12)) ladder.instance = 'yes';
    if (names.length || /\b(mum|mam|dad|mother|father|brother|sister|friend|teacher|we|they)\b/i.test(text)) ladder.people = 'some';
    if (/\b(smell|smelled|sound|noise|heard|loud|quiet|saw|looked|cold|warm|bright|dark|taste)\b/i.test(text)) ladder.senses = 'some';
    if (quotes.length) ladder.words = 'yes';
    const felt = sentences.find((x) => /\b(felt|scared|happy|proud|ashamed|angry|frightened|excited|sad|lonely)\b/i.test(x)) ?? null;
    const now = sentences.find((x) => /\b(looking back|now i|i think now|these days|i realise|i realize|i understand)\b/i.test(x)) ?? null;
    if (felt) ladder.felt_then = 'some';
    if (now) ladder.means_now = 'some';
    const merged = { ...(i.story?.ladder ?? EMPTY_LADDER) } as Ladder;
    for (const r of LADDER) if (ladder[r] && (merged[r] === 'no' || ladder[r] === 'yes')) merged[r] = ladder[r]!;
    const generalised = i.probes.some((x) => x.includes('generalised'));
    const enough = enoughForScene({ ladder: merged });
    const rung = generalised ? 'instance' : nextRung(merged);
    const base = {
      ...empty,
      story,
      ladder,
      details: sentences.filter((x) => x !== felt && x !== now).slice(0, 3).map((x) => ({ text: x, certainty: /\b(i think|maybe|probably|about|around)\b/i.test(x) ? ('think-so' as const) : ('sure' as const) })),
      quotes,
      then: felt,
      now,
      people: names.slice(0, 3).map((n) => ({ id: slugify(n), name: n, relationship: '' })),
      events: year ? [{ when: String(year), description: shorten(sentences[0] ?? text, 10), precision: 'year' as const, key: null }] : [],
    };
    if (enough || !rung) return { ...base, ...moveOn('Thank you. That is enough to write it.'), story, ladder, details: base.details, quotes, then: felt, now, people: base.people, events: base.events };
    return { ...base, reply: RUNG_QUESTION[rung](story.title), technique: RUNG_TECHNIQUE[rung], why: `Climbing the ladder: ${rung.replace('_', ' ')}.` };
  }

  async ghostShape(i: Parameters<AgentSuite['ghostShape']>[0]): Promise<GhostShapeOutput> {
    // Chronological by decade; undated stories go with the chapter before them. Existing chapters keep their stories.
    const placed = new Set(i.chapters.flatMap((c) => c.stories));
    const chapters = i.chapters.map((c) => ({ id: c.id, title: c.title, summary: '', stories: [...c.stories] }));
    const free = i.stories.filter((s) => !placed.has(s.id)).sort((a, b) => (yearOf(a.when) ?? 9999) - (yearOf(b.when) ?? 9999));
    for (const st of free) {
      const y = yearOf(st.when);
      const title = y ? `The ${Math.floor(y / 10) * 10}s` : chapters.at(-1)?.title ?? 'Early days';
      let ch = chapters.find((c) => c.title === title);
      if (!ch) chapters.push((ch = { id: slugify(title), title, summary: '', stories: [] }));
      ch.stories.push(st.id);
    }
    return { rationale: `Told in the order it was lived (${i.shape ?? 'chronological'}), a chapter for each decade with stories in it.`, chapters, left_out: [] };
  }

  async ghostDraft(i: Parameters<AgentSuite['ghostDraft']>[0]): Promise<GhostDraftOutput> {
    // One scene per story, built only from what was filed: details as sentences, quotes as dialogue,
    // the narrator-now at the end. Gaps become [TK] markers with notes.
    const scenes = i.stories.slice(0, 4).map((st) => {
      const notes: GhostDraftOutput['scenes'][number]['notes'] = [];
      const paras: string[] = [];
      const open = st.place ? `${st.when ? `In ${st.when}` : 'Then'}, at ${st.place}.` : `${st.when ? `In ${st.when}` : 'Then'}, [TK: where this happened].`;
      if (!st.place) notes.push({ kind: 'gap', quote: '[TK: where this happened]', text: 'Where did this happen? I left it blank rather than guess.', options: [] });
      paras.push([open, st.summary].filter(Boolean).join(' '));
      const details = st.details.map((d) => d.text.replace(/[.!?]*$/, '.')).filter((d) => !st.summary.includes(d.replace(/\.$/, '')));
      if (details.length) paras.push(details.join(' '));
      for (const q of st.quotes) paras.push(`“${q.text}”`);
      if (st.then) paras.push(st.then);
      if (st.now) paras.push(st.now);
      if (st.ladder.senses === 'no') notes.push({ kind: 'thin', quote: '', text: 'This tells me what happened but not what it was like. What could you see and hear?', options: [] });
      for (const v of st.versions) notes.push({ kind: 'versions', quote: '', text: `${v.by || 'Another telling'} remembers it differently: “${v.text}”. Which is right?`, options: ['Mine', v.by || 'Theirs', 'Both, as they are'] });
      return { title: st.title, stories: [st.id], when: st.when, place: st.place, people: st.people, then: st.then, now: st.now, prose: paras.join('\n\n'), notes };
    });
    return { scenes, needs_decision: [] };
  }

  async ghostRevise(i: Parameters<AgentSuite['ghostRevise']>[0]): Promise<GhostReviseOutput> {
    // Acts on the answers to the notes, and turns "never say X" in the feedback into a rule.
    const plan: GhostReviseOutput['plan'] = [];
    const edits: GhostReviseOutput['edits'] = [];
    const resolved: string[] = [];
    const step = (text: string, extra: Partial<GhostReviseOutput['plan'][number]> = {}) => plan.push({ text, kind: 'edit', never: [], prefer: [], guidance: [], question: '', ...extra }) - 1;
    for (const sc of i.scenes) {
      for (const n of sc.notes) {
        if (n.status !== 'answered' || !n.answer) continue;
        const answer = n.answer.trim().replace(/[.!?]+$/, '');
        if (n.kind === 'gap' && n.quote && sc.prose.includes(n.quote)) {
          const before = sc.prose.slice(0, sc.prose.indexOf(n.quote));
          edits.push({ scene: sc.id, find: n.quote, replace: joinToCursor(answer, before), reason: 'Your answer fills the gap.', plan: [step(`Fill the gap with what you told me: “${answer}”.`)] });
          resolved.push(n.id);
        } else if (n.kind === 'source' && /take it out/i.test(answer) && n.quote && sc.prose.includes(n.quote)) {
          edits.push({ scene: sc.id, find: n.quote, replace: '', reason: 'You said it should go.', plan: [step('Take out the sentence you said was not right.')] });
          resolved.push(n.id);
        } else if (n.kind === 'thin') {
          const paras = sc.prose.split(/\n\n/);
          const last = paras.find((x) => x.trim()) ?? '';
          if (last && sc.prose.indexOf(last) === sc.prose.lastIndexOf(last)) {
            edits.push({ scene: sc.id, find: last, replace: `${last}\n\n${answer}.`, reason: 'The moment you gave me.', plan: [step('Add the moment you described.')] });
            resolved.push(n.id);
          }
        } else resolved.push(n.id);
      }
    }
    for (const m of i.feedback.matchAll(/(?:never|wouldn'?t ever|would never|i'?d never) (?:say|use|write) ['"‘“]?([\w'’-]+)['"’”]?/gi)) {
      const word = m[1].toLowerCase();
      step(`Never use “${word}”, here or in any chapter.`, { kind: 'rule', never: [word] });
    }
    if (i.feedback.trim() && !plan.some((p) => p.kind === 'rule'))
      step(`Ask you next time for a moment that shows what you meant: “${i.feedback.trim().slice(0, 80)}”.`, { kind: 'question', question: `You said: “${i.feedback.trim().slice(0, 120)}”. Can you tell me about a moment that shows it?` });
    if (!plan.length) step('Nothing to change: the answers so far need no edits.');
    return { plan, edits, resolved, notes: [] };
  }

  async ghostWrap(i: Parameters<AgentSuite['ghostWrap']>[0]): Promise<GhostWrapOutput> {
    const covered = i.agenda.filter((a) => a.done).map((a) => a.topic);
    const said = i.history.filter((t) => t.role === 'author').length;
    return {
      title: covered[0] ?? i.agenda[0]?.topic ?? 'Session',
      summary: `We talked for ${said} answer${said === 1 ? '' : 's'}${covered.length ? `, covering ${covered.join(', ')}` : ''}. Everything you said is filed under the stories it belongs to.`,
      questions: i.stories
        .filter((s) => s.next && s.status === 'gathering' && !s.sensitive)
        .slice(0, 3)
        .map((s) => ({ text: RUNG_QUESTION[s.next as keyof typeof RUNG_QUESTION](s.title), why: `${s.title} is not yet a scene.`, about: `story:${s.id}`, ask: '', priority: 2 })),
      promises: [],
      voice: [],
    };
  }

  async scribe({ raw, before, dictionary }: Parameters<AgentSuite['scribe']>[0]) {
    return { text: cleanDictation(raw, { level: 'light', before, names: dictionary }) };
  }

  async interview({ premise, answers, known }: Parameters<AgentSuite['interview']>[0]): Promise<InterviewOutput> {
    // Only what is not already settled is asked; answers are matched back by question.
    const asked = INTERVIEW.filter((q) => !known[q.key]?.length);
    if (!answers.length && asked.length) return { done: false, questions: asked.map((q) => q.question), needs_decision: [] };
    const a = (key: (typeof INTERVIEW)[number]['key']) => answers.find((x) => x.question === INTERVIEW.find((q) => q.key === key)!.question)?.answer?.trim() ?? '';
    const known_ = new Set<string>(INTERVIEW.map((q) => q.question));
    return {
      done: true,
      questions: [],
      intent: {
        premise,
        themes: known.themes?.length ? known.themes : splitList(a('themes')).slice(0, 4),
        ending_type: known.ending_type || a('ending_type'),
        hard_rules: known.hard_rules?.length ? known.hard_rules : splitList(a('hard_rules')),
        tone: known.tone || a('tone') || 'Restrained and specific.',
        notes: answers.filter((x) => !known_.has(x.question)).map((x) => `${x.question} ${x.answer}`).join('\n'),
      },
      needs_decision: [],
    };
  }

  async plotPoints({ intent, pinned, cast }: Parameters<AgentSuite['plotPoints']>[0]): Promise<PlotPointsOutput> {
    const people = cast.length ? cast : namesFrom(intent.premise);
    const lead = people[0]?.name ?? 'the protagonist';
    const other = people[1]?.name ?? 'someone close to them';
    const beats: [string, string, number][] = [
      ['inciting', `${lead} is pulled out of ordinary life by the event at the heart of the premise.`, 1],
      ['first-choice', `${lead} commits to finding out the truth, at a cost.`, 1],
      ['midpoint', `A discovery turns the question inside out; ${lead} has been asking the wrong one.`, 2],
      ['reversal', `${other} is revealed to have hidden something that changes everything.`, 2],
      ['lowest', `${lead} loses what they were fighting to protect.`, 3],
      ['resolution', `${lead} faces the truth and chooses what to do with it.`, 3],
    ];
    return {
      plot_points: beats
        .filter(([id]) => !pinned.some((p) => p.id === `pp-${id}`))
        .map(([id, description, act]) => ({ id: `pp-${id}`, title: titleCase(id.replace(/-/g, ' ')), description, position: { act }, involves: people.slice(0, 2).map((p) => p.id), threads: [] })),
      cast: people,
      needs_decision: [],
    };
  }

  async structures({ intent, plot_points, cast, target_words, avoid }: Parameters<AgentSuite['structures']>[0]): Promise<StructureOutput> {
    const people = cast.length ? cast : namesFrom(intent.premise);
    const scenes = Math.max(6, Math.round(target_words / 1500));
    const chapters = Math.max(3, Math.round(scenes / 2));
    const perAct = [Math.ceil(chapters / 4), chapters - Math.ceil(chapters / 4) - Math.max(1, Math.floor(chapters / 4)), Math.max(1, Math.floor(chapters / 4))];
    const sorted = [...plot_points].sort((a, b) => (a.position.act ?? 2) - (b.position.act ?? 2));
    const mk = (label: string, kind: StructureAlternative['kind'], rationale: string, actTitles: string[], twist: (i: number, s: string) => string): StructureAlternative => {
      let n = 0;
      const acts = actTitles.map((title, ai) => ({
        id: `act-${ai + 1}`,
        title,
        chapters: Array.from({ length: perAct[ai] }, () => {
          n++;
          const pp = sorted[Math.min(sorted.length - 1, Math.floor(((n - 1) / chapters) * sorted.length))];
          return { id: `ch-${n}`, title: `Chapter ${n}`, summary: twist(n, pp?.description ?? intent.premise), scene_count: 2 };
        }),
      }));
      const last = `ch-${chapters}`;
      return {
        label,
        kind,
        rationale,
        acts,
        threads: [
          { id: 'central-question', title: 'The central question', kind: 'mystery', description: intent.premise.split(/(?<=[.?!])\s/)[0] ?? intent.premise, status: 'planned', setup_chapter: 'ch-1', payoff_chapter: `ch-${Math.max(2, chapters - 1)}` },
          { id: `${people[0]?.id ?? 'lead'}-arc`, title: `${people[0]?.name ?? 'The lead'}'s change`, kind: 'arc', description: `What ${people[0]?.name ?? 'the lead'} must give up to see clearly.`, status: 'planned', setup_chapter: 'ch-1', payoff_chapter: last },
        ],
        characters: people.map((p, i) => ({
          bio: { id: p.id, name: p.name, role: p.role || (i === 0 ? 'protagonist' : 'supporting'), goals: [], aliases: [], background: '', want: '', need: '', wound: '', lie: '', arc: '' },
          voice: { speech_patterns: i === 0 ? ['direct questions', 'short sentences'] : ['deflects', 'answers with a question'], sample_lines: [], avoid: [], notes: '' },
        })),
      };
    };
    const all = [
      mk('Straight line', 'obvious', 'Events in the order they happen, one point of view, the reveal at the three-quarter mark. Clear and reliable; gives up surprise in the telling.', ['Setup', 'Confrontation', 'Resolution'], (_i, s) => s),
      mk('Begin at the midpoint', 'unexpected', 'Opens on the midpoint discovery, then circles back. The reader knows something the lead does not; tension comes from waiting for them to catch up. Gives up a clean opening.', ['The Discovery', 'Before', 'After'], (i, s) => (i === 1 ? `We open on the discovery: ${s}` : s)),
      mk('Two witnesses', 'wildcard', 'Alternating chapters from the lead and the person hiding the secret. The reader sees both sides of the lie. Gives up the mystery for dramatic irony.', ['Two Sides', 'Crossing', 'Meeting'], (i, s) => `${i % 2 ? 'Lead' : 'Witness'}: ${s}`),
    ];
    return { alternatives: all.filter((a) => !avoid.some((x) => x.startsWith(a.label))).slice(0, 3), needs_decision: [] };
  }

  async cards(input: Parameters<AgentSuite['cards']>[0]): Promise<CardsOutput> {
    const { chapter, first_scene_number, characters, threads, plot_points, locations } = input;
    const pov = characters[0]?.id ?? 'lead';
    const second = characters[1]?.id;
    const loc = locations[0] ?? { id: 'home', name: 'Home' };
    const ppForChapter = plot_points.filter((pp) => chapter.summary.includes(pp.description)).map((p) => p.id);
    const touch = threads.filter((t) => t.setup_chapter === chapter.id || t.payoff_chapter === chapter.id || t.status === 'open').map((t) => t.id).slice(0, 2);
    const sentences = chapter.summary.split(/(?<=[.?!])\s+/).filter(Boolean);
    const promise = `${chapter.id}-promise`;
    const openFromBefore = (input.obligations ?? []).filter((o) => o.status !== 'paid').map((o) => o.id);
    const mkCards = (swap: boolean) =>
      Array.from({ length: chapter.scene_count }, (_, i) => {
        const id = `s${String(first_scene_number + i).padStart(3, '0')}`;
        const who = swap && second ? second : pov;
        const fact = `${chapter.id}-clue-${i + 1}`;
        return {
          id,
          title: `${chapter.title}, part ${i + 1}`,
          pov: who,
          location: loc.id,
          time: `day ${chapter.id.replace(/\D+/g, '')} ${i === 0 ? 'morning' : 'evening'}`,
          purpose: sentences[i % Math.max(1, sentences.length)] ?? chapter.summary,
          beats: [
            `${nameOf(characters, who)} arrives at ${loc.name}`,
            sentences[i % Math.max(1, sentences.length)] ?? 'Something changes',
            second ? `${nameOf(characters, second)} resists` : 'A door closes',
            `${nameOf(characters, who)} learns something new`,
          ],
          characters: second ? [who, swap ? pov : second] : [who],
          threads_touched: touch,
          plot_points: i === 0 ? ppForChapter : [],
          reveals: [fact],
          mentions: [],
          deltas: [{ character: who, learns: [fact], forgets: [] }],
          sets_up: i === 0 && chapter.scene_count > 1 ? [promise] : [],
          pays_off: i === chapter.scene_count - 1 ? [...(chapter.scene_count > 1 ? [promise] : []), ...openFromBefore] : [],
          outcome: `${nameOf(characters, who)} knows more, and wants more.`,
        };
      });
    return {
      alternatives: [
        { label: 'In order', kind: 'obvious', rationale: 'Each scene follows the last; the chapter summary told straight.', cards: mkCards(false), new_obligations: chapter.scene_count > 1 ? [{ id: promise, kind: 'promise' as const, description: `A promise made in ${chapter.title}`, payoff_hint: 'end of the chapter' }] : [], new_facts: Array.from({ length: chapter.scene_count }, (_, i) => ({ id: `${chapter.id}-clue-${i + 1}`, statement: `A clue found in ${chapter.title}, part ${i + 1}.` })), new_locations: locations.length ? [] : [{ id: 'home', name: 'Home', description: '' }] },
        { label: 'Other eyes', kind: 'unexpected', rationale: 'The same events seen by the other person in the room.', cards: mkCards(true), new_obligations: chapter.scene_count > 1 ? [{ id: promise, kind: 'promise' as const, description: `A promise made in ${chapter.title}`, payoff_hint: 'end of the chapter' }] : [], new_facts: Array.from({ length: chapter.scene_count }, (_, i) => ({ id: `${chapter.id}-clue-${i + 1}`, statement: `A clue found in ${chapter.title}, part ${i + 1}.` })), new_locations: locations.length ? [] : [{ id: 'home', name: 'Home', description: '' }] },
      ],
      needs_decision: [],
    };
  }

  async write(input: Parameters<AgentSuite['write']>[0]) {
    const c = input.card;
    const nameOfId = (id: string) => input.voices.find((v) => v.character === id)?.name.split(' ')[0] ?? id;
    const paras: string[] = [];
    paras.push(`${nameOfId(c.pov)} came to the ${c.location.replace(/-/g, ' ')} in the ${c.time.split(' ').pop() ?? 'day'}. ${c.purpose}`);
    c.beats.forEach((b, i) => {
      const speaker = c.characters[i % Math.max(1, c.characters.length)] ?? c.pov;
      const sample = input.voices.find((v) => v.character === speaker)?.voice.sample_lines[0];
      paras.push(`${capitalise(b)}.${sample ? ` '${sample}' ${nameOfId(speaker)} said.` : ''}`);
    });
    for (const m of c.mentions) {
      const f = input.facts.find((x) => x.id === m.fact);
      paras.push(`'${f?.statement ?? m.fact.replace(/-/g, ' ')}' ${nameOfId(m.character)} said.`);
    }
    for (const o of input.obligations?.plant ?? []) paras.push(`Something was set in motion: ${o.description.toLowerCase()}.`);
    for (const o of input.obligations?.pay ?? []) paras.push(`At last it came due: ${o.description.toLowerCase()}.`);
    paras.push(capitalise(c.outcome || 'The scene ended.'));
    return { prose: paras.join('\n\n'), needs_decision: [] };
  }

  async voice() {
    return { flags: [] };
  }

  async reviseLines({ prose }: Parameters<AgentSuite['reviseLines']>[0]) {
    return { prose, summary: '', needs_decision: [] };
  }

  /** Offline line edit: remove banned hits and flagged words where the fix is unambiguous. */
  async humanise({ prose, banned_hits, violations }: Parameters<AgentSuite['humanise']>[0]): Promise<LineEditOutput> {
    const edits: LineEditOutput['edits'] = [];
    const seen = new Set<string>();
    const removable = [...banned_hits.map((h) => ({ text: h.text, rule: 'banned' })), ...violations.filter((v) => ['never', 'adverb', 'banned', 'em-dash', 'exclamation'].includes(v.rule))];
    for (const h of removable) {
      if (!h.text || seen.has(h.text)) continue;
      seen.add(h.text);
      // Widen to a unique span: the hit plus the following space.
      const at = prose.indexOf(h.text);
      if (at < 0) continue;
      const find = prose.slice(Math.max(0, at - 12), at + h.text.length + 1);
      if (prose.indexOf(find) !== prose.lastIndexOf(find)) continue;
      const replacement = h.text === '—' ? ', ' : h.text === '!' ? '.' : '';
      edits.push({ find, replace: find.replace(h.text + ' ', replacement ? replacement + ' ' : '').replace(h.text, replacement), category: 'style-rule', reason: `${h.rule}: ${h.text}` });
    }
    return { edits };
  }

  async extract(input: Parameters<AgentSuite['extract']>[0]): Promise<ExtractOutput> {
    const { card, prose, characters } = input;
    const named = (id: string) => {
      const c = characters.find((x) => x.id === id);
      const names = [c?.name.split(' ')[0], ...(c?.aliases ?? [])].filter((x): x is string => !!x);
      return !names.length || names.some((n) => prose.includes(n));
    };
    const present = card.characters.filter(named);
    const mentions = card.mentions.filter((m) => named(m.character) && mentioned(prose, m.fact, input.facts));
    const facts = [
      ...mentions.map((m) => ({ subject: m.character, predicate: 'mentions' as const, object: m.fact, confidence: 0.8 })),
      ...card.deltas.filter((d) => present.includes(d.character)).flatMap((d) => d.learns.map((f) => ({ subject: d.character, predicate: 'knows' as const, object: f, confidence: 0.8 }))),
      ...present.map((c) => ({ subject: c, predicate: 'located_at' as const, object: card.location, confidence: 0.9 })),
    ];
    return {
      facts,
      states: present.map((c) => {
        const d = card.deltas.find((x) => x.character === c);
        return { character: c, learns: [...(d?.learns ?? []), ...(c === card.pov ? card.reveals.filter((r) => !(d?.learns ?? []).includes(r)) : [])], forgets: d?.forgets ?? [], location: d?.location ?? card.location, wants: d?.wants ?? null, feels: {}, alive: !d?.dies };
      }),
      timeline: [],
      new_facts: [],
      contradictions: card.characters.filter((c) => !present.includes(c)).map((c) => ({ field: 'characters', card_says: `${c} is present`, prose_says: `${c} is never named` })),
      obligations: (input.obligations ?? []).flatMap((o) => {
        const words = (o.description.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(0, 6);
        const present2 = words.filter((w) => prose.toLowerCase().includes(w)).length >= Math.min(2, words.length);
        if (!present2) return [];
        const action = card.pays_off.includes(o.id) ? ('paid' as const) : card.sets_up.includes(o.id) ? ('planted' as const) : ('referenced' as const);
        return [{ id: o.id, action }];
      }),
    };
  }

  async reviseCard(input: Parameters<AgentSuite['reviseCard']>[0]): Promise<ReviseCardOutput> {
    const quoted = [...input.reasons.join(' ').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const factIds = new Set(quoted.map((q) => input.facts.find((f) => f.statement === q)?.id ?? q).filter((id) => /^[a-z0-9-]+$/.test(id) || input.facts.some((f) => f.id === id)));
    const losesKnowledge = /no longer (know|reveal|learn)|before learning|deleted scene|not present/.test(input.reasons.join(' '));
    if (!losesKnowledge || !factIds.size) {
      return { action: 'no_change', justification: 'The change does not alter what happens in this scene.', needs_decision: [] };
    }
    const card = structuredClone(input.card);
    const before = card.mentions.length;
    card.mentions = card.mentions.filter((m) => !factIds.has(m.fact));
    if (card.mentions.length === before) return { action: 'no_change', justification: 'Nobody here speaks about the affected fact.', needs_decision: [] };
    const statements = [...factIds].map((id) => input.facts.find((f) => f.id === id)?.statement ?? id);
    card.beats = card.beats.filter((b) => !statements.some((s) => overlap(b, s) >= 2));
    const { status: _s, lock: _l, ...draft } = card;
    return { action: 'revise', justification: `Removed mentions of ${[...factIds].join(', ')}, which are no longer known here.`, card: draft, needs_decision: [] };
  }

  async reviseProse(input: Parameters<AgentSuite['reviseProse']>[0]) {
    const removed = input.old_card.mentions.filter((m) => !input.new_card.mentions.some((n) => n.character === m.character && n.fact === m.fact));
    let paras = input.old_prose.split(/\n\s*\n/);
    const dropped: number[] = [];
    for (const m of removed) {
      // Crude stemming: "eliza-holds-debts" matches "holding everybody's debts".
      const stems = m.fact.split('-').filter((w) => w.length > 2).map((w) => w.slice(0, 4));
      paras = paras.filter((p, i) => {
        const lower = p.toLowerCase();
        const hit = stems.filter((w) => lower.includes(w)).length >= Math.min(2, stems.length);
        if (hit) dropped.push(i);
        return !hit;
      });
    }
    const added = input.new_card.beats.filter((b) => !input.old_card.beats.includes(b));
    for (const b of added) paras.splice(Math.max(1, paras.length - 1), 0, capitalise(b) + '.');
    return { prose: paras.join('\n\n'), summary: `${dropped.length} paragraph(s) removed, ${added.length} added`, needs_decision: [] };
  }

  async read(input: Parameters<AgentSuite['read']>[0]): Promise<ReaderOutput> {
    const sentences = input.prose.split(/(?<=[.!?])\s+/);
    const dialogueShare = (input.prose.match(/'[^']{3,}'/g) ?? []).join('').length / Math.max(1, input.prose.length);
    const engagement = Math.max(1, Math.min(5, 2 + (dialogueShare > 0.25 ? 1 : 0) + (input.prose.length > 1500 ? 1 : 0) + (/\?/.test(input.prose) ? 1 : 0)));
    return {
      believes: sentences[0]?.slice(0, 200) ?? '',
      expects: `More about what happened after: ${sentences[sentences.length - 1]?.slice(0, 160) ?? ''}`,
      confusions: [],
      resolved_confusions: [],
      engagement,
      predictions: [],
      fairness: input.fairness_question ? 4 : null,
    };
  }

  async continuity() {
    return { contradictions: [] };
  }

  /** Offline judge: prefers the tighter version when the two are close in length. */
  async judge(input: Parameters<AgentSuite['judge']>[0]): Promise<JudgeOutput> {
    const a = input.a.length;
    const b = input.b.length;
    if (Math.abs(a - b) / Math.max(a, b, 1) > 0.25) return { winner: 'tie', reason: 'The versions differ too much in length to compare offline.' };
    if (a === b) return { winner: 'tie', reason: 'Equivalent.' };
    return { winner: b < a ? 'b' : 'a', reason: 'The tighter version, offline heuristic.' };
  }

  async critique(): Promise<CritiqueOutput> {
    return { findings: [], strengths: ['Offline critic: only the structural checks that need no model were run.'] };
  }

  async sampleTurns(input: Parameters<AgentSuite['sampleTurns']>[0]): Promise<SampleTurnsOutput> {
    const who = input.setup.match(/Present: ([^.]+)/)?.[1]?.split(',')[0]?.trim() ?? 'They';
    const turns = ['learns something new and keeps it to themselves', 'is confronted and denies everything', 'makes a choice that costs them', 'is interrupted before they can act', 'discovers they were wrong', 'walks away'];
    return { turns: turns.slice(0, input.k).map((t) => ({ text: `${who} ${t}.`, probability: 1 / Math.min(input.k, turns.length) })) };
  }

  async diverge(input: Parameters<AgentSuite['diverge']>[0]): Promise<DivergeOutput> {
    const nouns = nounsOf(input.seed);
    const pick = (i: number) => nouns[i % Math.max(1, nouns.length)] ?? 'the secret';
    const persona = input.persona.split(' ').slice(0, 3).join(' ');
    const templates: Record<string, (i: number) => string> = {
      'what-if': (i) => `What if the ${pick(i)} was never lost, only hidden by the person who reported it missing?`,
      logline: (i) => `Someone who has spent years avoiding the ${pick(i)} must now protect it from the one person who understands it.`,
      character: (i) => `A witness who lies about small things to protect one large truth about the ${pick(i)}.`,
      twist: (i) => `The ${pick(i)} was the cause, not the clue.`,
      setting: (i) => `A place organised entirely around the ${pick(i)}, where everyone knows the rules but nobody says them.`,
      theme: (i) => `What we owe to people who kept the ${pick(i)} from us for our own good.`,
      image: (i) => `A ${pick(i)} left exactly where it should not be, in plain view.`,
    };
    const candidates = Array.from({ length: input.k }, (_, i) => {
      const kind = input.kinds[i % input.kinds.length];
      return { kind, text: (templates[kind] ?? templates['what-if'])(i + input.persona.length), probability: Math.round((0.05 + ((i * 37 + input.persona.length) % 60) / 100) * 100) / 100, persona };
    });
    return { cliches: ['A chosen one with a hidden power', 'The mentor dies at the midpoint', 'A character named Elara'], candidates };
  }

  async expand(input: Parameters<AgentSuite['expand']>[0]): Promise<ExpandOutput> {
    const kept = input.kept.map((k) => k.replace(/^[a-z-]+:\s*/, ''));
    const core = input.logline || input.seed.split(/(?<=[.?!])\s/)[0];
    if (input.step === 'logline') return { options: [core, ...kept.slice(0, 2)].filter(Boolean).slice(0, 3), cast: [] };
    if (input.step === 'paragraph') return { options: [`${core} ${kept.join(' ')} Each attempt to put it right makes it worse, until the only way out costs the thing they came to save.`], cast: [] };
    if (input.step === 'synopsis') return { options: [`${input.paragraph || core}\n\nThe story opens on the day everything changes, follows three escalating attempts to fix it, and ends with a choice that cannot be undone.`], cast: [] };
    const people = namesFrom(input.seed);
    return {
      options: [],
      cast: people.map((p, i) => ({ id: p.id, name: p.name, role: i === 0 ? 'protagonist' : 'supporting', want: i === 0 ? 'to put things back as they were' : 'to keep what they know hidden', need: i === 0 ? 'to accept what cannot be undone' : 'to be forgiven', wound: 'an old failure nobody mentions', lie: i === 0 ? 'that knowing the truth will make it bearable' : 'that silence is a kind of kindness', arc: i === 0 ? 'from control to acceptance' : 'refuses to change, at a cost' })),
    };
  }

  /**
   * A thinking partner with no model: it files what the author says where it obviously
   * belongs, adds the people it can name, offers one idea of its own to sort, and asks
   * about whatever the board is still missing.
   */
  async talk({ board, history, message, focus }: Parameters<AgentSuite['talk']>[0]): Promise<TalkOutput> {
    const out: TalkOutput = {
      reply: '',
      set: { seed: null, genre: null, logline: null, paragraph: null, synopsis: null, tone: null, ending: null },
      themes: null,
      never: null,
      open: null,
      ideas: [],
      keep: [],
      bin: [],
      cast: [],
      uncast: [],
      avoid: [],
    };
    const m = message.trim();
    const first = m.split(/(?<=[.?!])\s/)[0];
    const fields = ['seed', 'genre', 'logline', 'paragraph', 'synopsis', 'tone', 'ending'] as const;
    const field = fields.find((f) => f === focus);
    let filed = 'Noted on the board.';
    if (field) (out.set[field] = m), (filed = 'Written onto the board as you put it.');
    else if (focus?.startsWith('cast:')) {
      const id = focus.slice(5);
      const key = /\bneeds?\b/i.test(m) ? 'need' : /\b(wound|hurt)\b/i.test(m) ? 'wound' : /\bbelieves?\b/i.test(m) ? 'lie' : /\b(becomes|changes|ends up)\b/i.test(m) ? 'arc' : 'want';
      out.cast.push({ id, [key]: m });
      filed = `Added to ${board.cast.find((c) => c.id === id)?.name ?? id}.`;
    } else if (focus?.startsWith('idea:')) {
      const id = focus.slice(5);
      if (/\b(no|bin|drop|not|hate)\b/i.test(m)) out.bin.push(id), (filed = 'Binned.');
      else out.keep.push(id), out.ideas.push({ kind: 'note', text: m, from: 'author', probability: 0.5 }), (filed = 'Kept, with your note.');
    } else if (!board.seed) (out.set.seed = m), (filed = 'That is the seed.');
    else if (/\b(write|draft)\b.*\b(logline|sentence)\b/i.test(m)) {
      const kept = board.pile.filter((i) => i.status === 'kept').map((i) => i.text);
      out.set.logline = [board.seed.split(/(?<=[.?!])\s/)[0], kept[0]].filter(Boolean).join(' ');
      filed = 'A first sentence, from the seed and what you kept.';
    } else if (/\b(ends?|ending)\b/i.test(m)) (out.set.ending = m), (filed = 'That is the ending, for now.');
    else if (/\b(never|must not|mustn't|don't want)\b/i.test(m)) (out.never = [...board.never, m]), (filed = 'Added to what the book must never do.');
    else if (/\b(feel|feels|tone)\b/i.test(m)) (out.set.tone = m), (filed = 'That is the tone.');
    else if (/\b(really|underneath)\b.*\babout\b|\babout\b.*\b(really|underneath)\b/i.test(m)) (out.themes = [...board.themes, first]), (filed = 'Added to the themes.');
    else out.ideas.push({ kind: /^what if/i.test(m) ? 'what-if' : 'note', text: m, from: 'author', probability: 0.5 });

    const known = new Set(board.cast.map((c) => c.id));
    const names = properNames(m);
    for (const name of names.slice(0, 3)) {
      const id = slugify(name.split(' ')[0]);
      if (known.has(id) || focus === `cast:${id}`) continue;
      known.add(id);
      out.cast.push({ id, name, role: board.cast.length || out.cast.length ? '' : 'protagonist' });
    }

    const noun = nounsOf(names.reduce((t, n) => t.replace(n, ''), `${m} ${board.seed}`))[history.length % 3] ?? 'secret';
    const offers = [
      `What if the ${noun} is the one thing nobody in the story lies about?`,
      `What if the person who cares most about the ${noun} is the one who broke it?`,
      `What if the ${noun} matters to a stranger more than to anyone in the family?`,
    ];
    out.ideas.push({ kind: 'what-if', text: offers[history.length % offers.length], from: 'partner', probability: 0.12 });

    const after = { logline: out.set.logline ?? board.logline, ending: out.set.ending ?? board.ending, tone: out.set.tone ?? board.tone, never: out.never ?? board.never };
    const missing = [
      !after.logline && 'In one sentence: who wants what, and what stands in their way?',
      !after.ending && 'How does it end, and what does the ending cost?',
      !after.tone && 'How should it feel to read?',
      !after.never.length && 'What must this book never do?',
    ].filter((q): q is string => !!q);
    if (!same(missing, board.open)) out.open = missing;
    out.reply = `${filed} ${missing[0] ?? 'What is the part of this you are least sure about?'}`;
    return out;
  }
}

// ------------------------------------------------------------------ helpers

const INTERVIEW = [
  { key: 'themes', question: 'What is this book really about, underneath the plot?' },
  { key: 'ending_type', question: 'How should it end, and what does the ending cost?' },
  { key: 'hard_rules', question: 'What must this book never do?' },
  { key: 'tone', question: 'In one line, how should it feel to read?' },
] as const;

/** Nouns, roughly: long words that are not verb forms or plurals. */
function nounsOf(text: string): string[] {
  return [...new Set((text.match(/\b[a-z]{5,}\b/gi) ?? []).map((w) => w.toLowerCase()))].filter((w) => !/(?:ing|ed|[^s]s)$/.test(w) && !STOP.has(w)).slice(0, 6);
}

function same(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function splitList(s: string): string[] {
  return s
    .split(/\n|;|(?<=\.)\s+/)
    .map((x) => x.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nameOf(chars: { id: string; name: string }[], id: string) {
  return chars.find((c) => c.id === id)?.name.split(' ')[0] ?? id;
}

const COMMON = new Set(['The', 'A', 'An', 'When', 'After', 'Before', 'In', 'On', 'At', 'She', 'He', 'They', 'Her', 'His', 'It', 'But', 'And', 'One', 'Two', 'Three', 'Years', 'Now', 'Then', 'There', 'This', 'That']);

/** Capitalised names that do not start a sentence. */
function properNames(text: string, skip: Set<string> = COMMON): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,})(?:\s([A-Z][a-z]{2,}))?/g)) {
    const n = m[0];
    if (skip.has(m[1]) || found.includes(n)) continue;
    found.push(n);
  }
  return found;
}

function namesFrom(premise: string): { id: string; name: string; role: string }[] {
  const found = properNames(premise);
  const people = found.slice(0, 4).map((n, i) => ({ id: slugify(n.split(' ')[0]), name: n, role: i === 0 ? 'protagonist' : '' }));
  if (people.length >= 2) return people;
  return [...people, ...[{ id: 'lead', name: 'Alex Morrow', role: 'protagonist' }, { id: 'sam', name: 'Sam Hale', role: 'confidant' }].slice(people.length)];
}

function overlap(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return (b.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => wa.has(w)).length;
}

function mentioned(prose: string, factId: string, facts: { id: string; statement: string }[]): boolean {
  const statement = facts.find((f) => f.id === factId)?.statement ?? factId.replace(/-/g, ' ');
  const words = (statement.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(0, 8);
  const lower = prose.toLowerCase();
  const hits = words.filter((w) => lower.includes(w)).length;
  return hits >= Math.min(2, words.length);
}

/** Test helper: an offline suite where any method can be replaced, recording every call. */
export class ScriptedSuite extends OfflineSuite {
  readonly calls: { method: string; input: unknown }[] = [];
  constructor(overrides: Partial<AgentSuite> = {}) {
    super();
    const self = this as unknown as Record<string, (i: unknown) => Promise<unknown>>;
    for (const m of ['interview', 'plotPoints', 'structures', 'cards', 'write', 'voice', 'reviseLines', 'humanise', 'extract', 'reviseCard', 'reviseProse', 'read', 'continuity', 'judge', 'critique', 'sampleTurns', 'diverge', 'expand', 'talk', 'scribe', 'ghostPlan', 'ghostTurn', 'ghostWrap', 'ghostShape', 'ghostDraft', 'ghostRevise'] as const) {
      const base = (overrides[m] as ((i: unknown) => Promise<unknown>) | undefined) ?? self[m].bind(this);
      self[m] = (i: unknown) => {
        this.calls.push({ method: m, input: i });
        return base(i);
      };
    }
  }
  count(method: keyof AgentSuite) {
    return this.calls.filter((c) => c.method === method).length;
  }
}

const STOP_NAMES = new Set(['The', 'And', 'But', 'Then', 'When', 'There', 'That', 'This', 'They', 'We', 'She', 'He', 'It', 'My', 'Our', 'Mum', 'Mam', 'Dad', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Christmas', 'Easter', 'English', 'God']);

const PLACE_WORDS = new Set(['Road', 'Street', 'Lane', 'Avenue', 'Park', 'Hall', 'Church', 'School', 'Mill', 'Square', 'Hill', 'Terrace', 'Close', 'Way', 'Bridge', 'Station', 'Hospital', 'College', 'University', 'Market', 'House', 'Farm', 'Green']);

const RUNG_TECHNIQUE: Record<string, string> = {
  happened: 'What happened',
  instance: 'One particular time',
  people: 'Who was there',
  senses: 'Go back to the place',
  words: 'What was said',
  felt_then: 'Then and now',
  means_now: 'Then and now',
};

function shorten(text: string, words: number): string {
  const w = text.replace(/[.!?]+$/, '').split(/\s+/);
  return w.slice(0, words).join(' ') + (w.length > words ? '…' : '');
}
