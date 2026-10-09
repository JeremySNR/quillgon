import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CircleSlash, Eye, Lock, LockOpen, PenLine, RotateCcw, Undo2, Waves, X, Wand2, Play, Plus, AlertTriangle, CheckCircle2, Hourglass } from 'lucide-react';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app';
import type { RippleData, RippleItem, SceneCard } from '../lib/types';
import { ago, cx, factLabel, firstName, plural } from '../lib/util';
import { Badge, Button, Dialog, Empty, Field, Kbd, ListEditor, Working } from '../components/ui';
import { CardDiff, ProseDiff, ProseSideBySide } from '../components/diff';
import { BlastRadius } from '../components/blast-radius';

const STATUS: Record<string, { label: string; kind?: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'outline' }> = {
  pending: { label: 'To review', kind: 'outline' },
  proposed: { label: 'Proposed', kind: 'accent' },
  accepted: { label: 'Accepted', kind: 'success' },
  rejected: { label: 'Rejected' },
  no_change: { label: 'No change', kind: 'outline' },
  conflict: { label: 'Conflict', kind: 'danger' },
  resolved: { label: 'Kept locked', kind: 'info' },
  error: { label: 'Error', kind: 'danger' },
};

function severity(it: RippleItem): string {
  if (it.status === 'conflict') return 'var(--danger)';
  if (it.status === 'accepted' || it.status === 'no_change' || it.status === 'resolved') return 'var(--success)';
  if (it.status === 'rejected') return 'var(--text-3)';
  return it.hop <= 1 ? 'var(--warning)' : 'var(--info)';
}

