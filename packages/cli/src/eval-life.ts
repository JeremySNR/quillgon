import fs from 'node:fs';
import path from 'node:path';
import { Engine, initProject, lifeSummary, loadLives, runLifeEval, type LifeMetrics } from '@quillgon/core';
import { createSuite, OfflineSuite } from '@quillgon/agents';
import type { Models } from './eval.js';

/**
 * The ghostwriter's eval (docs/life-stories-and-dictation.md, Part 4): each invented life is
 * interviewed by the ghostwriter, answered by a simulated interviewee who knows hidden facts,
 * shaped into chapters and drafted, then scored on what was drawn out and what was invented.
 */

export interface LifeRunOptions {
  lives: string;
  out: string;
  models: Models;
  only?: string[];
  limit?: number;
  sessions?: number;
  turns?: number;
  progress?: (line: string) => void;
}

export interface LifeRun {
  id: string;
  started: string;
  finished: string;
  models: Models;
  sessions: number;
  turns: number;
  lives: { id: string; error: string | null; metrics: LifeMetrics | null }[];
  summary: ReturnType<typeof lifeSummary>;
}

export async function runLifeEvals(opts: LifeRunOptions): Promise<{ dir: string; run: LifeRun }> {
  let lives = loadLives(opts.lives).filter((l) => !opts.only?.length || opts.only.includes(l.id));
  if (opts.limit) lives = lives.slice(0, opts.limit);
  const id = `life-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const dir = path.resolve(opts.out, id);
  fs.mkdirSync(path.join(dir, 'books'), { recursive: true });
  const say = opts.progress ?? (() => undefined);
  const started = new Date().toISOString();
  const sessions = opts.sessions ?? 2;
  const turns = opts.turns ?? 10;
  const results: LifeRun['lives'] = [];
  for (const [n, life] of lives.entries()) {
    say(`[${n + 1}/${lives.length}] ${life.narrator}`);
    try {
      const store = await initProject(path.join(dir, 'books', life.id), {
        title: life.title,
        kind: 'life-story',
        subject_name: life.narrator,
        life: { subject: 'self', born: life.born },
        offline: opts.models === 'offline',
        codex: opts.models === 'codex',
      });
      const engine = new Engine(store, opts.models === 'offline' ? new OfflineSuite() : createSuite(store));
      const metrics = await runLifeEval(engine, life, { sessions, turns, progress: (l) => say(`  ${l}`) });
      results.push({ id: life.id, error: null, metrics });
      store.close();
    } catch (e) {
      say(`  failed: ${(e as Error).message}`);
      results.push({ id: life.id, error: (e as Error).message, metrics: null });
    }
  }
  const run: LifeRun = {
    id,
    started,
    finished: new Date().toISOString(),
    models: opts.models,
    sessions,
    turns,
    lives: results,
    summary: lifeSummary(results.flatMap((r) => (r.metrics ? [r.metrics] : []))),
  };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(run, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), lifeMarkdown(run));
  return { dir, run };
}

function lifeMarkdown(r: LifeRun): string {
  const s = r.summary;
  const fmt = (x: number | null) => (x === null ? '—' : String(x));
  return [
    `# Life-story eval ${r.id}`,
    '',
    `Models: ${r.models}. ${r.sessions} session(s) of ${r.turns} turns per life. Lives: ${s.lives} of ${r.lives.length}.`,
    '',
    '| Measure | Value | Better |',
    '| --- | --- | --- |',
    `| Hidden facts drawn out | ${fmt(s.elicited)} | higher |`,
    `| Deeper facts drawn out (beyond the gist) | ${fmt(s.depth)} | higher |`,
    `| Follow-up on surprising answers | ${fmt(s.followup_rate)} | higher |`,
    `| Questions refused by the code checks, per turn | ${fmt(s.refused_rate)} | lower |`,
    `| Leading questions asked | ${s.leading_asked} | 0 |`,
    `| Off-limits questions asked | ${s.off_limits_asked} | 0 |`,
    `| Drafted sentences with no source | ${fmt(s.invented_rate)} | lower |`,
    '',
    '## Lives',
    '',
    '| Life | Turns | Elicited | Depth | Follow-up | Leading | Off limits | Invented | Gaps left | Notes | Chapters | Words |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.lives.map((l) => {
      const m = l.metrics;
      return m
        ? `| ${l.id} | ${m.turns} | ${m.elicited} | ${m.depth} | ${fmt(m.followup_rate)} | ${m.leading_asked} | ${m.off_limits_asked} | ${m.invented_rate} | ${m.gaps_left} | ${m.notes} | ${m.chapters} | ${m.words} |`
        : `| ${l.id} | failed: ${l.error} |  |  |  |  |  |  |  |  |  |  |`;
    }),
  ].join('\n') + '\n';
}
