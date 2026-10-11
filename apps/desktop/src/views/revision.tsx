import { useCallback, useEffect, useState } from 'react';
import { diffWords } from 'diff';
import { AlertTriangle, Check, CornerDownLeft, MessageCircleQuestion, Ruler, ShieldAlert, Undo2, X } from 'lucide-react';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app';
import { cx, plural } from '../lib/util';
import { Badge, Button, Empty, Kbd, Working } from '../components/ui';

interface Item {
  id: string;
  scene: string;
  find: string;
  replace: string;
  reason: string;
  plan: number[];
  status: 'proposed' | 'accepted' | 'rejected';
  warning: string | null;
}
interface PlanStep {
  text: string;
  kind: 'edit' | 'rule' | 'question' | 'pushback';
  never: string[];
  prefer: { avoid: string; use: string }[];
  guidance: string[];
  question: string;
}
interface Revision {
  chapter: string;
  round: number;
  feedback: string;
  plan: PlanStep[];
  items: Item[];
  refused: { scene: string; find: string; why: string }[];
  overruled: number[];
}

const KIND_ICON = { edit: null, rule: <Ruler size={12} />, question: <MessageCircleQuestion size={12} />, pushback: <ShieldAlert size={12} /> };

/**
 * A revision round: what the author said, the plan the ghostwriter read back, and each proposed
 * change as a passage to accept or reject (j/k to move, a/r to decide, ⇧↵ to apply), like a ripple.
 */
