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
  Lightbulb,
  ListChecks,
  BookText,
  PenLine,
  Telescope,
  Sparkles,
  Link2,
  SpellCheck,
  MessageSquareText,
  Mic,
} from 'lucide-react';
import { get } from '../lib/api';
import { useApp } from '../lib/app';
import type { Commit, Snapshot } from '../lib/types';
import { ago, loadPref, money, plural } from '../lib/util';
import { Badge, Button, SyncBadge } from '../components/ui';

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

/** A life story's next step follows whose turn it is: a session, notes to answer, a chapter to draft. */
function lifeNext(p: Snapshot): { label: string; stage: string; view: Parameters<ReturnType<typeof useApp>['go']>[0]; id?: string } {
  const life = p.life!;
  const active = life.sessions.find((s) => !s.ended);
  if (active) return { label: 'Continue the session', stage: 'Your interview', view: 'sessions', id: active.id };
  const chapters = p.structure.acts.flatMap((a) => a.chapters);
  const revising = chapters.find((c) => c.stage === 'revising');
  if (revising) return { label: `Review the changes to ${revising.title}`, stage: 'Revision', view: 'revision', id: revising.id };
  const notes = chapters.map((c) => ({ c, n: p.scenes.filter((s) => c.scenes.includes(s.id)).reduce((n, s) => n + s.notes, 0) })).find((x) => x.n > 0);
  if (notes) return { label: `Answer ${plural(notes.n, 'note')} on ${notes.c.title}`, stage: 'Your notes', view: 'scene', id: notes.c.scenes[0] };
  if (!life.stories.length) return { label: 'Start your first session', stage: 'Gathering', view: 'sessions' };
  if (!chapters.length) return { label: 'Shape the book into chapters', stage: 'Shaping', view: 'build' };
  const undrafted = chapters.find((c) => !c.scenes.length && (c.stories ?? []).length);
  if (undrafted && p.book.life.pen !== 'interviewer') return { label: `Draft ${undrafted.title}`, stage: 'Drafting', view: 'build' };
  return { label: 'Start a session', stage: 'Gathering', view: 'sessions' };
}

