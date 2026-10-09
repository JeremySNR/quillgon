import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  PenLine,
  RefreshCw,
  ScanText,
  Sparkles,
  Undo2,
  Wand2,
  Waves,
  BookOpenCheck,
  Plus,
  X,
  Trash2,
} from 'lucide-react';
import { del, get, post, put, runJob } from '../lib/api';
import { useApp } from '../lib/app';
import type { ExtractionResult, Fact, ImpactResult, SceneCard, SceneDetail } from '../lib/types';
import { factLabel, firstName, keys, plural } from '../lib/util';
import { Avatar, Badge, Button, Chip, Dialog, Empty, Field, ListEditor, StatusBadge, SyncBadge, TagSelect, Working } from '../components/ui';
import { ProseEditor, bannedRegexes } from '../components/prose-editor';
import { CardDiff, ProseDiff, ProseSideBySide } from '../components/diff';

type ProseReview = { title: string; before: string; after: string; summary?: string; apply: (text: string) => Promise<void> };

export function SceneEditor({ id }: { id: string }) {
  const { project: p, go, toast, refresh, markSaved, focus, setFocus, jobs } = useApp();
  const [detail, setDetail] = useState<SceneDetail | null>(null);
  const [card, setCard] = useState<SceneCard | null>(null);
  const [prose, setProse] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ result: ImpactResult; change: any } | null>(null);
  const [review, setReview] = useState<ProseReview | null>(null);
  const [facts, setFacts] = useState<ExtractionResult['diff'] | null>(null);
  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const d = await get<SceneDetail>(`/scenes/${id}`).catch(() => null);
    setDetail(d);
    if (d) {
      setCard(d.card);
      setProse(d.prose?.body ?? '');
    }
  }, [id]);
  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);
  // Reload when the project changes underneath (ripple applied, file edited elsewhere) unless we have local edits.
  const cardDirty = !!(detail && card && JSON.stringify(card) !== JSON.stringify(detail.card));
  useEffect(() => {
    if (!cardDirty && !saveTimer.current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.scenes]);

  const banned = useMemo(() => bannedRegexes(p?.style.banned ?? ''), [p?.style.banned]);

  const saveCard = useCallback(async () => {
    if (!card || !cardDirty) return;
    try {
      const r = await put<{ scene: SceneDetail; change: any; impact: ImpactResult }>(`/scenes/${id}/card`, { card });
      setDetail(r.scene);
      setCard(r.scene.card);
      markSaved();
      const others = r.impact.impacts.filter((i) => i.scene !== id && i.hop <= 2);
      if (others.length) setImpact({ result: r.impact, change: r.change });
      else toast({ kind: 'success', message: 'Card saved', detail: r.scene.prose ? 'No other scene is affected.' : undefined });
      refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Card not saved', detail: (e as Error).message });
    }
  }, [card, cardDirty, id, markSaved, refresh, toast]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCard();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saveCard]);

  const onProse = (text: string) => {
    setProse(text);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      saveTimer.current = null;
      const d = await put<SceneDetail>(`/scenes/${id}/prose`, { body: text });
      setDetail((cur) => (cur ? { ...cur, prose: d.prose, sync: d.sync } : d));
      markSaved();
    }, 900);
  };

  if (!p) return null;
  if (!detail || !card) return <div className="page"><div className="page-inner"><div className="skeleton" style={{ height: 32, width: 320, marginBottom: 16 }} /><div className="skeleton" style={{ height: 420 }} /></div></div>;

  const job = jobs[jobs.length - 1];
  const sync = detail.sync.state;
  const chars = p.characters;
  const name = (cid: string) => firstName(chars, cid);
  const charOpts = chars.map((c) => ({ id: c.id, label: c.bio.name }));
  const factOpts = p.facts.map((f) => ({ id: f.id, label: f.statement.length > 60 ? f.statement.slice(0, 58) + '…' : f.statement }));
  const set = <K extends keyof SceneCard>(k: K, v: SceneCard[K]) => setCard({ ...card, [k]: v });
  const proseLocked = card.lock === 'prose' || card.lock === 'both';
  const words = prose.trim() ? prose.trim().split(/\s+/).length : 0;

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast({ kind: 'error', message: `${label} failed`, detail: (e as Error).message });
    } finally {
      setBusy(null);
      load();
      refresh();
    }
  };

  const write = () =>
    withBusy('Writing', async () => {
      const r = await runJob<{ words: number; contradictions: unknown[] }>(`/scenes/${id}/write`);
      toast({ kind: r.contradictions.length ? 'warning' : 'success', message: `Wrote ${r.words} words`, detail: r.contradictions.length ? 'The prose disagrees with the card in places; see the flags.' : 'Style passes and extraction done.' });
    });

  const regenerate = (mode: 'minimal' | 'fresh') =>
    withBusy(mode === 'fresh' ? 'Rewriting' : 'Revising', async () => {
      const r = await runJob<{ before: string; after: string }>(`/scenes/${id}/regenerate`, { mode });
      if (mode === 'fresh') return void toast({ kind: 'success', message: 'Scene rewritten from its card' });
      setReview({
        title: 'Revise prose to match the card',
        before: r.before,
        after: r.after,
        apply: async (text) => {
          await runJob(`/scenes/${id}/accept-prose`, { body: text });
          toast({ kind: 'success', message: 'Prose updated and read back into the story' });
        },
      });
    });

  const style = () =>
    withBusy('Style passes', async () => {
      const r = await runJob<{ before: string; after: string; report: { voiceFlags: unknown[]; bannedBefore: unknown[] } }>(`/scenes/${id}/style`);
      setReview({
        title: 'Style passes',
        before: r.before,
        after: r.after,
        summary: `${plural(r.report.voiceFlags.length, 'voice fix', 'voice fixes')}, ${plural(r.report.bannedBefore.length, 'banned pattern')} removed, humaniser pass.`,
        apply: async (text) => {
          await runJob(`/scenes/${id}/accept-prose`, { body: text });
        },
      });
    });

  const readBack = () =>
    withBusy('Reading back', async () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        await put(`/scenes/${id}/prose`, { body: prose });
      }
      const r = await runJob<{ presentationOnly: boolean; diff: ExtractionResult['diff'] }>(`/scenes/${id}/reconcile`);
      if (r.presentationOnly) toast({ kind: 'success', message: 'Wording only', detail: 'Nothing in the story changed. The scene is in sync.' });
      else setFacts(r.diff);
    });

  const acceptFacts = () =>
    withBusy('Updating card', async () => {
      await post(`/scenes/${id}/accept-facts`);
      setFacts(null);
      go('ripple');
    });

  const setLock = (lock: SceneCard['lock']) =>
    withBusy('Locking', async () => {
      await post(`/scenes/${id}/status`, { lock, ...(lock === 'both' ? { status: 'locked' } : card.status === 'locked' ? { status: 'approved' } : {}) });
      toast({ kind: 'success', message: lock === 'none' ? 'Unlocked' : 'Locked', detail: lock === 'none' ? undefined : 'Ripples will raise a conflict here instead of changing it.' });
    });

  const approve = () =>
    withBusy('Approving', async () => {
      await post(`/scenes/${id}/status`, { status: card.status === 'approved' ? 'draft' : 'approved' });
    });

  const remove = async () => {
    if (!confirm(`Delete ${id} “${card.title}”? Other scenes that depend on it will be offered a ripple.`)) return;
    const r = await del<{ ripple?: unknown; impact?: ImpactResult }>(`/scenes/${id}?ripple=1`);
    toast({ kind: 'info', message: `Deleted ${id}` });
    await refresh();
    go(r.ripple ? 'ripple' : 'outline');
  };

  const pov = chars.find((c) => c.id === card.pov);

  return (
    <div className={`editor ${focus ? 'focus' : ''}`}>
      {/* ---------------- card */}
      <aside className="card-pane" aria-label="Scene card">
        <div className="card-pane-inner">
          <div className="row">
            <span className="mono faint">{id}</span>
            <StatusBadge status={card.status} lock={card.lock} />
            <span className="grow" />
            <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} tip="Delete scene" onClick={remove} />
          </div>
          <input className="input title" value={card.title} onChange={(e) => set('title', e.target.value)} aria-label="Scene title" placeholder="Untitled scene" />
          <div className="grid-2">
            <Field label="Point of view">
              <select className="select" value={card.pov} onChange={(e) => set('pov', e.target.value)}>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.bio.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Where">
              {p.locations.length ? (
                <select className="select" value={card.location} onChange={(e) => set('location', e.target.value)}>
                  {!p.locations.some((l) => l.id === card.location) && <option value={card.location}>{card.location}</option>}
                  {p.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input" value={card.location} onChange={(e) => set('location', e.target.value)} />
              )}
            </Field>
          </div>
          <Field label="When">
            <input className="input" value={card.time} onChange={(e) => set('time', e.target.value)} placeholder="1926-03-12 evening" />
          </Field>
          <Field label="Purpose" hint="Why this scene exists.">
            <textarea className="textarea" rows={2} value={card.purpose} onChange={(e) => set('purpose', e.target.value)} style={{ minHeight: 0, fieldSizing: 'content' } as React.CSSProperties} />
          </Field>
          <Field label="Beats">
            <ListEditor items={card.beats} onChange={(v) => set('beats', v)} placeholder="Add beat" />
          </Field>
          <Field label="Outcome">
            <textarea className="textarea" rows={2} value={card.outcome} onChange={(e) => set('outcome', e.target.value)} style={{ minHeight: 0, fieldSizing: 'content' } as React.CSSProperties} />
          </Field>

          <details className="more">
            <summary>
              <ChevronRight /> People, threads and facts
            </summary>
            <div className="stack">
              <Field label="Characters present">
                <TagSelect value={card.characters} options={charOpts} onChange={(v) => set('characters', v)} />
              </Field>
              <Field label="Threads touched">
                <TagSelect value={card.threads_touched} options={p.threads.map((t) => ({ id: t.id, label: t.title || t.id }))} onChange={(v) => set('threads_touched', v)} />
              </Field>
              <Field label="Plot points staged">
                <TagSelect value={card.plot_points} options={p.plotPoints.map((x) => ({ id: x.id, label: x.title || x.id }))} onChange={(v) => set('plot_points', v)} />
              </Field>
              <Field label="Reveals" hint="Facts that become known in this scene.">
                <TagSelect value={card.reveals} options={factOpts} onChange={(v) => set('reveals', v)} />
              </Field>
              <Field label="Who speaks of what" hint="A character can only mention what they know.">
                <div className="stack" style={{ gap: 6 }}>
                  {card.mentions.map((m, i) => (
                    <div className="row" key={i}>
                      <select className="select" style={{ width: 110 }} value={m.character} onChange={(e) => set('mentions', card.mentions.map((x, j) => (j === i ? { ...x, character: e.target.value } : x)))}>
                        {chars.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.bio.name.split(' ')[0]}
                          </option>
                        ))}
                      </select>
                      <select className="select grow" value={m.fact} onChange={(e) => set('mentions', card.mentions.map((x, j) => (j === i ? { ...x, fact: e.target.value } : x)))}>
                        {!p.facts.some((f) => f.id === m.fact) && <option value={m.fact}>{m.fact}</option>}
                        {factOpts.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Remove" onClick={() => set('mentions', card.mentions.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus />} style={{ alignSelf: 'flex-start' }} onClick={() => set('mentions', [...card.mentions, { character: card.pov, fact: p.facts[0]?.id ?? 'fact' }])}>
                    Add
                  </Button>
                </div>
              </Field>
            </div>
          </details>

          <KnowledgePanel detail={detail} name={name} facts={p.facts} onOpen={(c) => go('characters', c)} />

          {cardDirty && (
            <div className="decision-bar">
              <Button variant="primary" icon={<Check />} kbd={keys('S')} onClick={saveCard}>
                Save card
              </Button>
              <Button variant="ghost" icon={<Undo2 />} onClick={() => setCard(detail.card)}>
                Discard
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- prose */}
      <section className="prose-pane">
        <div className="prose-toolbar">
          <Button size="sm" variant="ghost" iconOnly icon={<ArrowLeft />} tip="Previous scene" disabled={!detail.prev} onClick={() => detail.prev && go('scene', detail.prev)} />
          <Button size="sm" variant="ghost" iconOnly icon={<ArrowRight />} tip="Next scene" disabled={!detail.next} onClick={() => detail.next && go('scene', detail.next)} />
          <SyncBadge state={sync} />
          <span className="faint num" style={{ fontSize: 'var(--fs-caption)' }}>
            {words.toLocaleString('en')} words
          </span>
          <span className="grow" />
          {detail.prose ? (
            <>
              <Button size="sm" variant="ghost" icon={<ScanText />} onClick={readBack} disabled={!!busy} tip="Extract facts from my edit">
                Read back
              </Button>
              <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={style} disabled={!!busy || proseLocked}>
                Style passes
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => regenerate('minimal')} disabled={!!busy || proseLocked} tip="Change only what the card change needs">
                Revise to card
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" icon={card.status === 'approved' ? <BookOpenCheck /> : <Check />} onClick={approve} disabled={!!busy || card.status === 'locked'}>
            {card.status === 'approved' ? 'Approved' : 'Approve'}
          </Button>
          <Button size="sm" variant="ghost" iconOnly icon={card.lock === 'none' ? <LockOpen /> : <Lock />} tip={card.lock === 'none' ? 'Lock card and prose' : 'Unlock'} onClick={() => setLock(card.lock === 'none' ? 'both' : 'none')} disabled={!!busy} />
          <Button size="sm" variant="ghost" iconOnly icon={focus ? <Minimize2 /> : <Maximize2 />} tip="Focus mode" kbd={keys('.')} onClick={() => setFocus(!focus)} />
        </div>
        <div className="prose-scroll">
          <div className="prose-column">
            <h1 className="scene-heading">{card.title || 'Untitled scene'}</h1>
            <div className="scene-sub">
              {pov && (
                <span className="row">
                  <Avatar id={pov.id} name={pov.bio.name} /> {pov.bio.name}
                </span>
              )}
              <span>{p.locations.find((l) => l.id === card.location)?.name ?? card.location}</span>
              {card.time && <span>{card.time}</span>}
              {card.threads_touched.map((t) => (
                <Chip key={t} id={t}>
                  {p.threads.find((x) => x.id === t)?.title || t}
                </Chip>
              ))}
            </div>

            {busy && <div style={{ marginBottom: 20 }}><Working job={job} fallback={busy} /></div>}
            <SyncBanner state={sync} busy={!!busy} onReadBack={readBack} onRevise={() => regenerate('minimal')} onFresh={() => regenerate('fresh')} onKeep={() => withBusy('Marking', async () => void (await post(`/scenes/${id}/mark-in-sync`)))} cardDirty={cardDirty} />
            {detail.facts?.contradictions.length ? (
              <div className="banner warning">
                <AlertTriangle />
                <div className="banner-body">
                  <span className="banner-title">The prose disagrees with its card</span>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {detail.facts.contradictions.map((c, i) => (
                      <li key={i}>
                        Card: {c.card_says}. Prose: {c.prose_says}.
                      </li>
                    ))}
                  </ul>
                  <div className="btn-row">
                    <Button size="sm" onClick={() => regenerate('minimal')} disabled={!!busy || proseLocked} icon={<Wand2 />}>
                      Fix the prose
                    </Button>
                    <Button size="sm" variant="ghost" onClick={readBack} disabled={!!busy}>
                      Update the card instead
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {!detail.prose && !prose ? (
              <Empty
                icon={<PenLine />}
                title="This scene hasn’t been written yet"
                actions={
                  <Button variant="primary" icon={<Wand2 />} onClick={write} disabled={!!busy || !card.beats.length}>
                    Write this scene
                  </Button>
                }
              >
                {card.beats.length ? `The writer will follow the ${plural(card.beats.length, 'beat')} on the card, then run the style passes and read the result back into the story. Or just start typing.` : 'Add some beats to the card first, or just start typing.'}
              </Empty>
            ) : null}
            <ProseEditor value={prose} onChange={onProse} banned={banned} readOnly={proseLocked} placeholder={detail.prose ? undefined : 'Or start writing here…'} />
          </div>
        </div>
      </section>

      {impact && (
        <Dialog
          title="This change reaches other scenes"
          onClose={() => setImpact(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setImpact(null)}>
                Not now
              </Button>
              <Button variant="primary" icon={<Waves />} onClick={async () => (await post('/ripple/start', { change: impact.change }), setImpact(null), go('ripple'))}>
                Review the ripple
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 12 }}>{impact.result.description}</p>
          <div className="list">
            {impact.result.impacts
              .filter((i) => i.scene !== id)
              .map((i) => (
                <div key={i.scene} className="list-item" style={{ cursor: 'default' }}>
                  <span className="hop">HOP {i.hop}</span>
                  <span className="grow">
                    <div className="primary-text">
                      <span className="mono faint">{i.scene}</span> {p.scenes.find((s) => s.id === i.scene)?.card.title}
                    </div>
                    <div className="secondary-text">{i.reasons[0]}</div>
                  </span>
                  {i.conflict && <Badge kind="info" icon={<Lock />}>Locked</Badge>}
                </div>
              ))}
          </div>
          <p className="faint" style={{ marginTop: 12 }}>Nothing changes until you accept each proposal.</p>
        </Dialog>
      )}

      {review && <ProseReviewDialog review={review} onClose={() => setReview(null)} onDone={() => (setReview(null), load(), refresh())} />}

      {facts && (
        <Dialog
          title="Your edit changed these facts"
          onClose={() => setFacts(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setFacts(null)}>
                Not yet
              </Button>
              <Button variant="primary" icon={<Waves />} onClick={acceptFacts} disabled={!!busy}>
                Update the card and review the ripple
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 16 }}>Reading your prose back into the story found changes to what is true. Accepting updates this scene’s card, and then shows you every other scene that depends on it.</p>
          <FactList title="No longer true" facts={facts.removed} kind="del" name={name} glossary={p.facts} />
          <FactList title="Now true" facts={facts.added} kind="ins" name={name} glossary={p.facts} />
        </Dialog>
      )}
    </div>
  );
}

function FactList({ title, facts, kind, name, glossary }: { title: string; facts: Fact[]; kind: 'ins' | 'del'; name: (id: string) => string; glossary: { id: string; statement: string }[] }) {
  if (!facts.length) return null;
  const verb: Record<string, string> = { knows: 'knows', mentions: 'speaks of', located_at: 'is at', feels: 'feels', wants: 'wants', dies: 'dies', event: '' };
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="section-title">{title}</div>
      <ul className="reasons" style={{ margin: 0 }}>
        {facts.map((f, i) => (
          <li key={i}>
            {kind === 'ins' ? <ins>{name(f.subject)} {verb[f.predicate]} {factLabel(glossary, f.object)}</ins> : <del>{name(f.subject)} {verb[f.predicate]} {factLabel(glossary, f.object)}</del>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SyncBanner({ state, busy, onReadBack, onRevise, onFresh, onKeep, cardDirty }: { state: string; busy: boolean; onReadBack: () => void; onRevise: () => void; onFresh: () => void; onKeep: () => void; cardDirty: boolean }) {
  if (cardDirty)
    return (
      <div className="banner info">
        <PenLine />
        <div className="banner-body">
          <span className="banner-title">Unsaved card changes</span>
          <span>Save the card to see which other scenes this affects. Nothing is rewritten without your say-so.</span>
        </div>
      </div>
    );
  if (state === 'prose_ahead')
    return (
      <div className="banner info">
        <ScanText />
        <div className="banner-body">
          <span className="banner-title">You’ve edited the prose</span>
          <span>Read it back so the rest of the book knows what changed. Wording-only edits are reconciled instantly.</span>
          <div className="btn-row">
            <Button size="sm" variant="primary" onClick={onReadBack} disabled={busy} icon={<ScanText />}>
              Read back my edits
            </Button>
          </div>
        </div>
      </div>
    );
  if (state === 'card_ahead')
    return (
      <div className="banner warning">
        <AlertTriangle />
        <div className="banner-body">
          <span className="banner-title">The card changed after this prose was written</span>
          <span>Revise the prose to match (smallest change, shown as a diff), rewrite it, or keep it as is.</span>
          <div className="btn-row">
            <Button size="sm" variant="primary" onClick={onRevise} disabled={busy} icon={<Wand2 />}>
              Revise to match
            </Button>
            <Button size="sm" onClick={onFresh} disabled={busy}>
              Rewrite from the card
            </Button>
            <Button size="sm" variant="ghost" onClick={onKeep} disabled={busy}>
              They already match
            </Button>
          </div>
        </div>
      </div>
    );
  if (state === 'conflict')
    return (
      <div className="banner danger">
        <AlertTriangle />
        <div className="banner-body">
          <span className="banner-title">Both the card and the prose changed</span>
          <span>Generation is paused for this scene until you choose which one is right.</span>
          <div className="btn-row">
            <Button size="sm" onClick={onReadBack} disabled={busy}>
              The prose is right
            </Button>
            <Button size="sm" onClick={onRevise} disabled={busy}>
              The card is right
            </Button>
          </div>
        </div>
      </div>
    );
  return null;
}

function KnowledgePanel({ detail, name, facts, onOpen }: { detail: SceneDetail; name: (id: string) => string; facts: { id: string; statement: string }[]; onOpen: (c: string) => void }) {
  if (!detail.states.length) return null;
  return (
    <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <span className="label">What they know by the end</span>
      {detail.states.map((s) => {
        const before = new Set(s.before?.knows ?? []);
        const after = s.after?.knows ?? s.before?.knows ?? [];
        return (
          <div key={s.character} className="stack" style={{ gap: 6 }}>
            <button className="row" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }} onClick={() => onOpen(s.character)}>
              <Avatar id={s.character} name={name(s.character)} />
              <strong>{name(s.character)}</strong>
              {s.after?.alive === false && <Badge kind="danger">dies</Badge>}
            </button>
            <div className="knows">
              {after.length ? (
                after.map((f) => (
                  <span key={f} className={`chip ${before.has(f) ? '' : 'new'}`} style={{ '--h': before.has(f) ? 60 : 150 } as React.CSSProperties} title={factLabel(facts, f)}>
                    {!before.has(f) && '+ '}
                    {f}
                  </span>
                ))
              ) : (
                <span className="faint">Nothing yet</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProseReviewDialog({ review, onClose, onDone }: { review: ProseReview; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'inline' | 'side'>('inline');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      wide
      title={review.title}
      onClose={onClose}
      footer={
        <>
          <span className="segmented" style={{ marginRight: 'auto' }}>
            <button aria-pressed={mode === 'inline'} onClick={() => setMode('inline')}>
              Inline
            </button>
            <button aria-pressed={mode === 'side'} onClick={() => setMode('side')}>
              Side by side
            </button>
          </span>
          <Button variant="ghost" onClick={onClose}>
            Reject
          </Button>
          <Button
            variant="primary"
            icon={<Check />}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await review.apply(review.after);
                onDone();
              } finally {
                setBusy(false);
              }
            }}
          >
            Accept
          </Button>
        </>
      }
    >
      {review.summary && <p className="muted" style={{ marginBottom: 16 }}>{review.summary}</p>}
      {mode === 'inline' ? <ProseDiff before={review.before} after={review.after} /> : <ProseSideBySide before={review.before} after={review.after} />}
    </Dialog>
  );
}

export { CardDiff };