export function RevisionReview({ chapter }: { chapter: string }) {
  const { project: p, go, job, refresh, fail } = useApp();
  const [r, setR] = useState<Revision | null | undefined>(undefined);
  const [at, setAt] = useState(0);
  const load = useCallback(() => get<Revision | null>(`/life/chapters/${chapter}/revision`).then(setR, fail('Could not load the revision')), [chapter, fail]);
  useEffect(() => void load(), [load]);
  const decide = useCallback((item: string, decision: Item['status']) => post<Revision>(`/life/chapters/${chapter}/revision/decide`, { item, decision }).then(setR, fail('Not saved')), [chapter, fail]);
  const apply = useCallback(async () => {
    const out = await job<{ applied: number; rules: number; questions: number }>(`/life/chapters/${chapter}/revision/apply`, {}, 'Applying the revision');
    await refresh();
    const ch = p?.structure.acts.flatMap((a) => a.chapters).find((c) => c.id === chapter);
    if (ch?.scenes[0]) go('scene', ch.scenes[0]);
    else go('build');
    return out;
  }, [chapter, job, refresh, go, p]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!r || (e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'j') setAt((n) => Math.min(n + 1, r.items.length - 1));
      else if (e.key === 'k') setAt((n) => Math.max(n - 1, 0));
      else if (e.key === 'a' && r.items[at]) decide(r.items[at].id, 'accepted');
      else if (e.key === 'r' && r.items[at]) decide(r.items[at].id, 'rejected');
      else if (e.key === 'Enter' && e.shiftKey) void apply();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [r, at, decide, apply]);

  if (!p) return null;
  const ch = p.structure.acts.flatMap((a) => a.chapters).find((c) => c.id === chapter);
  if (r === undefined) return <div className="page"><div className="page-inner"><Working fallback="Loading the revision" /></div></div>;
  if (!r)
    return (
      <div className="page">
        <div className="page-inner">
          <Empty icon={<Check />} title="No revision waiting" actions={<Button onClick={() => go('build')}>Back to the chapters</Button>}>
            Ask for one from the notes beside a draft.
          </Empty>
        </div>
      </div>
    );
  const title = (sid: string) => p.scenes.find((s) => s.id === sid)?.card.title ?? sid;
  const counts = { accepted: r.items.filter((x) => x.status === 'accepted').length, rejected: r.items.filter((x) => x.status === 'rejected').length };
  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <span className="eyebrow">ROUND {r.round}</span>
            <h1>{ch?.title || chapter}: what I’ll change</h1>
            <p className="sub">Each change is a passage to accept or reject. Nothing is written until you apply the round, and the whole round can be undone from History.</p>
          </div>
          <div className="actions">
            <Button variant="ghost" icon={<X />} onClick={() => post(`/life/chapters/${chapter}/revision/discard`).then(() => (refresh(), go('build')))}>
              Discard
            </Button>
            <Button variant="primary" icon={<CornerDownLeft />} kbd="⇧↵" onClick={() => void apply()}>
              Apply the round
            </Button>
          </div>
        </div>
        <div className="revision-grid">
          <aside className="stack">
            <div className="card stack">
              <div className="eyebrow">What you said</div>
              <p className="feedback">{r.feedback ? `“${r.feedback}”` : 'Your answers to the notes.'}</p>
              <hr />
              <div className="eyebrow">What I’ll do</div>
              <ol className="plan">
                {r.plan.map((s, n) => (
                  <li key={n} className={cx(r.overruled.includes(n) && 'overruled')}>
                    <span>
                      {s.text} {s.kind !== 'edit' && <Badge kind={s.kind === 'pushback' ? 'warning' : s.kind === 'rule' ? 'info' : 'accent'}>{KIND_ICON[s.kind]} {s.kind === 'rule' ? 'Rule for the book' : s.kind === 'question' ? 'Question' : 'My view'}</Badge>}
                    </span>
                    {s.kind === 'pushback' && (
                      <Button size="sm" variant="ghost" onClick={() => post<Revision>(`/life/chapters/${chapter}/revision/decide`, { overrule: n, keep: !r.overruled.includes(n) }).then(setR)}>
                        {r.overruled.includes(n) ? 'Hear me out again' : 'Keep it my way'}
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            {r.refused.length > 0 && (
              <div className="card stack">
                <div className="eyebrow">Not changed</div>
                {r.refused.map((x, i) => (
                  <p key={i} className="faint small">
                    “{x.find.slice(0, 60)}”: {x.why}.
                  </p>
                ))}
              </div>
            )}
          </aside>
          <section className="stack">
            <div className="row">
              <span className="faint small grow">
                {plural(r.items.length, 'change')} · {counts.accepted} accepted · {counts.rejected} rejected · the rest go in when you apply
              </span>
              <span className="faint small">
                <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>a</Kbd>/<Kbd>r</Kbd> decide
              </span>
            </div>
            {!r.items.length && <p className="muted">No changes to the text this round{r.plan.some((s) => s.kind === 'rule' || s.kind === 'question') ? ': only rules and questions' : ''}.</p>}
            {r.items.map((it, i) => (
              <div key={it.id} className={cx('change-block', i === at && 'current', it.status)} onClick={() => setAt(i)}>
                <div className="row">
                  <span className="faint small grow">
                    {title(it.scene)}
                    {it.plan.length ? ` · plan ${it.plan.map((n) => n + 1).join(', ')}` : ''}
                    {it.reason ? ` · ${it.reason}` : ''}
                  </span>
                  {it.status !== 'proposed' && <Badge kind={it.status === 'accepted' ? 'success' : 'outline'}>{it.status === 'accepted' ? 'Accepted' : 'Rejected'}</Badge>}
                  <Button size="sm" variant={it.status === 'accepted' ? 'success' : 'ghost'} icon={<Check />} onClick={() => decide(it.id, 'accepted')}>
                    Accept
                  </Button>
                  <Button size="sm" variant="ghost" icon={it.status === 'rejected' ? <Undo2 /> : <X />} onClick={() => decide(it.id, it.status === 'rejected' ? 'proposed' : 'rejected')}>
                    {it.status === 'rejected' ? 'Undo' : 'Reject'}
                  </Button>
                </div>
                <p className="change-text">
                  {diffWords(it.find, it.replace).map((w, k) =>
                    w.added ? <ins key={k}>{w.value}</ins> : w.removed ? <del key={k}>{w.value}</del> : <span key={k}>{w.value}</span>,
                  )}
                </p>
                {it.warning && (
                  <p className="warning small row">
                    <AlertTriangle size={13} /> {it.warning}
                  </p>
                )}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
