import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  Coins,
  FileWarning,
  GitCommitHorizontal,
  Layers,
  ShieldCheck,
  Waves,
  Feather,
  Lightbulb,
  ListChecks,
  BookText,
  PenLine,
  Telescope,
  Sparkles,
  Link2,
  SpellCheck,
} from 'lucide-react';
import { get } from '../lib/api';
import { useApp } from '../lib/app';
import type { Commit, Snapshot } from '../lib/types';
import { ago, money, plural } from '../lib/util';
import { Badge, Button, Ring, SyncBadge } from '../components/ui';
import { Sparkline } from '../components/chart';

export const STAGES = [
  { id: 'idea', name: 'Idea', desc: 'Find the story', icon: Sparkles },
  { id: 'intent', name: 'Intent', desc: 'What the book is', icon: Lightbulb },
  { id: 'plot-points', name: 'Plot points', desc: 'What must happen', icon: ListChecks },
  { id: 'structure', name: 'Structure', desc: 'Acts and chapters', icon: Layers },
  { id: 'cards', name: 'Scene cards', desc: 'Beats per scene', icon: BookText },
  { id: 'prose', name: 'Prose', desc: 'Write the scenes', icon: PenLine },
  { id: 'complete', name: 'Review', desc: 'Read it as a reader', icon: Telescope },
] as const;

