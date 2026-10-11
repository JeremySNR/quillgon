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
  Link2,
  SpellCheck,
  PanelRight,
  MessageSquareText,
} from 'lucide-react';
import { del, post, put, runJob } from '../lib/api';
import { errorMessage, useApp } from '../lib/app';
import { useUnsavedChanges } from '../lib/unsaved';
import { useConfirm } from '../components/confirm';
import { useProseAutosave } from '../hooks/use-prose-autosave';
import { useSceneDetail } from '../hooks/use-scene-detail';
import { useStyleCheck } from '../hooks/use-style-check';
import type { ExtractionResult, Fact, ImpactResult, SceneCard, SceneDetail, StyleReport, StyleViolation } from '../lib/types';
import { factLabel, firstName, keys, loadPref, plural, savePref } from '../lib/util';
import { Avatar, Badge, Button, Chip, Dialog, Empty, Field, ListEditor, StatusBadge, SyncBadge, TagSelect, Working } from '../components/ui';
import { ProseEditor, bannedRegexes, type EditorApi, type StyleMark } from '../components/prose-editor';
import { MicButton, useDictation, useHoldToTalk, type DictationTarget } from '../components/dictate';
import { NotesPanel, NOTE_KIND } from '../components/notes-panel';
import { PredictabilityCheck } from './critique';
import { OBLIGATION_KIND } from './ledger';
import { CardDiff, ProseDiff, ProseSideBySide } from '../components/diff';

type ProseReview = { title: string; before: string; after: string; summary?: string; apply: (text: string) => Promise<void> };

