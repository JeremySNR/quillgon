import { useEffect, useState } from 'react';
import { ArrowRight, Check, MessageCircleQuestion, Pin, Plus, RefreshCw, Sparkles, Wand2, X, PenLine, Telescope, Shuffle, Layers, BookText, Pencil, ScanSearch, Link2 } from 'lucide-react';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app';
import type { CardsOutput, CritiqueOutput, Intent, InterviewState, StructureOutput } from '../lib/types';
import { plural } from '../lib/util';
import { Badge, Button, Empty, Field, ListEditor, Working, Avatar } from '../components/ui';
import { Stepper, STAGES } from './dashboard';
import { IdeaStep } from './spark';
import { FindingList } from './critique';

interface PipelineState {
  stage: string;
  interview: InterviewState | null;
  structures: StructureOutput | null;
  structureCritiques: CritiqueOutput[] | null;
  cast: { id: string; name: string; role: string }[] | null;
  cards: Record<string, CardsOutput>;
}

export function Build({ step }: { step?: string }) {
  const { project: p, go, jobs } = useApp();
  const [state, setState] = useState<PipelineState | null>(null);
  const load = () => get<PipelineState>('/pipeline').then(setState);
  useEffect(() => {
    load();
  }, [p?.book.stage, p?.plotPoints.length, p?.structure]);
  if (!p) return null;
  const stage = p.book.stage;
  const at = STAGES.findIndex((s) => s.id === stage);
  const current = step && STAGES.findIndex((s) => s.id === step) <= at ? step : stage;
  const job = jobs[jobs.length - 1];
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Build</h1>
            <p className="sub">Seven steps, top down. Each choice is cheap to make here and expensive to make later, so the decisions come first and the prose comes last.</p>
          </div>
        </div>
        <Stepper stage={stage} current={current} onPick={(id) => go('build', id)} />
        {current === 'idea' && <IdeaStep job={job} />}
        {current === 'intent' && <IntentStep state={state} reload={load} job={job} />}
        {current === 'plot-points' && <PlotPointsStep reload={load} job={job} />}
        {current === 'structure' && <StructureStep state={state} reload={load} job={job} />}
        {current === 'cards' && <CardsStep state={state} reload={load} job={job} />}
        {current === 'prose' && <ProseStep job={job} />}
        {current === 'complete' && <ReviewStep />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 1. intent

function IntentStep({ state, reload, job }: { state: PipelineState | null; reload: () => void; job: any }) {
  const { project: p, job: run, refresh, toast, go } = useApp();
  const iv = state?.interview;
  const [premise, setPremise] = useState(p!.intent.premise || iv?.premise || '');
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (iv?.intent) setDraft({ ...p!.intent, ...iv.intent } as Intent);
    else if (p!.intent.approved) setDraft(p!.intent);
  }, [iv]);
  useEffect(() => {
    if (iv?.questions) setAnswers((a) => iv.questions.map((_, i) => a[i] ?? ''));
  }, [iv?.questions]);

  const ask = async (withAnswers: boolean) => {
    setBusy(true);
    try {
      const r = await run<InterviewState>('/pipeline/interview', { premise, answers: withAnswers ? iv!.questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' })) : [] }, 'Interview');
      if (r.intent) setDraft({ ...p!.intent, ...r.intent } as Intent);
      reload();
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    await post('/pipeline/approve-intent', { intent: draft });
    toast({ kind: 'success', message: 'Intent approved', detail: 'Every agent reads it, and its hard rules, on every call.' });
    await refresh();
    go('build', 'plot-points');
  };

  return (
    <div className="stack lg">
      <div className="card">
        <div className="card-head">
          <h3>What is your book?</h3>
        </div>
        <Field label="Premise" hint="A paragraph is plenty. Name the people and the central question.">
          <textarea className="textarea prose" rows={5} value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="Cornwall, 1926. Mara Penrose comes home to bury her father, the harbourmaster, who drowned on a flat-calm night. His tide ledger records a storm that never came…" />
        </Field>
        {!iv?.questions.length && !draft && (
          <div className="btn-row" style={{ marginTop: 16 }}>
            <Button variant="primary" icon={<MessageCircleQuestion />} onClick={() => ask(false)} disabled={!premise.trim() || busy}>
              Ask me what you need to know
            </Button>
          </div>
        )}
      </div>
      {busy && <Working job={job} fallback="Thinking about what to ask" />}
      {iv?.questions.length && !draft ? (
        <div className="card">
          <div className="card-head">
            <h3>A few questions</h3>
            <span className="muted">Only what can’t be inferred from your premise.</span>
          </div>
          <div className="stack lg">
            {iv.questions.map((q, i) => (
              <Field key={i} label={<span style={{ color: 'var(--text)', fontSize: 14 }}>{q}</span>}>
                <textarea className="textarea" rows={2} value={answers[i] ?? ''} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
              </Field>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <Button variant="primary" icon={<Sparkles />} onClick={() => ask(true)} disabled={busy}>
              Draft the intent
            </Button>
          </div>
        </div>
      ) : null}
      {draft && (
        <div className="card">
          <div className="card-head">
            <h3>Intent</h3>
            {p!.intent.approved && <Badge kind="success" icon={<Check />}>Approved</Badge>}
          </div>
          <div className="stack lg">
            <Field label="Premise">
              <textarea className="textarea prose" rows={4} value={draft.premise} onChange={(e) => setDraft({ ...draft, premise: e.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="Tone">
                <textarea className="textarea" rows={2} value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value })} />
              </Field>
              <Field label="Ending">
                <textarea className="textarea" rows={2} value={draft.ending_type} onChange={(e) => setDraft({ ...draft, ending_type: e.target.value })} />
              </Field>
            </div>
            <Field label="Themes">
              <ListEditor items={draft.themes} onChange={(themes) => setDraft({ ...draft, themes })} numbered={false} placeholder="Add theme" />
            </Field>
            <Field label="Hard rules" hint="Things the book must never do. Every agent sees these on every call.">
              <ListEditor items={draft.hard_rules} onChange={(hard_rules) => setDraft({ ...draft, hard_rules })} numbered={false} placeholder="Add rule" />
            </Field>
          </div>
          <div className="btn-row" style={{ marginTop: 20 }}>
            <Button variant="primary" icon={<Check />} onClick={approve}>
              {p!.intent.approved ? 'Save intent' : 'Approve and continue'}
            </Button>
            {!p!.intent.approved && (
              <Button variant="ghost" icon={<RefreshCw />} onClick={() => setDraft(null)}>
                Start over
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 2. plot points

function PlotPointsStep({ reload, job }: { reload: () => void; job: any }) {
  const { project: p, job: run, refresh, go, toast } = useApp();
  const [desc, setDesc] = useState('');
  const [act, setAct] = useState(1);
  const [busy, setBusy] = useState(false);
  const pinned = p!.plotPoints.filter((x) => !x.proposed);
  const proposed = p!.plotPoints.filter((x) => x.proposed);
  const pin = async () => {
    if (!desc.trim()) return;
    await post('/pipeline/pin-plot-point', { plotPoint: { description: desc, position: { act } } });
    setDesc('');
    refresh();
  };
  const propose = async () => {
    setBusy(true);
    try {
      const r = await run<{ created: string[]; needs_decision: string[] }>('/pipeline/propose-plot-points', {}, 'Plot points');
      if (r.needs_decision.length) toast({ kind: 'info', message: 'The planner has questions', detail: r.needs_decision.join(' ') });
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    await post('/pipeline/finish-plot-points');
    await refresh();
    reload();
    go('build', 'structure');
  };
  const byAct = (list: typeof pinned) => [...list].sort((a, b) => (a.position.act ?? 9) - (b.position.act ?? 9));
  return (
    <div className="stack lg">
      <div className="card">
        <div className="card-head">
          <h3>Pin what must happen</h3>
          <span className="muted">Fixed events. The planner builds around them and never moves them.</span>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Event">
            <input className="input" style={{ width: 520, maxWidth: '100%' }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Jory confesses he wrote the storm into the ledger" onKeyDown={(e) => e.key === 'Enter' && pin()} />
          </Field>
          <Field label="Act">
            <select className="select" value={act} onChange={(e) => setAct(Number(e.target.value))} style={{ width: 90 }}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Button icon={<Pin />} onClick={pin} disabled={!desc.trim()}>
            Pin
          </Button>
        </div>
        {pinned.length > 0 && (
          <div className="list" style={{ marginTop: 16 }}>
            {byAct(pinned).map((pp) => (
              <div key={pp.id} className="list-item" style={{ cursor: 'default' }}>
                <Badge kind={pp.locked ? 'accent' : 'outline'}>Act {pp.position.act ?? '?'}</Badge>
                <span className="grow">
                  <div className="primary-text" style={{ fontWeight: 400, whiteSpace: 'normal' }}>{pp.description}</div>
                </span>
                {pp.locked && <Pin size={14} className="faint" />}
              </div>
            ))}
          </div>
        )}
      </div>
      {busy && <Working job={job} fallback="Proposing turning points" />}
      {proposed.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <h3>Proposed turning points</h3>
            <span className="muted">Accept, edit or reject each one.</span>
          </div>
          <div className="stack">
            {byAct(proposed).map((pp) => (
              <ProposedPoint key={pp.id} pp={pp} />
            ))}
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <Button variant="primary" icon={<Sparkles />} onClick={propose} disabled={busy}>
            {pinned.length ? 'Propose the turning points between these' : 'Propose turning points'}
          </Button>
        </div>
      )}
      {pinned.length > 0 && !proposed.length && (
        <div className="btn-row">
          <Button variant="primary" icon={<ArrowRight />} onClick={finish}>
            Continue to structure
          </Button>
          <Button variant="ghost" icon={<Sparkles />} onClick={propose} disabled={busy}>
            Propose more
          </Button>
        </div>
      )}
    </div>
  );
}

function ProposedPoint({ pp }: { pp: { id: string; title: string; description: string; position: { act?: number } } }) {
  const { refresh } = useApp();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(pp.description);
  return (
    <div className="row" style={{ alignItems: 'flex-start', padding: '10px 4px', borderBottom: '1px solid var(--border)' }}>
      <Badge kind="outline">Act {pp.position.act ?? '?'}</Badge>
      <div className="grow">
        {pp.title && <div style={{ fontWeight: 600 }}>{pp.title}</div>}
        {edit ? <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} rows={2} /> : <div className="muted" style={{ lineHeight: 1.5 }}>{pp.description}</div>}
      </div>
      <Button size="sm" variant="success" icon={<Check />} onClick={() => post('/pipeline/accept-plot-point', { id: pp.id, edits: edit ? { description: text } : {} }).then(refresh)}>
        Accept
      </Button>
      {!edit && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} tip="Edit" onClick={() => setEdit(true)} />}
      <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Reject" onClick={() => post('/pipeline/reject-plot-point', { id: pp.id }).then(refresh)} />
    </div>
  );
}

// ------------------------------------------------------------------ 3. structure

function StructureStep({ state, reload, job }: { state: PipelineState | null; reload: () => void; job: any }) {
  const { project: p, job: run, refresh, go, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const alts = state?.structures?.alternatives ?? [];
  const critiques = state?.structureCritiques ?? null;
  const [judging, setJudging] = useState(false);
  const critique = async () => {
    setJudging(true);
    try {
      await run('/pipeline/critique-structures', {}, 'Critique');
      reload();
    } finally {
      setJudging(false);
    }
  };
  const propose = async (more = false) => {
    setBusy(true);
    try {
      await run('/pipeline/propose-structures', { more }, 'Structures');
      reload();
    } finally {
      setBusy(false);
    }
  };
  const pick = async (i: number) => {
    await post('/pipeline/pick-structure', { index: i });
    toast({ kind: 'success', message: `Structure chosen: ${alts[i].label}` });
    await refresh();
    reload();
    go('build', 'cards');
  };
  if (p!.structure.acts.length && !alts.length)
    return (
      <div className="card">
        <div className="card-head">
          <h3>Structure chosen</h3>
        </div>
        <p className="muted" style={{ marginBottom: 12 }}>
          {plural(p!.structure.acts.length, 'act')}, {plural(p!.structure.acts.flatMap((a) => a.chapters).length, 'chapter')}. Change the order of scenes in the outline at any time.
        </p>
        <Button icon={<Layers />} onClick={() => go('outline')}>
          Open the outline
        </Button>
      </div>
    );
  return (
    <div className="stack lg">
      {!alts.length && !busy && (
        <Empty icon={<Shuffle />} title="Three different books" actions={<Button variant="primary" icon={<Sparkles />} onClick={() => propose()}>Propose three structures</Button>}>
          One shaped the way most readers would expect, one that breaks an expectation, and one wild card. You’re choosing between genuinely different books, not three versions of the same one.
        </Empty>
      )}
      {busy && <Working job={job} fallback="Planning three structures" />}
      {judging && <Working job={job} fallback="A critic reads each structure for the shapes AI plots fall into" />}
      {alts.length > 0 && (
        <>
          <div className="alts">
            {alts.map((a, i) => (
              <article className="alt" key={i}>
                <div className="row">
                  <Badge kind={a.kind === 'obvious' ? 'outline' : a.kind === 'unexpected' ? 'accent' : 'info'}>{a.kind === 'obvious' ? 'Expected' : a.kind === 'unexpected' ? 'Breaks an expectation' : 'Wild card'}</Badge>
                </div>
                <h3>{a.label}</h3>
                <p className="rationale">{a.rationale}</p>
                <div className="acts">
                  {a.acts.map((act) => (
                    <div key={act.id}>
                      <div className="act-name">{act.title}</div>
                      <div className="chapters">{act.chapters.map((c) => c.title).join(' · ')}</div>
                    </div>
                  ))}
                </div>
                <div className="row wrap">
                  {a.characters.slice(0, 6).map((c) => (
                    <span key={c.bio.id} className="row" style={{ gap: 6, marginRight: 8 }}>
                      <Avatar id={c.bio.id} name={c.bio.name} />
                      <span className="faint" style={{ fontSize: 'var(--fs-label)' }}>{c.bio.name.split(' ')[0]}</span>
                    </span>
                  ))}
                </div>
                {critiques?.[i] && (
                  <div className="alt-critique">
                    <FindingList findings={critiques[i].findings} empty="No structural tells found." />
                  </div>
                )}
                <Button className="pick" variant="primary" icon={<Check />} onClick={() => pick(i)}>
                  Pick this one
                </Button>
              </article>
            ))}
          </div>
          <div className="btn-row">
            <Button icon={<ScanSearch />} onClick={critique} disabled={busy || judging}>
              {critiques ? 'Critique again' : 'Critique them first'}
            </Button>
            <Button variant="ghost" icon={<RefreshCw />} onClick={() => propose(true)} disabled={busy || judging}>
              Show me more alternatives
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 4. cards

function CardsStep({ state, reload, job }: { state: PipelineState | null; reload: () => void; job: any }) {
  const { project: p, job: run, refresh, go, toast } = useApp();
  const chapters = p!.structure.acts.flatMap((a) => a.chapters.map((c) => ({ ...c, act: a.title })));
  const first = chapters.find((c) => !c.scenes.length)?.id ?? chapters[0]?.id;
  const [sel, setSel] = useState(first);
  const [busy, setBusy] = useState(false);
  const ch = chapters.find((c) => c.id === sel);
  const alts = sel ? state?.cards[sel]?.alternatives : undefined;
  const propose = async () => {
    setBusy(true);
    try {
      await run('/pipeline/propose-cards', { chapter: sel }, 'Scene cards');
      reload();
    } finally {
      setBusy(false);
    }
  };
  const pick = async (i: number) => {
    await post('/pipeline/pick-cards', { chapter: sel, index: i });
    await refresh();
    reload();
    const next = chapters.find((c) => c.id !== sel && !c.scenes.length);
    if (next) setSel(next.id);
    else (toast({ kind: 'success', message: 'Every chapter has scene cards' }), go('build', 'prose'));
  };
  const defaults = async () => {
    setBusy(true);
    try {
      await run('/pipeline/default-cards', {}, 'Scene cards');
      await refresh();
      go('build', 'prose');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, alignItems: 'start' }}>
      <div className="card tight" style={{ position: 'sticky', top: 0 }}>
        <div className="list">
          {chapters.map((c) => (
            <button key={c.id} className="list-item" onClick={() => setSel(c.id)} style={sel === c.id ? { background: 'var(--accent-subtle)' } : undefined}>
              {c.scenes.length ? <Check size={14} style={{ color: 'var(--success)' }} /> : <BookText size={14} className="faint" />}
              <span className="grow">
                <div className="primary-text">{c.title || c.id}</div>
                <div className="secondary-text">{c.scenes.length ? plural(c.scenes.length, 'scene') : c.act}</div>
              </span>
            </button>
          ))}
        </div>
        {chapters.some((c) => !c.scenes.length) && (
          <Button variant="ghost" size="sm" style={{ width: '100%', marginTop: 8 }} onClick={defaults} disabled={busy} title="Take the first alternative for every chapter still without cards">
            Use defaults for the rest
          </Button>
        )}
      </div>
      <div className="stack lg">
        {ch && (
          <div>
            <h2 className="serif" style={{ fontSize: 'var(--fs-title-m)', marginBottom: 6 }}>{ch.title}</h2>
            <p className="muted" style={{ lineHeight: 1.55, maxWidth: '70ch' }}>{ch.summary}</p>
          </div>
        )}
        {ch && ch.scenes.length > 0 && !alts && (
          <div className="card">
            <div className="list">
              {ch.scenes.map((id) => {
                const s = p!.scenes.find((x) => x.id === id);
                return s ? (
                  <button key={id} className="list-item" onClick={() => go('scene', id)}>
                    <span className="mono faint">{id}</span>
                    <span className="grow">
                      <div className="primary-text">{s.card.title}</div>
                      <div className="secondary-text">{s.card.beats.join(' → ')}</div>
                    </span>
                  </button>
                ) : null;
              })}
            </div>
            <Button variant="ghost" size="sm" icon={<RefreshCw />} onClick={propose} disabled={busy} style={{ marginTop: 8 }}>
              Propose new alternatives
            </Button>
          </div>
        )}
        {busy && <Working job={job} fallback="Planning beat sequences" />}
        {ch && !ch.scenes.length && !alts && !busy && (
          <Empty icon={<BookText />} title="Two ways to tell this chapter" actions={<Button variant="primary" icon={<Sparkles />} onClick={propose}>Propose two beat sequences</Button>}>
            One expected, one that does something different with the same material.
          </Empty>
        )}
        {alts && (
          <div className="alts">
            {alts.map((a, i) => (
              <article className="alt" key={i}>
                <Badge kind={a.kind === 'obvious' ? 'outline' : 'accent'}>{a.kind === 'obvious' ? 'Expected' : 'Breaks an expectation'}</Badge>
                <h3>{a.label}</h3>
                <p className="rationale">{a.rationale}</p>
                {a.cards.map((c) => (
                  <div key={c.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <Avatar id={c.pov} name={p!.characters.find((x) => x.id === c.pov)?.bio.name ?? c.pov} />
                      <strong>{c.title}</strong>
                    </div>
                    <ol className="beat-list">
                      {c.beats.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ol>
                  </div>
                ))}
                {a.new_obligations.length > 0 && (
                  <div className="alt-critique">
                    <div className="faint" style={{ fontSize: 'var(--fs-label)', marginBottom: 4 }}>Plants for later</div>
                    {a.new_obligations.map((o) => (
                      <div key={o.id} className="row" style={{ gap: 6, fontSize: 'var(--fs-label)' }}>
                        <Link2 size={12} className="faint" /> {o.description}
                      </div>
                    ))}
                  </div>
                )}
                <Button className="pick" variant="primary" icon={<Check />} onClick={() => pick(i)}>
                  Pick this one
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 5. prose

function ProseStep({ job }: { job: any }) {
  const { project: p, job: run, go, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const chapters = p!.structure.acts.flatMap((a) => a.chapters);
  const sceneById = new Map(p!.scenes.map((s) => [s.id, s]));
  const unwritten = p!.scenes.filter((s) => s.sync === 'unwritten');
  const write = async (chapter?: string) => {
    setBusy(chapter ?? 'all');
    try {
      const r = await run<{ scene: string; words: number }[]>(chapter ? '/pipeline/write-chapter' : '/pipeline/write-all', chapter ? { chapter } : {}, 'Writing');
      toast({ kind: 'success', message: `Wrote ${plural(r.length, 'scene')}`, detail: `${r.reduce((n, x) => n + x.words, 0).toLocaleString('en')} words, with style passes and extraction.` });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="stack lg">
      <div className="card">
        <div className="card-head">
          <h3>Write the scenes</h3>
          <span className="muted">
            Each scene: writer → voice check → banned patterns → humaniser → read back into the story. About {p!.estimate.total_usd ? `$${p!.estimate.total_usd.toFixed(2)}` : 'nothing'} for what’s left.
          </span>
        </div>
        <div className="btn-row">
          <Button variant="primary" icon={<Wand2 />} onClick={() => write()} disabled={!!busy || !unwritten.length}>
            {unwritten.length ? `Write all ${plural(unwritten.length, 'remaining scene')}` : 'Everything is written'}
          </Button>
          {!unwritten.length && (
            <Button icon={<Telescope />} onClick={() => go('build', 'complete')}>
              Continue to review
            </Button>
          )}
        </div>
      </div>
      {busy && <Working job={job} fallback="Writing" />}
      {chapters.map((c) => {
        const done = c.scenes.filter((s) => sceneById.get(s)?.sync !== 'unwritten').length;
        return (
          <div className="card tight" key={c.id}>
            <div className="row">
              <strong>{c.title || c.id}</strong>
              <span className="faint">
                {done}/{c.scenes.length} written
              </span>
              <span className="grow" />
              <div className="bar" style={{ width: 120 }}>
                <span style={{ width: `${(done / Math.max(1, c.scenes.length)) * 100}%`, background: 'var(--success)' }} />
              </div>
              <Button size="sm" icon={<PenLine />} onClick={() => write(c.id)} disabled={!!busy || done === c.scenes.length}>
                Write chapter
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewStep() {
  const { project: p, go, job: run, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    try {
      await run('/quality/reader', {}, 'Reader run');
      toast({ kind: 'success', message: 'Reader run complete' });
      go('reader');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Empty
      icon={<Telescope />}
      title={p!.reader ? 'Read it again' : 'Read it like a stranger would'}
      actions={
        <>
          <Button variant="primary" icon={<Telescope />} onClick={read} disabled={busy}>
            Run the first reader
          </Button>
          <Button icon={<Plus />} onClick={() => run('/quality/continuity', {}, 'Continuity').then(() => toast({ kind: 'success', message: 'Continuity checked' }))}>
            Check continuity
          </Button>
        </>
      }
    >
      A simulated reader reads one scene at a time with no notes and nothing ahead. It logs what it believes, what confuses it, how engaged it is, and what it predicts. A twist it calls early is the most useful thing it can tell you.
    </Empty>
  );
}
