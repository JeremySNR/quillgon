import type {
  AgentSuite,
  CritiqueOutput,
  DivergeOutput,
  ExpandOutput,
  JudgeOutput,
  LineEditOutput,
  SampleTurnsOutput,
  CardsOutput,
  ExtractOutput,
  InterviewOutput,
  PlotPointsOutput,
  ReaderOutput,
  ReviseCardOutput,
  StructureAlternative,
  StructureOutput,
} from '@quillgon/core';
import { slugify } from '@quillgon/core';

/**
 * A deterministic, model-free stand-in for every agent. It makes the whole app usable
 * without an API key (provider: offline) and gives tests a predictable baseline.
 * Its prose is placeholder text built from the card; it is not meant to be good.
 */
const STOP = new Set('never always about above after again against around because before being below between could every first other their there these thing those through under until where which while whose would should'.split(' '));

export class OfflineSuite implements AgentSuite {
  async interview({ premise, answers }: Parameters<AgentSuite['interview']>[0]): Promise<InterviewOutput> {
    if (!answers.length) {
      return {
        done: false,
        questions: [
          'What is this book really about, underneath the plot?',
          'How should it end, and what does the ending cost?',
          'What must this book never do?',
          'In one line, how should it feel to read?',
        ],
        needs_decision: [],
      };
    }
    const a = (i: number) => answers[i]?.answer?.trim() ?? '';
    return {
      done: true,
      questions: [],
      intent: {
        premise,
        themes: splitList(a(0)).slice(0, 4),
        ending_type: a(1),
        hard_rules: splitList(a(2)),
        tone: a(3) || 'Restrained and specific.',
        notes: answers.slice(4).map((x) => `${x.question} ${x.answer}`).join('\n'),
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
    // Nouns, roughly: long words that are not verb forms or plurals.
    const nouns = [...new Set((input.seed.match(/\b[a-z]{5,}\b/gi) ?? []).map((w) => w.toLowerCase()))].filter((w) => !/(?:ing|ed|[^s]s)$/.test(w) && !STOP.has(w)).slice(0, 6);
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
}

// ------------------------------------------------------------------ helpers

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

function namesFrom(premise: string): { id: string; name: string; role: string }[] {
  const found: string[] = [];
  for (const m of premise.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,})(?:\s([A-Z][a-z]{2,}))?/g)) {
    const n = m[0];
    if (COMMON.has(m[1]) || found.includes(n)) continue;
    found.push(n);
  }
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
    for (const m of ['interview', 'plotPoints', 'structures', 'cards', 'write', 'voice', 'reviseLines', 'humanise', 'extract', 'reviseCard', 'reviseProse', 'read', 'continuity', 'judge', 'critique', 'sampleTurns', 'diverge', 'expand'] as const) {
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
