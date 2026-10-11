import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { bookMetrics, costSummary, eloFromWinRate, Engine, initProject, judgeBothWays, runMetrics, sceneOrder, type BookMetrics, type ReaderReport, type RunMetrics } from '@quillgon/core';
import { createSuite } from '@quillgon/agents';

/**
 * The eval harness (docs/research.md §11): a frozen premise set run through every gate,
 * scored with deterministic metrics, and compared between runs with both-ways judging.
 * Change a prompt, run again, compare: numbers instead of impressions.
 */

const Premise = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  genre: z.string().default(''),
  premise: z.string(),
  tone: z.string().default(''),
  themes: z.array(z.string()).default([]),
  ending_type: z.string().default(''),
  hard_rules: z.array(z.string()).default([]),
  target_words: z.number().int().positive().optional(),
});
const PremiseSet = z.object({ target_words: z.number().int().positive().default(6000), premises: z.array(Premise).min(1) });
export type EvalPremise = z.infer<typeof Premise>;

export type Models = 'offline' | 'codex' | 'openai';
export type SceneRole = 'opening' | 'turn' | 'ending';

export interface BookResult {
  id: string;
  error: string | null;
  metrics: BookMetrics | null;
  /** The key scenes as written, for pairwise comparison between runs. */
  scenes: { role: SceneRole; id: string; title: string; prose: string }[];
}

export interface EvalRun {
  id: string;
  started: string;
  finished: string;
  models: Models;
  scenes: 'key' | 'all';
  premises: string;
  books: BookResult[];
  summary: RunMetrics;
}

export function loadPremises(file: string): z.infer<typeof PremiseSet> {
  return PremiseSet.parse(YAML.parse(fs.readFileSync(file, 'utf8')));
}

/** Opening, the turn (the middle scene that reveals most), ending: where books fail first. */
export function keyScenes(engine: Engine): { role: SceneRole; id: string }[] {
  const p = engine.store.project;
  const order = sceneOrder(p);
  if (!order.length) return [];
  const middle = order.slice(Math.floor(order.length / 3), Math.ceil((order.length * 2) / 3));
  const turn = [...middle].sort((a, b) => p.scenes.get(b)!.card.reveals.length - p.scenes.get(a)!.card.reveals.length)[0] ?? order[Math.floor(order.length / 2)];
  const picks: { role: SceneRole; id: string }[] = [
    { role: 'opening', id: order[0] },
    { role: 'turn', id: turn },
    { role: 'ending', id: order[order.length - 1] },
  ];
  return picks.filter((x, i) => picks.findIndex((y) => y.id === x.id) === i);
}

export interface RunOptions {
  premises: string;
  out: string;
  models: Models;
  scenes?: 'key' | 'all';
  only?: string[];
  limit?: number;
  record?: string;
  replay?: string;
  progress?: (line: string) => void;
}

export async function runEval(opts: RunOptions): Promise<{ dir: string; run: EvalRun }> {
  const set = loadPremises(opts.premises);
  let premises = set.premises.filter((p) => !opts.only?.length || opts.only.includes(p.id));
  if (opts.limit) premises = premises.slice(0, opts.limit);
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.resolve(opts.out, id);
  fs.mkdirSync(path.join(dir, 'books'), { recursive: true });
  const say = opts.progress ?? (() => undefined);
  const started = new Date().toISOString();
  const books: BookResult[] = [];
  const done: { metrics: BookMetrics; project: Engine['store']['project'] }[] = [];

  for (const [n, pr] of premises.entries()) {
    say(`[${n + 1}/${premises.length}] ${pr.title}`);
    const bookDir = path.join(dir, 'books', pr.id);
    try {
      const store = await initProject(bookDir, { title: pr.title, genre: pr.genre, target_words: pr.target_words ?? set.target_words, offline: opts.models === 'offline', codex: opts.models === 'codex' });
      const engine = new Engine(store, createSuite(store, { record: opts.record && path.join(opts.record, pr.id), replay: opts.replay && path.join(opts.replay, pr.id) }));
      const pl = engine.pipeline;
      await pl.approveIntent({ premise: pr.premise, tone: pr.tone, themes: pr.themes, ending_type: pr.ending_type, hard_rules: pr.hard_rules });
      say('  plot points');
      await pl.proposePlotPoints();
      for (const pp of store.project.plotPoints.values()) if (pp.proposed) pl.acceptPlotPoint(pp.id);
      await pl.finishPlotPoints();
      say('  structure');
      await pl.proposeStructures();
      await pl.pickStructure(0);
      say('  scene cards');
      await pl.defaultCards();
      const keys = keyScenes(engine);
      if (opts.scenes === 'all') {
        for (const ch of pl.chapters()) {
          say(`  writing ${ch.title || ch.id}`);
          await pl.writeChapter(ch.id);
        }
      } else {
        for (const k of keys) {
          say(`  writing the ${k.role} (${k.id})`);
          await pl.writeScene(k.id);
        }
      }
      say('  reading');
      // With only the key scenes written, the reader judges the plan (outline mode).
      const reader: ReaderReport = await engine.reader({ mode: opts.scenes === 'all' ? 'prose' : 'outline' });
      const metrics = bookMetrics(store.project, { id: pr.id, reader, cost_usd: costSummary(store).total_usd });
      books.push({ id: pr.id, error: null, metrics, scenes: keys.map((k) => ({ ...k, title: store.scene(k.id).card.title, prose: store.scene(k.id).prose?.body ?? '' })) });
      done.push({ metrics, project: store.project });
      store.close();
    } catch (e) {
      say(`  failed: ${(e as Error).message}`);
      books.push({ id: pr.id, error: (e as Error).message, metrics: null, scenes: [] });
    }
  }

  const run: EvalRun = { id, started, finished: new Date().toISOString(), models: opts.models, scenes: opts.scenes ?? 'key', premises: path.resolve(opts.premises), books, summary: runMetrics(done) };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(run, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), runMarkdown(run));
  return { dir, run };
}