export function RippleReview() {
  const { project: p, go, toast, refresh, jobs } = useApp();
  const [data, setData] = useState<RippleData | null | undefined>(undefined);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [past, setPast] = useState<{ id: string; created: string; description: string; state: string; rounds: number }[]>([]);
  const [proseMode, setProseMode] = useState<'inline' | 'side'>('inline');
  const [editing, setEditing] = useState<SceneCard | null>(null);

  const load = useCallback(async () => {
    const d = await get<RippleData | null>('/ripple');
    setData(d);
    if (!d) setPast(await get('/ripples'));
  }, []);
  useEffect(() => {
    load();
  }, [load, p?.ripple?.round]);

  const round = data?.rounds[data.rounds.length - 1];
  const items = round?.items ?? [];
  useEffect(() => {
    if (items.length && (!sel || !items.some((i) => i.scene === sel))) setSel(items[0].scene);
  }, [items, sel]);
  const item = items.find((i) => i.scene === sel) ?? null;

  const act = useCallback(
    async (label: string, fn: () => Promise<RippleData | void>) => {
      setBusy(label);
      try {
        const d = await fn();
        if (d) setData(d);
        else await load();
      } catch (e) {
        toast({ kind: 'error', message: `${label} failed`, detail: (e as Error).message });
      } finally {
        setBusy(null);
        refresh();
      }
    },
    [load, refresh, toast],
  );
  const { job: runJob } = useApp();

  const accept = (scene: string, card?: SceneCard) => act('Accept', () => post('/ripple/accept', { scene, card }));
  const reject = (scene: string) => act('Reject', () => post('/ripple/reject', { scene }));
  const proposeOne = (scene?: string) => act('Review', () => runJob('/ripple/propose', { scene }, 'Review'));
  const proposeProse = (scene?: string) => act('Prose', () => runJob('/ripple/propose-prose', { scene }, 'Prose revision'));
  const acceptProse = (scene: string) => act('Accept prose', () => post('/ripple/accept-prose', { scene }));
  const rejectProse = (scene: string) => act('Reject prose', () => post('/ripple/reject-prose', { scene }));
  const resolve = (scene: string, resolution: string) =>
    act('Resolve', async () => {
      if (resolution === 'revert') {
        await runJob('/ripple/revert', {}, 'Revert');
        toast({ kind: 'success', message: 'The original change was reverted' });
        return;
      }
      return post('/ripple/resolve', { scene, resolution });
    });
  const apply = () =>
    act('Apply', async () => {
      const d = await runJob<RippleData>('/ripple/apply', {}, 'Apply round');
      toast({
        kind: d.state === 'capped' ? 'warning' : 'success',
        message: d.state === 'done' ? 'Ripple complete' : d.state === 'capped' ? 'Stopped at the cascade cap' : `Round ${d.rounds.length - 1} committed`,
        detail: d.state === 'reviewing' ? `The accepted changes reach ${plural(d.rounds[d.rounds.length - 1].items.length, 'more scene')}. Round ${d.rounds.length} is ready.` : undefined,
      });
      return d.state === 'reviewing' ? d : undefined;
    });

  const blockers = useMemo(() => {
    const out: string[] = [];
    for (const it of items) {
      if (['pending', 'proposed', 'error'].includes(it.status)) out.push(`${it.scene}: card ${it.status === 'pending' ? 'not reviewed' : it.status}`);
      if (it.status === 'conflict') out.push(`${it.scene}: conflict`);
      if (it.prose.status === 'pending' || it.prose.status === 'proposed') out.push(`${it.scene}: prose ${it.prose.status === 'pending' ? 'not revised' : 'awaiting decision'}`);
    }
    return out;
  }, [items]);

  // keyboard review: j/k move, a/r decide, shift+enter applies
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || busy || editing) return;
      const i = items.findIndex((x) => x.scene === sel);
      if (e.key === 'j' || e.key === 'ArrowDown') (e.preventDefault(), setSel(items[Math.min(items.length - 1, i + 1)]?.scene ?? sel));
      else if (e.key === 'k' || e.key === 'ArrowUp') (e.preventDefault(), setSel(items[Math.max(0, i - 1)]?.scene ?? sel));
      else if (item && e.key === 'a') {
        if (item.status === 'proposed') accept(item.scene);
        else if (item.prose.status === 'proposed') acceptProse(item.scene);
      } else if (item && e.key === 'r') {
        if (item.status === 'proposed') reject(item.scene);
        else if (item.prose.status === 'proposed') rejectProse(item.scene);
      } else if (e.key === 'Enter' && e.shiftKey && !blockers.length) apply();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!p) return null;
  if (data === undefined) return <div className="page"><div className="page-inner"><div className="skeleton" style={{ height: 400 }} /></div></div>;

  if (!data)
    return (
      <div className="page">
        <div className="page-inner">
          <Empty icon={<Waves />} title="No ripple in progress" actions={<Button icon={<Eye />} onClick={() => go('outline')}>Open the outline</Button>}>
            A ripple starts when you change something the rest of the book depends on: a scene card, what a character knows, a thread, a plot point, or the order of scenes. You’ll review every proposed change here before anything is rewritten.
          </Empty>
          {past.length > 0 && (
            <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
              <div className="card-head">
                <h3>Past ripples</h3>
              </div>
              <div className="list">
                {past.slice(0, 12).map((r) => (
                  <div key={r.id} className="list-item" style={{ cursor: 'default' }}>
                    {r.state === 'done' ? <CheckCircle2 size={16} style={{ color: 'var(--success)' }} /> : r.state === 'reverted' ? <Undo2 size={16} className="faint" /> : <CircleSlash size={16} className="faint" />}
                    <span className="grow">
                      <div className="primary-text" style={{ fontWeight: 400 }}>{r.description}</div>
                      <div className="secondary-text">
                        {r.state} · {plural(r.rounds, 'round')} · {ago(r.created)}
                      </div>
                    </span>
                    {r.state === 'done' && (
                      <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => confirm('Revert every change this ripple made, including the original edit?') && runJob('/ripple/revert', { id: r.id }, 'Revert').then(load)}>
                        Revert
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );

  const names = (id: string) => firstName(p.characters, id);
  const job = jobs[jobs.length - 1];
  const pendingCards = items.filter((i) => i.status === 'pending').length;
  const pendingProse = items.filter((i) => i.prose.status === 'pending').length;

  return (
    <div className="review" data-busy={busy ?? ""} data-sel={sel ?? ""} data-editing={editing ? "1" : ""} data-item={item?.status ?? ""}>
      {/* ------------------------------------------------ origin */}
      <section className="origin" aria-label="The change">
        <div>
          <div className="section-title">The change</div>
          <p style={{ fontSize: 15, lineHeight: 1.5 }} className="serif">{data.description}</p>
        </div>
        <div className="blast-wrap">
          <BlastRadius
            items={items}
            order={p.scenes.map((s) => s.id)}
            handled={data.handled}
            selected={sel}
            onSelect={setSel}
            colour={severity}
            titles={Object.fromEntries(p.scenes.map((s) => [s.id, s.card.title]))}
          />
          <div className="blast-legend faint">Inner ring: directly affected. The book runs clockwise from the top.</div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <span className="label">Round {round!.n}</span>
            <span className="faint" style={{ fontSize: 'var(--fs-caption)' }}>of at most {data.roundCap}</span>
          </div>
          <div className="round-meter" aria-hidden>
            {Array.from({ length: data.roundCap }, (_, i) => (
              <span key={i} className={i < data.rounds.length ? 'on' : ''} />
            ))}
          </div>
          <span className="faint" style={{ fontSize: 'var(--fs-caption)' }}>
            Hop limit {data.hopLimit}. Accepted card changes can reach further scenes in the next round.
          </span>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {pendingCards > 0 && (
            <Button icon={<Wand2 />} onClick={() => proposeOne()} disabled={!!busy}>
              Review {plural(pendingCards, 'scene')}
            </Button>
          )}
          {pendingProse > 0 && (
            <Button icon={<PenLine />} onClick={() => proposeProse()} disabled={!!busy}>
              Revise prose for {plural(pendingProse, 'scene')}
            </Button>
          )}
          <Button variant="primary" icon={<Play />} onClick={apply} disabled={!!busy || blockers.length > 0} title={blockers.join('\n')}>
            Apply round {round!.n} <Kbd>⇧↵</Kbd>
          </Button>
          {blockers.length > 0 && <span className="faint" style={{ fontSize: 'var(--fs-caption)' }}>{plural(blockers.length, 'decision')} left before this round can be applied.</span>}
        </div>
        {busy && <Working job={job} fallback={busy} />}
        {data.state === 'capped' && (
          <div className="banner warning">
            <AlertTriangle />
            <div className="banner-body">
              <span className="banner-title">Stopped at the cascade cap</span>
              <span>Still inconsistent: {data.remaining.map((r) => r.scene).join(', ')}</span>
            </div>
          </div>
        )}
        {round!.listed.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="section-title">Possibly related</div>
            <span className="faint" style={{ fontSize: 'var(--fs-caption)', marginTop: -6 }}>Similar scenes beyond the hop limit. Not proposed unless you include them.</span>
            {round!.listed.map((l) => (
              <div key={l.scene} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <span className="mono faint">{l.scene}</span> {p.scenes.find((s) => s.id === l.scene)?.card.title}
                </span>
                <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => act('Include', () => post('/ripple/expand', { scene: l.scene }))}>
                  Include
                </Button>
              </div>
            ))}
          </div>
        )}
        <span className="grow" />
        <div className="stack" style={{ gap: 6 }}>
          <Button variant="ghost" size="sm" icon={<RotateCcw />} onClick={() => confirm('Revert the original change and everything this ripple applied?') && act('Revert', () => runJob('/ripple/revert', {}, 'Revert'))}>
            Revert everything
          </Button>
          <Button variant="ghost" size="sm" icon={<X />} onClick={() => act('Abandon', () => post('/ripple/abandon').then(() => undefined))}>
            Stop reviewing (keep what’s applied)
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------ affected */}
      <section className="affected" aria-label="Affected scenes" role="listbox">
        <div className="row" style={{ padding: '6px 12px 10px', justifyContent: 'space-between' }}>
          <span className="label">{plural(items.length, 'affected scene')}</span>
          <span className="faint" style={{ fontSize: 'var(--fs-caption)' }}>
            <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>a</Kbd> <Kbd>r</Kbd> decide
          </span>
        </div>
        {items.map((it) => (
          <button key={it.scene} className="affected-item" role="option" aria-selected={it.scene === sel} onClick={() => setSel(it.scene)}>
            <span className="sev" style={{ background: severity(it) }} />
            <span style={{ minWidth: 0 }}>
              <div className="t">
                <span className="mono faint">{it.scene}</span> {it.title}
              </div>
              <div className="r">{it.kind === 'origin' ? 'Your edit; prose must follow' : it.reasons[0]}</div>
            </span>
            <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
              <Badge kind={STATUS[it.status]?.kind}>{it.kind === 'origin' ? 'Your edit' : STATUS[it.status]?.label}</Badge>
              {it.prose.status !== 'none' && <span className="hop">PROSE {it.prose.status.toUpperCase()}</span>}
              {it.prose.status === 'none' && <span className="hop">HOP {it.hop}</span>}
            </span>
          </button>
        ))}
      </section>

      {/* ------------------------------------------------ diff */}
      <section className="diffpane" aria-label="Proposed change">
        {item ? (
          <ItemDetail
            key={item.scene}
            item={item}
            names={names}
            facts={p.facts}
            busy={!!busy}
            proseMode={proseMode}
            setProseMode={setProseMode}
            onAccept={() => accept(item.scene)}
            onReject={() => reject(item.scene)}
            onEdit={() => setEditing(item.card?.after ?? null)}
            onPropose={() => proposeOne(item.scene)}
            onProposeProse={() => proposeProse(item.scene)}
            onAcceptProse={() => acceptProse(item.scene)}
            onRejectProse={() => rejectProse(item.scene)}
            onReopen={() => act('Undo', () => post('/ripple/reopen', { scene: item.scene }))}
            onResolve={(r) => resolve(item.scene, r)}
            onOpen={() => go('scene', item.scene)}
          />
        ) : (
          <Empty icon={<CheckCircle2 />} title="Nothing to review in this round">
            Apply the round to commit it.
          </Empty>
        )}
      </section>

      {editing && (
        <EditCardDialog
          card={editing}
          onClose={() => setEditing(null)}
          onSave={(c) => {
            setEditing(null);
            accept(c.id, c);
          }}
        />
      )}
    </div>
  );
}

function ItemDetail(props: {
  item: RippleItem;
  names: (id: string) => string;
  facts: { id: string; statement: string }[];
  busy: boolean;
  proseMode: 'inline' | 'side';
  setProseMode: (m: 'inline' | 'side') => void;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onPropose: () => void;
  onProposeProse: () => void;
  onAcceptProse: () => void;
  onRejectProse: () => void;
  onReopen: () => void;
  onResolve: (r: 'unlock' | 'keep' | 'revert') => void;
  onOpen: () => void;
}) {
  const { item: it, names, facts, busy } = props;
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="mono faint">{it.scene}</span>
        <span className="hop">HOP {it.hop}</span>
        <span className="faint" style={{ fontSize: 'var(--fs-caption)' }}>{Math.round(it.confidence * 100)}% confidence</span>
        <span className="grow" />
        <Button size="sm" variant="ghost" icon={<Eye />} onClick={props.onOpen}>
          Open scene
        </Button>
      </div>
      <h2 className="serif" style={{ fontSize: 'var(--fs-title-m)' }}>{it.title}</h2>
      <div className="reasons">
        <ul>
          {it.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {it.status === 'conflict' && (
        <>
          <div className="banner danger">
            <Lock />
            <div className="banner-body">
              <span className="banner-title">This scene is locked ({it.conflict?.lock})</span>
              <span>The change contradicts it, but it won’t be touched without your permission.</span>
            </div>
          </div>
          <div className="conflict-options">
            <button className="option" onClick={() => props.onResolve('unlock')} disabled={busy}>
              <LockOpen />
              <span>
                <div className="ot">Unlock and include it</div>
                <div className="od">The reviser proposes a change for this scene like any other.</div>
              </span>
            </button>
            <button className="option" onClick={() => props.onResolve('keep')} disabled={busy}>
              <Lock />
              <span>
                <div className="ot">Keep it as it is</div>
                <div className="od">Record the inconsistency in reports/known-inconsistencies.md and move on.</div>
              </span>
            </button>
            <button className="option" onClick={() => props.onResolve('revert')} disabled={busy}>
              <Undo2 />
              <span>
                <div className="ot">Revert the original change</div>
                <div className="od">Undo the edit that started this ripple. Nothing else changes.</div>
              </span>
            </button>
          </div>
        </>
      )}

      {it.status === 'pending' && (
        <div className="banner info">
          <Hourglass />
          <div className="banner-body">
            <span className="banner-title">Not reviewed yet</span>
            <span>The reviser reads the change, why this scene was flagged, and its card, then proposes the smallest fix, or says nothing needs to change.</span>
            <div className="btn-row">
              <Button size="sm" variant="primary" icon={<Wand2 />} onClick={props.onPropose} disabled={busy}>
                Review this scene
              </Button>
            </div>
          </div>
        </div>
      )}

      {it.status === 'error' && (
        <div className="banner danger">
          <AlertTriangle />
          <div className="banner-body">
            <span className="banner-title">The reviser failed</span>
            <span className="mono">{it.error}</span>
            <div className="btn-row">
              <Button size="sm" onClick={props.onPropose} disabled={busy}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={props.onReject} disabled={busy}>
                Skip this scene
              </Button>
            </div>
          </div>
        </div>
      )}

      {it.status === 'no_change' && (
        <div className="banner success">
          <CheckCircle2 />
          <div className="banner-body">
            <span className="banner-title">No change needed</span>
            <span>{it.card?.justification}</span>
          </div>
        </div>
      )}

      {it.status === 'resolved' && (
        <div className="banner info">
          <Lock />
          <div className="banner-body">
            <span className="banner-title">Kept locked</span>
            <span>The inconsistency will be recorded when the round is applied.</span>
          </div>
        </div>
      )}

      {it.card?.after && it.status !== 'no_change' && (
        <div className="card flat" style={{ marginBottom: 20 }}>
          <div className="card-head" style={{ marginBottom: it.card.justification && it.kind !== 'origin' ? 6 : undefined }}>
            <h3>{it.kind === 'origin' ? 'Your edit to the card' : 'Proposed card'}</h3>
          </div>
          {it.card.justification && it.kind !== 'origin' && <p className="muted" style={{ marginBottom: 12 }}>{it.card.justification}</p>}
          <CardDiff before={it.card.before} after={it.card.after} facts={facts} names={names} />
          {it.card.needs_decision.length > 0 && (
            <div className="banner warning" style={{ marginTop: 12, marginBottom: 0 }}>
              <AlertTriangle />
              <div className="banner-body">
                <span className="banner-title">Needs your decision</span>
                {it.card.needs_decision.map((n, i) => (
                  <span key={i}>{n}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {it.status === 'proposed' && (
        <div className="decision-bar">
          <Button variant="success" icon={<Check />} kbd="A" onClick={props.onAccept} disabled={busy}>
            Accept
          </Button>
          <Button variant="danger" icon={<X />} kbd="R" onClick={props.onReject} disabled={busy}>
            Reject
          </Button>
          <Button variant="ghost" icon={<PenLine />} onClick={props.onEdit} disabled={busy}>
            Edit, then accept
          </Button>
        </div>
      )}
      {(it.status === 'accepted' || it.status === 'rejected') && it.kind === 'card' && it.prose.status !== 'accepted' && (
        <div className="row" style={{ marginBottom: 16 }}>
          <span className="muted">{it.status === 'accepted' ? 'Card accepted.' : 'Card rejected; this scene stays as it is.'}</span>
          <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={props.onReopen} disabled={busy}>
            Undo
          </Button>
        </div>
      )}

      {it.prose.status !== 'none' && (
        <div style={{ marginTop: 12 }}>
          <div className="section-title">
            Prose <span className="grow" />
            {it.prose.status === 'proposed' && (
              <span className="segmented">
                <button aria-pressed={props.proseMode === 'inline'} onClick={() => props.setProseMode('inline')}>
                  Inline
                </button>
                <button aria-pressed={props.proseMode === 'side'} onClick={() => props.setProseMode('side')}>
                  Side by side
                </button>
              </span>
            )}
          </div>
          {it.prose.status === 'pending' && (
            <div className="banner info">
              <PenLine />
              <div className="banner-body">
                <span className="banner-title">The prose needs to follow the card</span>
                <span>The writer changes only the passages the card change touches, and you see it as a diff.</span>
                <div className="btn-row">
                  <Button size="sm" variant="primary" icon={<Wand2 />} onClick={props.onProposeProse} disabled={busy}>
                    Revise the prose
                  </Button>
                  <Button size="sm" variant="ghost" onClick={props.onRejectProse} disabled={busy}>
                    Keep the prose as is
                  </Button>
                </div>
              </div>
            </div>
          )}
          {it.prose.status === 'locked' && <p className="muted">The prose is locked, so the card will move ahead of it.</p>}
          {it.prose.status === 'proposed' && it.prose.after !== null && (
            <>
              {it.prose.summary && <p className="muted" style={{ marginBottom: 12 }}>{it.prose.summary}</p>}
              {props.proseMode === 'inline' ? <ProseDiff before={it.prose.before} after={it.prose.after} /> : <ProseSideBySide before={it.prose.before} after={it.prose.after} />}
              <div className="decision-bar">
                <Button variant="success" icon={<Check />} kbd="A" onClick={props.onAcceptProse} disabled={busy}>
                  Accept prose
                </Button>
                <Button variant="danger" icon={<X />} kbd="R" onClick={props.onRejectProse} disabled={busy}>
                  Reject
                </Button>
              </div>
            </>
          )}
          {it.prose.status === 'accepted' && (
            <p className={cx('row')} style={{ color: 'var(--success)' }}>
              <CheckCircle2 size={15} /> Prose accepted. It will be written and read back into the story when the round is applied.
            </p>
          )}
          {it.prose.status === 'rejected' && <p className="muted">Prose kept as it is; the scene will show “card ahead” until you revise it.</p>}
        </div>
      )}
      {it.kind === 'card' && it.status === 'no_change' && <p className="faint">Mentions checked: {it.card?.before.mentions.map((m) => `${names(m.character)} → ${factLabel(facts, m.fact)}`).join('; ') || 'none'}</p>}
    </div>
  );
}

function EditCardDialog({ card, onClose, onSave }: { card: SceneCard; onClose: () => void; onSave: (c: SceneCard) => void }) {
  const [c, setC] = useState(card);
  return (
    <Dialog
      title={`Edit the proposal for ${card.id}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check />} onClick={() => onSave(c)}>
            Accept with edits
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Purpose">
          <textarea className="textarea" value={c.purpose} onChange={(e) => setC({ ...c, purpose: e.target.value })} />
        </Field>
        <Field label="Beats">
          <ListEditor items={c.beats} onChange={(beats) => setC({ ...c, beats })} />
        </Field>
        <Field label="Outcome">
          <textarea className="textarea" value={c.outcome} onChange={(e) => setC({ ...c, outcome: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