function nextStep(p: Snapshot): { label: string; view: Parameters<ReturnType<typeof useApp>['go']>[0]; id?: string } {
  if (p.life) return lifeNext(p);
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
  if (p.life) {
    for (const c of p.structure.acts.flatMap((a) => a.chapters)) {
      const n = p.scenes.filter((s) => c.scenes.includes(s.id)).reduce((k, s) => k + s.notes, 0);
      if (n) attention.push({ icon: <MessageSquareText size={16} style={{ color: 'var(--warning)' }} />, title: `${plural(n, 'question')} on ${c.title}`, sub: 'Your ghostwriter’s notes on the draft', onClick: () => go('scene', c.scenes[0]) });
    }
    const queued = p.life.questions.filter((q) => q.status === 'queued' && !q.ask).length;
    if (queued) attention.push({ icon: <Mic size={16} style={{ color: 'var(--accent)' }} />, title: `${plural(queued, 'question')} for your next session`, sub: p.life.questions.find((q) => q.status === 'queued' && !q.ask)?.text ?? '', onClick: () => go('sessions') });
  }
  for (const s of p.scenes.filter((s) => s.sync === 'conflict' || (!p.life && (s.sync === 'card_ahead' || s.sync === 'prose_ahead'))))
    attention.push({ icon: <FileWarning size={16} style={{ color: s.sync === 'conflict' ? 'var(--danger)' : 'var(--warning)' }} />, title: `${s.id} ${s.card.title}`, sub: s.sync === 'prose_ahead' ? 'Your edits have not been read back into the story' : s.sync === 'card_ahead' ? 'The card changed after the prose was written' : 'Card and prose both changed', onClick: () => go('scene', s.id), badge: <SyncBadge state={s.sync} compact /> });
  for (const s of p.scenes.filter((s) => s.contradictions.length))
    attention.push({ icon: <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />, title: `${s.id}: prose disagrees with its card`, sub: s.contradictions.map((c) => c.card_says).join('; '), onClick: () => go('scene', s.id) });
  for (const i of [...p.continuity.mechanical, ...p.continuity.model].slice(0, 6))
    attention.push({ icon: <CircleAlert size={16} style={{ color: i.severity === 'high' ? 'var(--danger)' : 'var(--warning)' }} />, title: i.message, sub: `Continuity · ${i.scene}`, onClick: () => i.scene && go('scene', i.scene) });
  for (const i of p.life ? [] : p.obligationIssues.filter((x) => x.severity !== 'low').slice(0, 4))
    attention.push({ icon: <Link2 size={16} style={{ color: i.severity === 'high' ? 'var(--danger)' : 'var(--warning)' }} />, title: i.message, sub: `Setups and payoffs · ${i.scene}`, onClick: () => go('threads', 'ledger') });
  for (const s of p.scenes.filter((s) => s.style?.enforced).slice(0, 4))
    attention.push({ icon: <SpellCheck size={16} style={{ color: 'var(--warning)' }} />, title: `${s.id}: ${plural(s.style!.enforced, 'style rule')} broken`, sub: 'The line editor could not fix these; they are underlined in the scene', onClick: () => go('scene', s.id) });
  for (const e of p.issues.filter((i) => i.severity === 'error').slice(0, 4))
    attention.push({ icon: <CircleAlert size={16} style={{ color: 'var(--danger)' }} />, title: e.message, sub: `${e.file}${e.path ? ` › ${e.path}` : ''}`, onClick: () => go('settings') });

  const t = p.totals;
  const written = p.scenes.filter((s) => s.sync !== 'unwritten').length;
  const lastScene = loadPref<string>(`lastScene:${p.dir}`, '');
  const resume = p.scenes.find((s) => s.id === lastScene) ?? p.scenes.find((s) => s.sync !== 'unwritten') ?? p.scenes[0];
  const progress = Math.min(100, Math.round(t.words / Math.max(1, p.book.target_words) * 100));
  const chapters = p.structure.acts.flatMap((a) => a.chapters);

  return (
    <div className="page desk-page">
      <div className="page-inner desk-inner">
        <div className="desk-heading"><span className="eyebrow">YOUR WRITING DESK</span><span className="desk-edition">{p.book.genre || 'A work in progress'}</span></div>
        <section className="book-intro">
          <div className="book-cover" aria-hidden="true"><span>QUILLGON / MANUSCRIPT</span><div className="cover-rule" /><strong>{p.book.title}</strong><div className="cover-ornament">Q</div><small>{p.book.genre || (p.life ? 'A life story' : 'A novel')}</small></div>
          <div className="book-intro-copy">
            <span className="eyebrow">{p.book.stage === 'complete' ? 'IN REVIEW' : 'WORK IN PROGRESS'}</span>
            <h1>{p.book.title}</h1>
            {p.intent.premise && <p className="book-premise">{p.intent.premise}</p>}
            {p.life ? (
              <div className="book-metadata"><span>{plural(chapters.length, 'chapter')}</span><span>{p.book.kind === 'guide' ? plural(p.life.stories.length, 'lesson') : plural(p.life.stories.length, 'story', 'stories')} gathered</span><span>{plural(p.life.sessions.length, 'session')}</span>{p.book.kind !== 'guide' && lifeYears(p) && <span>{lifeYears(p)}</span>}</div>
            ) : (
              <div className="book-metadata"><span>{plural(chapters.length, 'chapter')}</span><span>{plural(t.scenes, 'scene')}</span><span>{p.book.pov_mode.replaceAll('-', ' ')} · {p.book.tense} tense</span></div>
            )}
            <div className="btn-row">
              <Button variant="primary" size="lg" icon={<PenLine />} onClick={() => resume ? go('scene', resume.id) : go(next.view, next.id)}>{resume ? 'Continue writing' : next.label}</Button>
              <Button variant="ghost" size="lg" icon={<ArrowRight />} onClick={() => go('outline')}>View manuscript</Button>
            </div>
          </div>
        </section>
        <div className="manuscript-progress">
          <div><strong>{t.words.toLocaleString('en')}</strong><span> of {p.book.target_words.toLocaleString('en')} words</span></div>
          <div className="progress-track" role="progressbar" aria-label="Manuscript word target" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
          <span>{progress}% of your goal</span>
          <span className="progress-scenes">{p.life ? `${p.life.stories.filter((s) => s.status === 'enough').length} of ${p.life.stories.length} ${p.book.kind === 'guide' ? 'lessons' : 'stories'} ready to write` : `${written} of ${t.scenes} scenes written`}</span>
        </div>
        <div className="desk-columns">
          <section className="desk-manuscript">
            <div className="section-heading"><h2>The manuscript</h2><Button variant="ghost" size="sm" onClick={() => go('outline')}>All scenes <ArrowRight size={14} /></Button></div>
            {resume && <button className="resume-scene" onClick={() => go('scene', resume.id)}>
              <span className="eyebrow">{lastScene === resume.id ? 'PICK UP WHERE YOU LEFT OFF' : 'OPEN YOUR MANUSCRIPT'}</span>
              <span className="resume-title">{resume.card.title || 'Untitled scene'}<ArrowRight size={20} /></span>
              <span className="resume-excerpt">{resume.excerpt || resume.card.purpose || 'The next page is yours.'}</span>
              <span className="resume-meta">Scene {String(resume.index + 1).padStart(2, '0')}<span>·</span>{resume.words.toLocaleString('en')} words<SyncBadge state={resume.sync} compact /></span>
            </button>}
            <div className="chapter-list">
              {chapters.slice(0, 5).map((c, i) => {
                const scenes = p.scenes.filter((s) => c.scenes.includes(s.id));
                return <button className="chapter-row" key={c.id} onClick={() => scenes[0] ? go('scene', scenes[0].id) : go('outline')}>
                  <span className="chapter-number">{String(i + 1).padStart(2, '0')}</span>
                  <span className="grow"><strong>{c.title || c.id}</strong><small>{plural(c.scenes.length, 'scene')} · {scenes.reduce((n, s) => n + s.words, 0).toLocaleString('en')} words</small></span>
                  <span className="chapter-dots" aria-label={`${scenes.filter(s => s.sync !== 'unwritten').length} scenes written`}>{scenes.map(s => <i key={s.id} className={s.sync !== 'unwritten' ? 'written' : ''} />)}</span><ArrowRight size={15} />
                </button>;
              })}
              {!chapters.length && (p.life ? <div className="desk-empty"><p>Your book starts with a conversation.</p><Button onClick={() => go('sessions')}>Start a session</Button></div> : <div className="desk-empty"><p>Give your story a shape.</p><Button onClick={() => go('build', 'structure')}>Plan your chapters</Button></div>)}
            </div>
            <div className="section-heading activity-heading"><h2>Recent activity</h2><Button variant="ghost" size="sm" onClick={() => go('history')}>View history</Button></div>
            <div className="activity-list">{history.slice(0, 3).map(c => <button key={c.hash} onClick={() => go('history', c.hash)}><GitCommitHorizontal size={15} /><span>{c.message}</span><time>{ago(c.date)}</time></button>)}{!history.length && <p className="muted">Your saved changes will appear here.</p>}</div>
          </section>
          <aside className="desk-notes">
            <div className="section-heading"><h2>Editor's notes</h2><span className="note-count">{attention.length}</span></div>
            <p className="section-description">A little care for the details.</p>
            <div className="editor-notes">{attention.length ? attention.slice(0, 4).map((a, i) => <button key={i} onClick={a.onClick}>{a.icon}<span><strong>{a.title}</strong><small>{a.sub}</small></span><ArrowRight size={14} /></button>) : <div className="notes-clear"><ShieldCheck size={20} /><strong>Everything is in harmony.</strong><p>No conflicts or continuity issues to review.</p></div>}</div>
            {attention.length > 4 && <details className="more-notes"><summary>Show {attention.length - 4} more notes</summary>{attention.slice(4).map((a, i) => <button key={i} onClick={a.onClick}>{a.title}<ArrowRight size={14} /></button>)}</details>}
            <div className="next-step"><span className="eyebrow">NEXT IN YOUR PROCESS</span><h3>{p.life ? lifeNext(p).stage : STAGES.find(s => s.id === p.book.stage)?.name || 'Review'}</h3><p>Move your story one step closer to its final draft.</p><Button variant="ghost" onClick={() => go(next.view, next.id)}>{next.label}<ArrowRight size={14} /></Button></div>
            <div className="desk-tools"><button onClick={() => go('reader')}><Activity size={16} /><span>Reader report</span><strong>{p.reader ? `${p.reader.mean.toFixed(1)} / 5` : 'Not run'}</strong></button>{p.life ? <button onClick={() => go('share')}><ShieldCheck size={16} /><span>Before you share</span><ArrowRight size={14} /></button> : <button onClick={() => go('threads', 'ledger')}><Link2 size={16} /><span>Setups & payoffs</span><strong>{p.obligations.filter(o => o.payoff_scene).length} / {p.obligations.length}</strong></button>}<button onClick={() => go('settings', 'style')}><SpellCheck size={16} /><span>Writing style</span><ArrowRight size={14} /></button><button onClick={() => go('settings', 'models')}><Coins size={16} /><span>Model spend</span><strong>{money(p.costs.total_usd)}</strong></button></div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** The years a life story's stories cover so far ("1948 to 1994"). */
function lifeYears(p: Snapshot): string {
  const ys = p.life!.stories.map((s) => Number(s.when.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1])).filter((y) => y > 0);
  return ys.length ? `${Math.min(...ys)} to ${Math.max(...ys)}` : '';
}