function runMarkdown(r: EvalRun): string {
  const s = r.summary;
  const fmt = (x: number | null) => (x === null ? '—' : String(x));
  const lines = [
    `# Eval run ${r.id}`,
    '',
    `Models: ${r.models}. Scenes written: ${r.scenes}. Books: ${s.books} of ${r.books.length}. Cost: $${s.cost_usd}.`,
    '',
    '| Measure | Value | Better |',
    '| --- | --- | --- |',
    `| Slop per 1k words | ${s.mean.slop_per_1k} | lower |`,
    `| Style violations per 1k words | ${s.mean.style_per_1k} | lower |`,
    `| AI writing habits per 1k words | ${s.mean.ai_habits_per_1k} | lower |`,
    `| Staged contrasts / "-ing" riders / lists of three per 1k | ${s.mean.contrasts_per_1k} / ${s.mean.riders_per_1k} / ${s.mean.triads_per_1k} | lower |`,
    `| Continuity errors per book | ${s.mean.continuity_errors} | lower |`,
    `| Structural tells per book | ${s.mean.shape_findings} | lower |`,
    `| Twists guessed early | ${fmt(s.mean.twist_guess_rate)} | lower |`,
    `| Reader engagement (1-5) | ${fmt(s.mean.engagement)} | higher |`,
    `| Books sharing a character name | ${s.shared_name_rate} | lower |`,
    `| Prose trigram overlap between books | ${s.trigram_overlap} | lower |`,
    `| Plan diversity | ${s.plan_diversity} | higher |`,
    '',
    '## Books',
    '',
    '| Book | Words | Slop/1k | Style/1k | Continuity | Tells | Twists guessed | Engagement | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.books.map((b) =>
      b.metrics
        ? `| ${b.id} | ${b.metrics.words} | ${b.metrics.slop_per_1k} | ${b.metrics.style_per_1k} | ${b.metrics.continuity_errors} | ${b.metrics.shape_findings} | ${fmt(b.metrics.twist_guess_rate)} | ${fmt(b.metrics.engagement)} | $${b.metrics.cost_usd} |`
        : `| ${b.id} | failed: ${b.error} |  |  |  |  |  |  |  |`,
    ),
  ];
  return lines.join('\n') + '\n';
}

export function loadRun(dir: string): EvalRun {
  return JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')) as EvalRun;
}

export interface Comparison {
  a: string;
  b: string;
  pairs: number;
  /** B's wins, A's wins and ties, judged both ways (a split verdict is a tie). */
  b_wins: number;
  a_wins: number;
  ties: number;
  /** Share of pairs B won (ties count half), and the Elo difference that implies (+ = B stronger). */
  b_win_rate: number;
  elo: number;
  by_role: Record<string, { b_wins: number; a_wins: number; ties: number }>;
  verdicts: { premise: string; role: string; winner: 'a' | 'b' | 'tie'; reasons: string[] }[];
}

const CRITERIA = [
  'Specific, concrete detail rather than generic description',
  'Characters sound distinct from each other',
  'No stock phrasing or clichés',
  'Surprising but earned choices',
  'Clear, controlled prose with momentum',
];

/** Judge every key scene of run B against the same premise and role in run A, both ways. */
export async function compareRuns(aDir: string, bDir: string, opts: { models: Models; progress?: (line: string) => void }): Promise<Comparison> {
  const a = loadRun(aDir);
  const b = loadRun(bDir);
  const judgeBook = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ql-judge-')), 'judge');
  const store = await initProject(judgeBook, { title: 'Judge', offline: opts.models === 'offline', codex: opts.models === 'codex' });
  const agents = createSuite(store);
  const out: Comparison = { a: a.id, b: b.id, pairs: 0, b_wins: 0, a_wins: 0, ties: 0, b_win_rate: 0, elo: 0, by_role: {}, verdicts: [] };
  try {
    for (const bb of b.books) {
      const ab = a.books.find((x) => x.id === bb.id);
      if (!ab) continue;
      for (const sb of bb.scenes) {
        const sa = ab.scenes.find((x) => x.role === sb.role);
        if (!sa?.prose || !sb.prose) continue;
        opts.progress?.(`${bb.id}: ${sb.role}`);
        const r = await judgeBothWays(agents, { task: `The ${sb.role} scene of a novel. Premise and intent are the same for both texts.`, criteria: CRITERIA, a: sa.prose, b: sb.prose, reference: '' });
        out.pairs++;
        const role = (out.by_role[sb.role] ??= { b_wins: 0, a_wins: 0, ties: 0 });
        if (r.winner === 'b') (out.b_wins++, role.b_wins++);
        else if (r.winner === 'a') (out.a_wins++, role.a_wins++);
        else (out.ties++, role.ties++);
        out.verdicts.push({ premise: bb.id, role: sb.role, winner: r.winner, reasons: r.reasons });
      }
    }
  } finally {
    store.close();
    fs.rmSync(path.dirname(judgeBook), { recursive: true, force: true });
  }
  out.b_win_rate = out.pairs ? Math.round(((out.b_wins + out.ties / 2) / out.pairs) * 100) / 100 : 0;
  out.elo = out.pairs ? eloFromWinRate(out.b_win_rate) : 0;
  fs.writeFileSync(path.join(bDir, `compare-${a.id}.json`), JSON.stringify(out, null, 2));
  return out;
}
