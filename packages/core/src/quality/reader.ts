import type { AgentSuite, ReaderLogEntry } from '../agents/contracts.js';
import type { GraphStore } from '../store.js';
import { sceneOrder, scenePlaces } from '../project.js';
import { cosine, LocalEmbedder } from '../embed.js';
import { timestamp } from '../util.js';
import { synopsis } from '../engine/critics.js';

export interface PredictionHit {
  prediction: string;
  guessed_in: string;
  fact: string;
  statement: string;
  revealed_in: string;
  /** Scenes between the guess and the reveal. More = the twist was more guessable. */
  early_by: number;
  score: number;
}

export interface TwistCheck {
  scene: string;
  what: string;
  /** Guessed before the reveal? */
  guessed: PredictionHit | null;
  /** 1-5: did it feel earned in hindsight? */
  fairness: number | null;
  verdict: 'good' | 'guessable' | 'unearned' | 'guessable-and-unearned' | 'unknown';
}

export interface ReaderReport {
  id: string;
  ran_at: string;
  scope: string;
  mode: 'prose' | 'outline';
  twists: TwistCheck[];
  scenes: string[];
  log: ReaderLogEntry[];
  engagement: { scene: string; title: string; engagement: number }[];
  mean_engagement: number;
  confusions: { id: string; scene: string; text: string; resolved_in: string | null }[];
  predictions: PredictionHit[];
  boredom: { from: string; to: string; scenes: string[] }[];
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'it', 'is', 'was', 'he', 'she', 'they', 'his', 'her', 'their', 'that', 'this', 'will', 'be', 'been', 'has', 'had', 'with', 'for', 'by', 'not', 'i', 'think']);
/** Fold near-synonyms readers use for the same twist ("faked", "forged", "wrote in"). */
const SYNONYMS: Record<string, string> = {
  faked: 'forge', fake: 'forge', forged: 'forge', forgery: 'forge', forge: 'forge', wrote: 'forge', written: 'forge', falsified: 'forge', doctored: 'forge',
  killed: 'kill', murdered: 'kill', murder: 'kill', drowned: 'kill', kill: 'kill',
  hid: 'hide', hidden: 'hide', hiding: 'hide', concealed: 'hide', covering: 'hide', cover: 'hide', covered: 'hide', hide: 'hide',
  knew: 'know', known: 'know', knows: 'know', aware: 'know',
  boat: 'boat', punt: 'boat', vessel: 'boat',
  entry: 'ledger', log: 'ledger', ledger: 'ledger', book: 'ledger',
};
const fold = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => SYNONYMS[w] ?? w).join(' ');
const keywords = (s: string) => new Set(fold(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

/** How strongly a free-text prediction matches a fact statement. */
export function predictionMatch(prediction: string, statement: string, names: string[] = []): number {
  const e = new LocalEmbedder(512);
  const sim = cosine(e.embedOne(fold(prediction)), e.embedOne(fold(statement)));
  const pk = keywords(prediction);
  const sk = keywords(statement);
  const overlap = [...sk].filter((w) => pk.has(w)).length / Math.max(1, Math.min(sk.size, 6));
  // A prediction about the twist has to name who: require a shared character name when the fact names one.
  // The fact's subject (the first person it names) must be the person the prediction is about.
  const lower = statement.toLowerCase();
  const subject = names
    .map((n) => ({ n, at: lower.search(new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.n;
  const nameOk = !subject || prediction.toLowerCase().includes(subject.toLowerCase());
  return nameOk ? Math.max(sim, overlap) : 0;
}

/**
 * The simulated first reader: reads one scene at a time with only its own running log.
 * No cards, no threads, nothing ahead.
 */
export async function runReader(
  store: GraphStore,
  agents: AgentSuite,
  opts: { act?: string; mode?: 'prose' | 'outline'; progress?: (stage: string, detail?: string) => void; threshold?: number } = {},
): Promise<ReaderReport> {
  const p = store.project;
  const mode = opts.mode ?? 'prose';
  const places = scenePlaces(p);
  const order = sceneOrder(p).filter((s) => (mode === 'outline' || p.scenes.get(s)?.prose) && (!opts.act || places.get(s)?.act === opts.act));
  const log: ReaderLogEntry[] = [];
  const revealsIn = (sid: string) => {
    const c = p.scenes.get(sid)!.card;
    const facts = c.reveals.map((f) => p.factGlossary.facts.find((x) => x.id === f)?.statement ?? f.replace(/-/g, ' '));
    const paid = c.pays_off.map((o) => p.obligations.get(o)?.description).filter((x): x is string => !!x).map((d) => `pays off: ${d}`);
    return [...facts, ...paid];
  };
  for (let i = 0; i < order.length; i++) {
    const sid = order[i];
    opts.progress?.('read', `Reading ${mode === 'outline' ? 'the outline of ' : ''}scene ${i + 1} of ${order.length}`);
    const text = mode === 'outline' ? synopsis(p, sid) : p.scenes.get(sid)!.prose!.body;
    const reveals = i > 0 ? revealsIn(sid) : [];
    const out = await agents.read({
      scene: sid,
      scene_number: i + 1,
      prose: text,
      log,
      mode,
      fairness_question: reveals.length ? `This scene revealed: ${reveals.join('; ')}. Looking back at everything you read before it, how earned did that feel? 1 = out of nowhere, 5 = surprising but inevitable.` : null,
    });
    log.push({ ...out, scene: sid });
  }

  const engagement = log.map((e) => ({ scene: e.scene, title: p.scenes.get(e.scene)!.card.title, engagement: e.engagement }));
  const mean = engagement.length ? engagement.reduce((n, e) => n + e.engagement, 0) / engagement.length : 0;

  const confusions = log.flatMap((e) =>
    e.confusions.map((c) => ({
      id: c.id,
      scene: e.scene,
      text: c.text,
      resolved_in: log.slice(log.indexOf(e) + 1).find((later) => later.resolved_confusions.includes(c.id))?.scene ?? null,
    })),
  );

  // Twists: facts revealed by a scene. A prediction counts if made before the reveal and matches it.
  const threshold = opts.threshold ?? 0.34;
  const names = [...p.characters.values()].flatMap((c) => [c.bio.name.split(' ')[0], ...c.bio.aliases]);
  const reveals = [
    ...order.flatMap((sid) => p.scenes.get(sid)!.card.reveals.map((f) => ({ fact: f, scene: sid, statement: p.factGlossary.facts.find((x) => x.id === f)?.statement ?? f.replace(/-/g, ' ') }))),
  ];
  const predictions: PredictionHit[] = [];
  for (const r of reveals) {
    const revealIdx = order.indexOf(r.scene);
    let best: PredictionHit | null = null;
    for (let i = 0; i < revealIdx; i++) {
      for (const pred of log[i].predictions) {
        const score = predictionMatch(pred, r.statement, names);
        if (score >= threshold && (!best || i < order.indexOf(best.guessed_in))) {
          best = { prediction: pred, guessed_in: log[i].scene, fact: r.fact, statement: r.statement, revealed_in: r.scene, early_by: revealIdx - i, score: Math.round(score * 100) / 100 };
        }
      }
    }
    if (best) predictions.push(best);
  }

  const boredom: ReaderReport['boredom'] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) boredom.push({ from: run[0], to: run[run.length - 1], scenes: run });
    run = [];
  };
  for (const e of log) (e.engagement <= 2 ? run.push(e.scene) : flush());
  flush();

  // Twists, two-sided: not guessed early, and fair in hindsight.
  const twists: TwistCheck[] = order
    .filter((sid, i) => i > 0 && revealsIn(sid).length)
    .map((sid) => {
      const guessed = predictions.find((x) => x.revealed_in === sid) ?? null;
      const fairness = log.find((e) => e.scene === sid)?.fairness ?? null;
      const unearned = fairness !== null && fairness <= 2;
      const verdict: TwistCheck['verdict'] = guessed && unearned ? 'guessable-and-unearned' : guessed ? 'guessable' : unearned ? 'unearned' : fairness === null ? 'unknown' : 'good';
      return { scene: sid, what: revealsIn(sid).join('; '), guessed, fairness, verdict };
    });

  const id = timestamp();
  const report: ReaderReport = {
    id,
    ran_at: new Date().toISOString(),
    scope: `${opts.act ?? 'book'}${mode === 'outline' ? ' (outline)' : ''}`,
    mode,
    twists,
    scenes: order,
    log,
    engagement,
    mean_engagement: Math.round(mean * 100) / 100,
    confusions,
    predictions,
    boredom,
  };
  store.writeReport(`reader-${id}.json`, JSON.stringify(report, null, 2));
  store.writeReport(`reader-${id}.md`, readerMarkdown(report));
  if (mode === 'prose') store.updateBook({ health: { ...store.book.health, last_reader_run: report.ran_at, reader_mean_engagement: report.mean_engagement } });
  return report;
}

export function readerMarkdown(r: ReaderReport): string {
  return [
    `# Reader run — ${r.ran_at} (${r.scope})`,
    '',
    `Mean engagement: ${r.mean_engagement} / 5`,
    '',
    '## Engagement by scene',
    ...r.engagement.map((e) => `- ${e.scene} ${'●'.repeat(e.engagement)}${'○'.repeat(5 - e.engagement)} ${e.title}`),
    '',
    '## Twists (two-sided: not guessed early, fair in hindsight)',
    ...(r.twists?.length ? r.twists.map((t) => `- ${t.scene}: ${t.verdict}${t.fairness !== null ? ` (fairness ${t.fairness}/5)` : ''}${t.guessed ? `; guessed in ${t.guessed.guessed_in}` : ''} — ${t.what}`) : ['None.']),
    '',
    '## Predictions that landed early',
    ...(r.predictions.length ? r.predictions.map((p) => `- Guessed in ${p.guessed_in}, revealed in ${p.revealed_in} (${p.early_by} scenes early): "${p.prediction}" → ${p.statement}`) : ['None. No twist was called before its reveal.']),
    '',
    '## Confusions',
    ...(r.confusions.length ? r.confusions.map((c) => `- ${c.scene} [${c.id}] ${c.text} — ${c.resolved_in ? `resolved in ${c.resolved_in}` : 'never resolved'}`) : ['None.']),
    '',
    '## Boredom runs (3+ scenes at 2 or below)',
    ...(r.boredom.length ? r.boredom.map((b) => `- ${b.from} → ${b.to}`) : ['None.']),
    '',
    '## Reading log',
    ...r.log.map((e, i) => `### ${i + 1}. ${e.scene}\n- Believes: ${e.believes}\n- Expects: ${e.expects}\n- Engagement: ${e.engagement}/5${e.predictions.length ? `\n- Predicts: ${e.predictions.join(' | ')}` : ''}`),
  ].join('\n') + '\n';
}

export function latestReaderReport(store: GraphStore): ReaderReport | null {
  const files = store.listReports('reader-').filter((f) => f.endsWith('.json'));
  const last = files[files.length - 1];
  return last ? (JSON.parse(store.readReport(last)!) as ReaderReport) : null;
}