export function Stepper({ stage, onPick, current }: { stage: string; onPick: (id: string) => void; current?: string }) {
  const at = STAGES.findIndex((s) => s.id === stage);
  return (
    <nav className="stepper" aria-label="Pipeline">
      {STAGES.map((s, i) => {
        const done = i < at || (stage === 'complete' && i === at);
        const locked = i > at;
        const isCurrent = (current ?? stage) === s.id;
        return (
          <button key={s.id} className={`step ${done ? 'done' : ''} ${locked ? 'locked' : ''}`} aria-current={isCurrent ? 'step' : undefined} onClick={() => !locked && onPick(s.id)} disabled={locked} title={locked ? 'Finish the earlier steps first' : s.desc}>
            <span className="step-dot">{done && !isCurrent ? <Check /> : i + 1}</span>
            <span className="step-text">
              <div className="step-name">{s.name}</div>
              <div className="step-desc">{s.desc}</div>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function nextStep(p: Snapshot): { label: string; view: Parameters<ReturnType<typeof useApp>['go']>[0]; id?: string } {
  if (p.ripple) return { label: 'Continue the ripple review', view: 'ripple' };
  const conflict = p.scenes.find((s) => s.sync === 'conflict');
  if (conflict) return { label: `Resolve ${conflict.id}`, view: 'scene', id: conflict.id };
  switch (p.book.stage) {
    case 'idea':
      return { label: 'Find your story', view: 'build', id: 'idea' };
    case 'intent':
      return { label: 'Describe your book', view: 'build', id: 'intent' };
    case 'plot-points':
      return { label: 'Pin your plot points', view: 'build', id: 'plot-points' };
    case 'structure':
      return { label: 'Choose a structure', view: 'build', id: 'structure' };
    case 'cards':
      return { label: 'Plan the scenes', view: 'build', id: 'cards' };
    case 'prose':
      return { label: 'Write the scenes', view: 'build', id: 'prose' };
    default:
      return p.reader ? { label: 'Open the reader report', view: 'reader' } : { label: 'Run the first reader', view: 'reader' };
  }
}

export function Dashboard() {
  const { project: p, go } = useApp();
  const [history, setHistory] = useState<Commit[]>([]);
  useEffect(() => {
    get<Commit[]>('/history?limit=6').then(setHistory).catch(() => setHistory([]));
  }, [p?.totals.words, p?.ripple?.round]);
  if (!p) return null;

  const next = nextStep(p);
  const attention: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; badge?: React.ReactNode }[] = [];
  if (p.ripple)
    attention.push({ icon: <Waves size={16} style={{ color: 'var(--accent)' }} />, title: 'A ripple is waiting for review', sub: p.ripple.description, onClick: () => go('ripple'), badge: <Badge kind="accent">Round {p.ripple.round}</Badge> });
  for (const s of p.scenes.filter((s) => s.sync === 'conflict' || s.sync === 'card_ahead' || s.sync === 'prose_ahead'))
    attention.push({ icon: <FileWarning size={16} style={{ color: s.sync === 'conflict' ? 'var(--danger)' : 'var(--warning)' }} />, title: `${s.id} ${s.card.title}`, sub: s.sync === 'prose_ahead' ? 'Your edits have not been read back into the story' : s.sync === 'card_ahead' ? 'The card changed after the prose was written' : 'Card and prose both changed', onClick: () => go('scene', s.id), badge: <SyncBadge state={s.sync} compact /> });
  for (const s of p.scenes.filter((s) => s.contradictions.length))
    attention.push({ icon: <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />, title: `${s.id}: prose disagrees with its card`, sub: s.contradictions.map((c) => c.card_says).join('; '), onClick: () => go('scene', s.id) });
  for (const i of [...p.continuity.mechanical, ...p.continuity.model].slice(0, 6))
    attention.push({ icon: <CircleAlert size={16} style={{ color: i.severity === 'high' ? 'var(--danger)' : 'var(--warning)' }} />, title: i.message, sub: `Continuity · ${i.scene}`, onClick: () => i.scene && go('scene', i.scene) });
  for (const i of p.obligationIssues.filter((x) => x.severity !== 'low').slice(0, 4))
    attention.push({ icon: <Link2 size={16} style={{ color: i.severity === 'high' ? 'var(--danger)' : 'var(--warning)' }} />, title: i.message, sub: `Setups and payoffs · ${i.scene}`, onClick: () => go('threads', 'ledger') });
  for (const s of p.scenes.filter((s) => s.style?.enforced).slice(0, 4))
    attention.push({ icon: <SpellCheck size={16} style={{ color: 'var(--warning)' }} />, title: `${s.id}: ${plural(s.style!.enforced, 'style rule')} broken`, sub: 'The line editor could not fix these; they are underlined in the scene', onClick: () => go('scene', s.id) });
  for (const e of p.issues.filter((i) => i.severity === 'error').slice(0, 4))
    attention.push({ icon: <CircleAlert size={16} style={{ color: 'var(--danger)' }} />, title: e.message, sub: `${e.file}${e.path ? ` › ${e.path}` : ''}`, onClick: () => go('settings') });

  const t = p.totals;
  const inSync = t.bySync.in_sync ?? 0;
  const written = p.scenes.filter((s) => s.sync !== 'unwritten').length;
  const styled = p.scenes.filter((s) => s.style);
  const engagement = p.scenes.map((s) => s.engagement).filter((x): x is number => x !== null);

  return (
    <div className="page">
      <div className="page-inner">
        <section className="hero">
          <div>
            <h1>{p.book.title}</h1>
            <div className="meta">
              {p.book.genre && <span>{p.book.genre}</span>}
              <Badge kind="outline">{p.book.pov_mode.replace('-', ' ')} · {p.book.tense} tense</Badge>
              {p.branches.current !== 'main' && <Badge kind="info">What-if: {p.branches.current}</Badge>}
            </div>
            {p.intent.premise && <p className="premise">{p.intent.premise}</p>}
            <div className="btn-row" style={{ marginTop: 20 }}>
              <Button variant="primary" size="lg" icon={<ArrowRight />} onClick={() => go(next.view, next.id)}>
                {next.label}
              </Button>
              {written > 0 && (
                <Button size="lg" variant="ghost" icon={<Feather />} onClick={() => go('outline')}>
                  Browse the manuscript
                </Button>
              )}
            </div>
          </div>
          <Ring value={t.words} max={p.book.target_words} label={t.words >= 1000 ? `${(t.words / 1000).toFixed(1)}k` : t.words} sub={`of ${(p.book.target_words / 1000).toFixed(0)}k words`} />
        </section>

        <Stepper stage={p.book.stage} onPick={(id) => go('build', id)} />

        <div className="tiles">
          <button className="tile" onClick={() => go('outline')}>
            <span className="tile-label">
              <Layers /> Scenes
            </span>
            <span className="tile-value">
              {written}
              <small>of {t.scenes} written</small>
            </span>
            <div className="bar" aria-label="Scenes by status">
              <span style={{ width: `${((t.byStatus.locked ?? 0) / Math.max(1, t.scenes)) * 100}%`, background: 'var(--info)' }} />
              <span style={{ width: `${((t.byStatus.approved ?? 0) / Math.max(1, t.scenes)) * 100}%`, background: 'var(--success)' }} />
              <span style={{ width: `${((t.byStatus.draft ?? 0) / Math.max(1, t.scenes)) * 100}%`, background: 'var(--border-strong)' }} />
            </div>
            <span className="tile-foot">
              {t.byStatus.approved ?? 0} approved · {t.byStatus.locked ?? 0} locked · {t.byStatus.draft ?? 0} draft
            </span>
          </button>
          <button className="tile" onClick={() => go('outline')}>
            <span className="tile-label">
              <ShieldCheck /> Graph and prose
            </span>
            <span className="tile-value">
              {written ? Math.round((inSync / Math.max(1, written)) * 100) : 100}
              <small>% in sync</small>
            </span>
            <span className="tile-foot">{written - inSync > 0 ? `${written - inSync} scene${written - inSync === 1 ? '' : 's'} need attention` : 'Nothing has drifted'}</span>
          </button>
          <button className="tile" onClick={() => go('reader')}>
            <span className="tile-label">
              <Activity /> First reader
            </span>
            {p.reader ? (
              <>
                <span className="tile-value">
                  {p.reader.mean.toFixed(1)}
                  <small>/ 5 engagement</small>
                </span>
                <Sparkline values={engagement} width={180} height={28} />
                <span className="tile-foot">
                  {p.reader.predictions ? `${plural(p.reader.predictions, 'twist')} guessed early` : 'No twist guessed early'} · {ago(p.reader.ran_at)}
                </span>
              </>
            ) : (
              <>
                <span className="tile-value faint">—</span>
                <span className="tile-foot">Not run yet</span>
              </>
            )}
          </button>
          <button className="tile" onClick={() => go('threads', 'ledger')}>
            <span className="tile-label">
              <Link2 /> Setups and payoffs
            </span>
            {p.obligations.length ? (
              <>
                <span className="tile-value">
                  {p.obligations.filter((o) => o.payoff_scene).length}
                  <small>of {p.obligations.length} paid off</small>
                </span>
                <span className="tile-foot">{p.obligationIssues.length ? `${plural(p.obligationIssues.length, 'problem')} in the ledger` : 'Every promise is kept'}</span>
              </>
            ) : (
              <>
                <span className="tile-value faint">—</span>
                <span className="tile-foot">Scene cards add clues and promises here</span>
              </>
            )}
          </button>
          <button className="tile" onClick={() => go('settings', 'style')}>
            <span className="tile-label">
              <SpellCheck /> Style
            </span>
            {styled.length ? (
              <>
                <span className="tile-value">
                  {styled.filter((s) => !s.style!.enforced).length}
                  <small>of {styled.length} scenes clean</small>
                </span>
                <span className="tile-foot">{styled.reduce((n, s) => n + s.style!.guided, 0)} softer notes · checked on every word</span>
              </>
            ) : (
              <>
                <span className="tile-value faint">—</span>
                <span className="tile-foot">Set your style dials</span>
              </>
            )}
          </button>
          <button className="tile" onClick={() => go('settings', 'models')}>
            <span className="tile-label">
              <Coins /> Cost
            </span>
            <span className="tile-value">
              {money(p.costs.total_usd)}
              <small>spent</small>
            </span>
            <span className="tile-foot">≈ {money(p.estimate.total_usd)} to finish {p.estimate.scenes_to_write ? `${p.estimate.scenes_to_write} scenes` : 'reviews'}</span>
          </button>
        </div>

        <div className="two-col">
          <div className="card">
            <div className="card-head">
              <h3>Needs your attention</h3>
              {attention.length > 0 && <Badge kind="warning">{attention.length}</Badge>}
            </div>
            {attention.length ? (
              <div className="list">
                {attention.slice(0, 10).map((a, i) => (
                  <button key={i} className="list-item" onClick={a.onClick}>
                    {a.icon}
                    <span className="grow">
                      <div className="primary-text">{a.title}</div>
                      <div className="secondary-text">{a.sub}</div>
                    </span>
                    <span className="end">{a.badge}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="row muted" style={{ padding: '8px 4px' }}>
                <ShieldCheck size={16} style={{ color: 'var(--success)' }} /> Everything agrees. No conflicts, no drift, no continuity issues.
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <h3>Recent changes</h3>
              <Button size="sm" variant="ghost" className="more" onClick={() => go('history')}>
                All history
              </Button>
            </div>
            <div className="list">
              {history.map((c) => (
                <button key={c.hash} className="list-item" onClick={() => go('history', c.hash)}>
                  <GitCommitHorizontal size={15} className={c.message.startsWith('Ripple') ? '' : 'faint'} style={c.message.startsWith('Ripple') ? { color: 'var(--accent)' } : undefined} />
                  <span className="grow">
                    <div className="primary-text" style={{ fontWeight: 400 }}>{c.message}</div>
                  </span>
                  <span className="end faint">{ago(c.date)}</span>
                </button>
              ))}
              {!history.length && <p className="faint">No history yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
