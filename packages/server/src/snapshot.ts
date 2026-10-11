import fs from 'node:fs';
import {
  costSummary,
  latestReaderReport,
  mechanicalContinuity,
  obligationIssues,
  readStyleStatus,
  Ripple,
  sceneOrder,
  scenePlaces,
  sceneSync,
  wordCount,
  type ContinuityIssue,
  type Engine,
  type GraphStore,
} from '@quillgon/core';
import { suiteMode } from '@quillgon/agents';
import { voiceStatus } from './dictation.js';

export function excerpt(text: string, n = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '…';
}

/** Everything the UI needs to render the shell and the overview screens, in one payload. */
export async function projectSnapshot(engine: Engine) {
  const store = engine.store;
  const p = store.project;
  const order = sceneOrder(p);
  const places = scenePlaces(p);
  const mech = mechanicalContinuity(p);
  const latestContinuity = readJson<{ ran_at: string; model: ContinuityIssue[] }>(store, 'continuity-latest.json');
  const issuesByScene = new Map<string, ContinuityIssue[]>();
  for (const i of [...mech, ...(latestContinuity?.model ?? [])]) issuesByScene.set(i.scene, [...(issuesByScene.get(i.scene) ?? []), i]);
  const reader = latestReaderReport(store);
  const voice = readJson<{ ran_at: string; warnings: number; repeated_phrases: unknown[]; banned: { scene: string }[] }>(store, 'voice-latest.json');
  const ripple = Ripple.current(store, engine.agents);
  const styleStatus = readStyleStatus(store);
  const critique = readJson<{ ran_at: string; findings: unknown[]; mechanical: unknown[] }>(store, 'critique-latest.json');
  const branches = await store.repo.branches().catch(() => ({ current: 'main', all: ['main'] }));

  const scenes = order.map((id) => {
    const s = p.scenes.get(id)!;
    const place = places.get(id)!;
    return {
      id,
      card: s.card,
      act: place.act,
      chapter: place.chapter,
      index: place.index,
      words: s.prose ? s.prose.meta.word_count || wordCount(s.prose.body) : 0,
      excerpt: s.prose ? excerpt(s.prose.body) : '',
      sync: sceneSync(s).state,
      contradictions: s.facts?.contradictions ?? [],
      issues: issuesByScene.get(id) ?? [],
      engagement: reader?.engagement.find((e) => e.scene === id)?.engagement ?? null,
      style: styleStatus[id] ?? null,
      notes: (s.notes?.notes ?? []).filter((n) => n.status === 'open').length,
    };
  });
  const unplaced = [...p.scenes.keys()].filter((id) => !order.includes(id));

  return {
    dir: store.dir,
    mode: suiteMode(store),
    dictation: voiceStatus(p),
    book: p.book,
    intent: p.intent,
    structure: p.structure,
    scenes,
    unplaced,
    plotPoints: [...p.plotPoints.values()],
    threads: [...p.threads.values()],
    obligations: [...p.obligations.values()],
    obligationIssues: obligationIssues(p),
    idea: p.idea,
    life:
      p.book.kind === 'novel'
        ? null
        : {
            stories: [...p.stories.values()],
            sessions: [...p.sessions.values()]
              .map((x) => ({ id: x.id, title: x.title, started: x.started, ended: x.ended, minutes: x.minutes, speaker: x.speaker, turns: x.turns.length, summary: x.summary }))
              .sort((a, b) => b.started.localeCompare(a.started)),
            questions: p.questions.questions,
            notebook: p.notebook,
          },
    characters: [...p.characters.values()].map((c) => ({ id: c.id, bio: c.bio, voice: c.voice, state: c.state })),
    timeline: p.timeline,
    locations: p.locations.locations,
    facts: p.factGlossary.facts,
    style: { samples: p.style.samples, banned: p.style.bannedRaw, sheet: p.style.sheet },
    critique: critique ? { ran_at: critique.ran_at, findings: critique.findings.length + critique.mechanical.length } : null,
    issues: store.issues,
    continuity: { mechanical: mech, model: latestContinuity?.model ?? [], ran_at: latestContinuity?.ran_at ?? null },
    voice: voice ? { ran_at: voice.ran_at, warnings: voice.warnings } : null,
    reader: reader
      ? { id: reader.id, ran_at: reader.ran_at, mean: reader.mean_engagement, predictions: reader.predictions.length, confusions: reader.confusions.filter((c) => !c.resolved_in).length, boredom: reader.boredom }
      : null,
    ripple: ripple?.summary() ?? null,
    proposals: engine.pipeline.proposals.list(),
    branches,
    costs: costSummary(store),
    estimate: engine.estimate(),
    totals: {
      words: scenes.reduce((n, s) => n + s.words, 0),
      scenes: scenes.length,
      byStatus: {
        draft: scenes.filter((s) => s.card.status === 'draft').length,
        approved: scenes.filter((s) => s.card.status === 'approved').length,
        locked: scenes.filter((s) => s.card.status === 'locked').length,
      },
      bySync: scenes.reduce<Record<string, number>>((m, s) => ((m[s.sync] = (m[s.sync] ?? 0) + 1), m), {}),
    },
  };
}

export function sceneDetail(store: GraphStore, id: string) {
  const p = store.project;
  const s = store.scene(id);
  const order = sceneOrder(p);
  const idx = order.indexOf(id);
  return {
    id,
    card: s.card,
    prose: s.prose,
    facts: s.facts,
    sync: sceneSync(s),
    prev: idx > 0 ? order[idx - 1] : null,
    next: idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null,
    states: s.card.characters.map((c) => ({
      character: c,
      before: store.stateBefore(c, id)?.snapshot ?? null,
      after: p.characters.get(c)?.state[id] ?? null,
    })),
  };
}

function readJson<T>(store: GraphStore, name: string): T | null {
  const t = store.readReport(name);
  try {
    return t ? (JSON.parse(t) as T) : null;
  } catch {
    return null;
  }
}

export function fileExists(p: string) {
  return fs.existsSync(p);
}