export function SceneEditor({ id }: { id: string }) {
  const { project: p, go, toast, refresh, markSaved, markSaveFailed, fail, focus, setFocus, jobs } = useApp();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ result: ImpactResult; change: any } | null>(null);
  const [review, setReview] = useState<ProseReview | null>(null);
  const [facts, setFacts] = useState<ExtractionResult['diff'] | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [inspector, setInspector] = useState(() => loadPref('sceneInspector', false));
  useEffect(() => { if (p) savePref(`lastScene:${p.dir}`, id); }, [p?.dir, id]);
  const [jump, setJump] = useState<{ from: number; to: number } | null>(null);
  const editorApi = useRef<EditorApi | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Prose autosave. A failure keeps the text, says so (once per streak, and always once the
  // editor has gone), and retries on the next edit.
  const setDetailRef = useRef<(fn: (cur: SceneDetail | null) => SceneDetail | null) => void>(() => undefined);
  const failureShown = useRef(false);
  const prose = useProseAutosave<SceneDetail>({
    docKey: id,
    save: (key, body, { keepalive }) => put<SceneDetail>(`/scenes/${key}/prose`, { body }, { keepalive }),
    onSaved: (d, key) => {
      failureShown.current = false;
      if (key === id && mounted.current) setDetailRef.current((cur) => (cur ? { ...cur, prose: d.prose, sync: d.sync } : cur));
      markSaved();
    },
    onError: (e, key, retry) => {
      const message = errorMessage(e);
      markSaveFailed(`Prose for ${key} not saved: ${message}`);
      const gone = key !== id || !mounted.current;
      if (failureShown.current && !gone) return;
      failureShown.current = true;
      toast({
        kind: 'error',
        message: gone ? `Your last edits to ${key} were not saved` : 'Your latest edits are not saved',
        detail: gone ? message : `${message}. The text is kept here and saving retries when you type.`,
        action: { label: 'Retry', run: () => void retry() },
      });
    },
  });

  const { detail, setDetail, card, setCard, cardDirty, load, accept, discardCard, loadError } = useSceneDetail(id, { refreshKey: p?.scenes, prose });
  setDetailRef.current = setDetail;
  useUnsavedChanges(cardDirty, 'scene card edits');
  // Typing not yet confirmed by the server (waiting, in flight or failed) blocks closing the
  // window; in-app navigation saves it on unmount instead of asking.
  useUnsavedChanges(prose.hasUnsaved, 'scene prose', { inApp: false, flush: prose.flush });

  const styleReport = useStyleCheck(prose.text, p?.style.sheet);
  const styleMarks = useMemo<StyleMark[]>(() => (styleReport?.violations ?? []).filter((v) => v.end > v.start).map((v) => ({ from: v.start, to: v.end, kind: v.kind, message: v.message })), [styleReport]);
  // Life stories: the ghostwriter's margin notes and gap markers, underlined in the text.
  const notes = useMemo(() => detail?.notes ?? [], [detail?.notes]);
  const marks = useMemo<StyleMark[]>(() => {
    if (!p?.life) return styleMarks;
    const text = prose.text;
    const out: StyleMark[] = [...styleMarks];
    for (const n of notes) {
      if (n.status !== 'open' || !n.quote) continue;
      const at = text.indexOf(n.quote);
      if (at >= 0) out.push({ from: at, to: at + n.quote.length, kind: n.kind === 'source' ? 'source' : n.kind === 'gap' ? 'gap' : 'note', message: `${NOTE_KIND[n.kind].label}: ${n.text}` });
    }
    for (const m of text.matchAll(/\[TK:[^\]]*\]/g)) if (!out.some((x) => x.from === m.index)) out.push({ from: m.index!, to: m.index! + m[0].length, kind: 'gap', message: 'A gap the ghostwriter left for you' });
    return out;
  }, [styleMarks, notes, prose.text, p?.life]);
  const [notesOpen, setNotesOpen] = useState(true);
  const jumpTo = (quote: string) => {
    const at = prose.text.indexOf(quote);
    if (at >= 0) setJump({ from: at, to: at + quote.length });
  };
  const banned = useMemo(() => bannedRegexes(p?.style.banned ?? ''), [p?.style.banned]);
  const words = useMemo(() => (prose.text.trim() ? prose.text.trim().split(/\s+/).length : 0), [prose.text]);

  const saveCard = useCallback(async () => {
    if (!card || !cardDirty) return;
    try {
      const r = await put<{ scene: SceneDetail; change: any; impact: ImpactResult }>(`/scenes/${id}/card`, { card });
      accept(r.scene);
      markSaved();
      const others = r.impact.impacts.filter((i) => i.scene !== id && i.hop <= 2);
      if (others.length) setImpact({ result: r.impact, change: r.change });
      else toast({ kind: 'success', message: 'Card saved', detail: r.scene.prose ? 'No other scene is affected.' : undefined });
      refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Card not saved', detail: errorMessage(e) });
    }
  }, [accept, card, cardDirty, id, markSaved, refresh, toast]);

  const flushProse = prose.flush;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveCard();
        void flushProse();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saveCard, flushProse]);

  const dictationOff = !card || card.lock === 'prose' || card.lock === 'both';
  // Dictation goes in at the cursor, as an ordinary edit (autosaved, undoable).
  const dictationTarget = useMemo<DictationTarget>(
    () => ({
      context: () => editorApi.current?.context() ?? { before: '', after: '' },
      insert: (text) => editorApi.current?.insert(text) ?? (() => undefined),
    }),
    [],
  );
  const dictation = useDictation({ target: dictationOff ? null : dictationTarget, scene: id });
  useHoldToTalk(dictation, !dictationOff);

  if (!p) return null;
  if (!detail || !card)
    return (
      <div className="page">
        <div className="page-inner">
          {loadError ? (
            <Empty icon={<AlertTriangle />} title="This scene could not be loaded" actions={<Button icon={<RefreshCw />} onClick={() => void load()}>Try again</Button>}>
              {loadError}
            </Empty>
          ) : (
            <>
              <div className="skeleton" style={{ height: 32, width: 320, marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 420 }} />
            </>
          )}
        </div>
      </div>
    );

  const job = jobs[jobs.length - 1];
  const sync = detail.sync.state;
  const chars = p.characters;
  const name = (cid: string) => firstName(chars, cid);
  const charOpts = chars.map((c) => ({ id: c.id, label: c.bio.name }));
  const factOpts = p.facts.map((f) => ({ id: f.id, label: f.statement.length > 60 ? f.statement.slice(0, 58) + '…' : f.statement }));
  const set = <K extends keyof SceneCard>(k: K, v: SceneCard[K]) => setCard({ ...card, [k]: v });
  const proseLocked = card.lock === 'prose' || card.lock === 'both';

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast({ kind: 'error', message: `${label} failed`, detail: errorMessage(e) });
    } finally {
      setBusy(null);
      void load();
      refresh();
    }
  };
  /** Jobs read the prose from disk: make sure it has what is on screen first. */
  const saveProseFirst = async () => {
    if (!(await prose.flush())) throw new Error('Your latest prose edits could not be saved, so nothing was run');
  };

  const write = () =>
    withBusy('Writing', async () => {
      await saveProseFirst();
      const r = await runJob<{ words: number; contradictions: unknown[] }>(`/scenes/${id}/write`);
      toast({ kind: r.contradictions.length ? 'warning' : 'success', message: `Wrote ${r.words} words`, detail: r.contradictions.length ? 'The prose disagrees with the card in places; see the flags.' : 'Style passes and extraction done.' });
    });

  const regenerate = (mode: 'minimal' | 'fresh') =>
    withBusy(mode === 'fresh' ? 'Rewriting' : 'Revising', async () => {
      await saveProseFirst();
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
      await saveProseFirst();
      const r = await runJob<{ before: string; after: string; report: { voiceFlags: unknown[]; autoFixes: number; enforcedBefore: number; enforcedAfter: number; rounds: { kept: boolean; applied: number; why: string }[] } }>(`/scenes/${id}/style`);
      const kept = r.report.rounds.filter((x) => x.kept);
      setReview({
        title: 'Style passes',
        before: r.before,
        after: r.after,
        summary: [
          r.report.voiceFlags.length && plural(r.report.voiceFlags.length, 'voice fix', 'voice fixes'),
          r.report.autoFixes && `${plural(r.report.autoFixes, 'automatic fix', 'automatic fixes')}`,
          `${plural(kept.reduce((n, x) => n + x.applied, 0), 'line edit')} kept${r.report.rounds.some((x) => !x.kept) ? ` (${r.report.rounds.find((x) => !x.kept)!.why})` : ''}`,
          `style rules broken: ${r.report.enforcedBefore} → ${r.report.enforcedAfter}`,
        ]
          .filter(Boolean)
          .join(' · '),
        apply: async (text) => {
          await runJob(`/scenes/${id}/accept-prose`, { body: text });
        },
      });
    });

  const readBack = () =>
    withBusy('Reading back', async () => {
      await saveProseFirst();
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
    const ok = await confirm({
      title: `Delete ${id}?`,
      message: `“${card.title || 'Untitled scene'}” will be removed. Other scenes that depend on it will be offered a ripple.`,
      confirmLabel: 'Delete scene',
      danger: true,
    });
    if (!ok) return;
    try {
      // The scene is going: nothing typed into it should be saved after this.
      prose.discard();
      const r = await del<{ ripple?: unknown; impact?: ImpactResult }>(`/scenes/${id}?ripple=1`);
      discardCard();
      toast({ kind: 'info', message: `Deleted ${id}` });
      await refresh();
      go(r.ripple ? 'ripple' : 'outline');
    } catch (e) {
      toast({ kind: 'error', message: `Could not delete ${id}`, detail: errorMessage(e) });
    }
  };

  const pov = chars.find((c) => c.id === card.pov);

  return (
    <div className={`editor ${focus ? 'focus' : ''} ${inspector ? 'inspector-open' : ''} ${p.life && notes.length && notesOpen && !focus ? 'notes-open' : ''}`}>
      {/* ---------------- card */}
      <aside className="card-pane" id="scene-inspector" aria-label="Scene card" hidden={!inspector || focus}>
        <div className="inspector-title"><span>Scene details</span><Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Close scene details" onClick={() => { setInspector(false); savePref('sceneInspector', false); }} /></div>
        <div className="card-pane-inner">
          <div className="row">
            <span className="mono faint">{id}</span>
            <StatusBadge status={card.status} lock={card.lock} />
            <span className="grow" />
            <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} tip="Delete scene" onClick={remove} />
          </div>
          <input className="input title" value={card.title} onChange={(e) => set('title', e.target.value)} aria-label="Scene title" placeholder="Untitled scene" />
          {p.life && (
            <>
              <Field label="Then" hint="What you knew and felt at the time.">
                <textarea className="textarea" rows={2} value={card.then ?? ''} onChange={(e) => set('then', e.target.value)} />
              </Field>
              <Field label="Now" hint="What you understand looking back.">
                <textarea className="textarea" rows={2} value={card.now ?? ''} onChange={(e) => set('now', e.target.value)} />
              </Field>
              {(card.stories ?? []).length > 0 && (
                <Field label="From the stories">
                  <div className="row wrap">
                    {(card.stories ?? []).map((sid) => (
                      <Badge key={sid} kind="outline">{p.life!.stories.find((x) => x.id === sid)?.title ?? sid}</Badge>
                    ))}
                  </div>
                </Field>
              )}
            </>
          )}
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

          <LedgerFields card={card} onChange={(k, v) => set(k, v)} />

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
          {card.beats.length > 1 && <PredictabilityCheck scene={id} />}

          {cardDirty && (
            <div className="decision-bar">
              <Button variant="primary" icon={<Check />} kbd={keys('S')} onClick={saveCard}>
                Save card
              </Button>
              <Button variant="ghost" icon={<Undo2 />} onClick={discardCard}>
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
          {styleReport && (
            <button className={`style-chip ${styleReport.enforced ? 'bad' : 'ok'}`} onClick={() => setStyleOpen(!styleOpen)} aria-expanded={styleOpen} title="Checked against your style sheet">
              <SpellCheck size={13} />
              {styleReport.enforced ? `${styleReport.enforced} to fix` : 'Style clean'}
              {styleReport.guided > 0 && <span className="faint">· {styleReport.guided} notes</span>}
            </button>
          )}
          <span className="grow" />
          {!proseLocked && <MicButton dictation={dictation} hint="hold Alt+D" />}
          {detail.prose ? (
            <>
              <Button size="sm" variant="ghost" icon={<ScanText />} onClick={readBack} disabled={!!busy} tip="Extract facts from my edit">
                <span className="btn-text">Read back</span>
              </Button>
              <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={style} disabled={!!busy || proseLocked}>
                Style passes
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => regenerate('minimal')} disabled={!!busy || proseLocked} tip="Change only what the card change needs">
                <span className="btn-text">Revise to card</span>
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" icon={card.status === 'approved' ? <BookOpenCheck /> : <Check />} onClick={approve} disabled={!!busy || card.status === 'locked'}>
            {card.status === 'approved' ? 'Approved' : 'Approve'}
          </Button>
          <Button size="sm" variant="ghost" iconOnly icon={card.lock === 'none' ? <LockOpen /> : <Lock />} tip={card.lock === 'none' ? 'Lock card and prose' : 'Unlock'} onClick={() => setLock(card.lock === 'none' ? 'both' : 'none')} disabled={!!busy} />
          {p.life && notes.length > 0 && (
            <Button size="sm" variant="ghost" icon={<MessageSquareText />} aria-expanded={notesOpen && !focus} onClick={() => setNotesOpen(!notesOpen)}>
              Notes{notes.some((n) => n.status === 'open') ? ` (${notes.filter((n) => n.status === 'open').length})` : ''}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<PanelRight />} aria-expanded={inspector && !focus} aria-controls="scene-inspector" onClick={() => { const next = focus || !inspector; if (focus) setFocus(false); setInspector(next); savePref('sceneInspector', next); }}>Scene details{cardDirty ? ' •' : ''}</Button>
          <Button size="sm" variant="ghost" iconOnly icon={focus ? <Minimize2 /> : <Maximize2 />} tip="Focus mode" kbd={keys('.')} onClick={() => setFocus(!focus)} />
        </div>
        <div className="prose-scroll">
          <div className="prose-column">
            <div className="scene-kicker">{p.structure.acts.flatMap(a => a.chapters).find(c => c.scenes.includes(id))?.title || 'MANUSCRIPT'}<span>SCENE {String(p.scenes.findIndex(s => s.id === id) + 1).padStart(2, '0')}</span></div>
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

            {!detail.prose && !prose.text ? (
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
            {prose.error && (
              <div className="banner danger" role="alert">
                <AlertTriangle />
                <div className="banner-body">
                  <span className="banner-title">Your latest edits are not saved</span>
                  <span>{prose.error}. The text stays here, and saving retries when you type.</span>
                  <div className="btn-row">
                    <Button size="sm" icon={<RefreshCw />} onClick={() => void prose.flush()} disabled={prose.status === 'saving'}>
                      Retry now
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {styleOpen && styleReport && <StylePanel report={styleReport} onJump={(v) => setJump({ from: v.start, to: v.end })} onClose={() => setStyleOpen(false)} onSettings={() => go('settings', 'style')} />}
            <ProseEditor value={prose.text} onChange={prose.edit} banned={banned} readOnly={proseLocked} marks={marks} jump={jump} onReady={(api) => (editorApi.current = api)} placeholder={detail.prose ? undefined : 'Or start writing, or hold Alt+D and talk…'} />
          </div>
        </div>
      </section>
      {p.life && notes.length > 0 && notesOpen && !focus && <NotesPanel scene={id} notes={notes} onJump={jumpTo} onChanged={() => (load(), refresh())} />}

      {impact && (
        <Dialog
          title="This change reaches other scenes"
          onClose={() => setImpact(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setImpact(null)}>
                Not now
              </Button>
              <Button variant="primary" icon={<Waves />} onClick={() => post('/ripple/start', { change: impact.change }).then(() => (setImpact(null), go('ripple')), fail('Could not start the ripple'))}>
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
  const { fail } = useApp();
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
              } catch (e) {
                fail('Could not apply the revision')(e);
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

const RULE: Record<string, string> = {
  never: 'Never list',
  prefer: 'Preferred word',
  banned: 'Banned pattern',
  spelling: 'Spelling',
  'em-dash': 'Em dashes',
  semicolon: 'Semicolons',
  exclamation: 'Exclamation marks',
  quotes: 'Quotation marks',
  'dialogue-tag': 'Dialogue tags',
  'sentence-length': 'Sentence length',
  pov: 'Point of view',
  tense: 'Tense',
  contraction: 'Contractions',
  adverb: 'Adverbs',
  'filter-word': 'Filter words',
  rhythm: 'Rhythm',
  'dialogue-share': 'Dialogue share',
  'paragraph-length': 'Paragraph length',
};

/** Every style-sheet violation in the scene, grouped by rule; click one to jump to it. */
function StylePanel({ report, onJump, onClose, onSettings }: { report: StyleReport; onJump: (v: StyleViolation) => void; onClose: () => void; onSettings: () => void }) {
  const groups = new Map<string, StyleViolation[]>();
  for (const v of report.violations) groups.set(v.rule, [...(groups.get(v.rule) ?? []), v]);
  const ordered = [...groups.entries()].sort((a, b) => Number(b[1][0].kind === 'enforced') - Number(a[1][0].kind === 'enforced'));
  return (
    <div className="style-panel">
      <div className="row">
        <strong className="grow">
          {report.enforced ? `${plural(report.enforced, 'rule')} broken` : 'Every enforced rule holds'}
          {report.guided > 0 && <span className="faint" style={{ fontWeight: 400 }}> · {plural(report.guided, 'softer note')}</span>}
        </strong>
        <Button size="sm" variant="ghost" onClick={onSettings}>
          Style dials
        </Button>
        <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Close" onClick={onClose} />
      </div>
      <div className="style-stats faint">
        {report.stats.sentence_mean} words a sentence · {Math.round(report.stats.dialogue_share * 100)}% dialogue · {report.stats.adverbs_per_1000} adverbs per 1,000
      </div>
      {ordered.map(([rule, vs]) => (
        <div key={rule} className="style-group">
          <div className="row" style={{ gap: 6 }}>
            <span className={`sev ${vs[0].kind === 'enforced' ? 'high' : 'low'}`} />
            <span style={{ fontWeight: 600 }}>{RULE[rule] ?? rule}</span>
            <span className="faint">{vs.length}</span>
          </div>
          <div className="style-hits">
            {vs.slice(0, 12).map((v, i) =>
              v.end > v.start ? (
                <button key={i} className="style-hit" onClick={() => onJump(v)} title={v.message}>
                  {v.text.length > 40 ? v.text.slice(0, 38) + '…' : v.text}
                  {v.fix !== undefined && <span className="faint"> → {v.fix || '∅'}</span>}
                </button>
              ) : (
                <span key={i} className="faint" style={{ fontSize: 'var(--fs-label)' }}>
                  {v.message}
                </span>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** What this scene plants for later and what it pays off, from the obligations ledger. */
function LedgerFields({ card, onChange }: { card: SceneCard; onChange: <K extends 'sets_up' | 'pays_off'>(k: K, v: SceneCard[K]) => void }) {
  const { project: p, go } = useApp();
  if (!p) return null;
  const opts = p.obligations.map((o) => ({ id: o.id, label: `${OBLIGATION_KIND[o.kind]}: ${o.description.length > 50 ? o.description.slice(0, 48) + '…' : o.description}` }));
  const order = p.scenes.map((s) => s.id);
  const here = order.indexOf(card.id);
  const open = p.obligations.filter((o) => o.status !== 'dropped' && o.setup_scene && order.indexOf(o.setup_scene) < here && (!o.payoff_scene || order.indexOf(o.payoff_scene) > here) && !card.pays_off.includes(o.id));
  const issues = p.obligationIssues.filter((i) => i.scene === card.id);
  return (
    <div className="ledger-fields">
      <div className="row">
        <Link2 size={14} className="faint" />
        <span className="grow" style={{ fontWeight: 600, fontSize: 'var(--fs-label)' }}>
          Setups and payoffs
        </span>
        <Button size="sm" variant="ghost" onClick={() => go('threads', 'ledger')}>
          Ledger
        </Button>
      </div>
      <Field label="Plants">
        <TagSelect value={card.sets_up} options={opts} onChange={(v) => onChange('sets_up', v)} placeholder="Add a setup…" />
      </Field>
      <Field label="Pays off">
        <TagSelect value={card.pays_off} options={opts} onChange={(v) => onChange('pays_off', v)} placeholder="Add a payoff…" />
      </Field>
      {open.length > 0 && (
        <div className="faint" style={{ fontSize: 'var(--fs-label)', lineHeight: 1.5 }}>
          Still open here, not to be resolved yet: {open.slice(0, 4).map((o) => o.description).join('; ')}
          {open.length > 4 ? ` and ${open.length - 4} more` : ''}.
        </div>
      )}
      {issues.map((i, k) => (
        <div key={k} className="row" style={{ gap: 6, color: 'var(--warning)', fontSize: 'var(--fs-label)' }}>
          <AlertTriangle size={12} /> {i.message}
        </div>
      ))}
    </div>
  );
}
