import { useCallback, useEffect, useState } from 'react';
import { Check, FilePenLine, Lock, LockOpen, Mic, PenLine, Sparkles, X } from 'lucide-react';
import { get, post, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Chapter } from '../lib/types';
import { cx, plural } from '../lib/util';
import { Badge, Button, Field, Segmented, Working } from '../components/ui';

type Stage = NonNullable<Chapter['stage']>;
interface ChapterRow extends Omit<Chapter, 'stage' | 'stories'> {
  stage: Stage;
  stories: string[];
  open_notes: number;
  words: number;
}
interface Proposal {
  shape: string;
  rationale: string;
  chapters: { id: string; title: string; summary: string; stories: string[] }[];
  left_out: { id: string; why: string }[];
}

const SHAPES: { value: string; label: string; desc: string }[] = [
  { value: 'chronological', label: 'Chronological', desc: 'In the order it was lived' },
  { value: 'thematic', label: 'Thematic', desc: 'A chapter per subject: work, family, faith' },
  { value: 'braided', label: 'Braided', desc: 'Then and now, alternating' },
  { value: 'frame', label: 'Frame', desc: 'Open on a later moment, then go back' },
  { value: 'vignettes', label: 'Vignettes', desc: 'Short pieces, ordered for effect' },
  { value: 'one-season', label: 'One season', desc: 'One period or change; the rest as memory' },
];

const PENS = [
  { value: 'interviewer', label: 'Interviewer', desc: 'You write every word. The ghostwriter asks, files and checks.' },
  { value: 'co-writer', label: 'Co-writer', desc: 'You write, and hand it chapters to draft when you want.' },
  { value: 'ghostwriter', label: 'Ghostwriter', desc: 'It drafts each chapter from your memories; you answer, react and approve.' },
] as const;

const COLUMNS: { stage: Stage; label: string }[] = [
  { stage: 'gathering', label: 'Gathering' },
  { stage: 'ready', label: 'Ready' },
  { stage: 'draft', label: 'Draft' },
  { stage: 'notes', label: 'Your notes' },
  { stage: 'revising', label: 'Revising' },
  { stage: 'approved', label: 'Approved' },
];

/** Shaping the book: what it is about, who holds the pen, the shape, and every chapter on its own cycle. */
export function Shaping() {
  const { project: p, go, job, refresh, fail, toast } = useApp();
  const [rows, setRows] = useState<ChapterRow[] | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [about, setAbout] = useState(p?.intent.premise ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => get<{ chapters: ChapterRow[]; proposal: Proposal | null }>('/life/chapters').then((r) => (setRows(r.chapters), setProposal(r.proposal)), fail('Could not load the chapters')), [fail]);
  const premise = p?.intent.premise ?? '';
  useEffect(() => void load(), [load, p?.structure, p?.life?.stories.length]);
  useEffect(() => setAbout(premise), [premise]);
  if (!p?.life) return null;
  const life = p.book.life;
  const stories = p.life.stories;
  const title = (id: string) => stories.find((s) => s.id === id)?.title ?? id;
  const unplaced = stories.filter((s) => s.status !== 'cut' && !rows?.some((c) => c.stories.includes(s.id)));
  const saveLife = (patch: Partial<typeof life>) => put('/life/settings', { life: patch }).then(refresh, fail('Not saved'));
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch {
      // reported by job()
    } finally {
      setBusy(null);
    }
  };
  const waitingOnYou = rows?.filter((r) => r.stage === 'notes' || r.stage === 'gathering').length ?? 0;

  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <span className="eyebrow">FROM MEMORIES TO A BOOK</span>
            <h1>Shaping the book</h1>
            <p className="sub">Decide what the book is about and how it is told. Each chapter then moves through its own cycle: gathered, drafted, your notes, revised, signed off.</p>
          </div>
        </div>

        <div className="shaping-grid">
          <div className="card stack">
            <div className="card-head">
              <h3 className="grow">What it is really about</h3>
            </div>
            <p className="muted small">Not what happened, but what you came to understand. It decides what goes in and what stays out.</p>
            <textarea className="textarea" rows={3} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="How a girl from a two-up two-down learned she was allowed to want things." aria-label="What the book is about" />
            <div>
              <Button size="sm" icon={<Check />} disabled={about === premise} onClick={() => put('/intent', { intent: { premise: about } }).then(() => (refresh(), toast({ kind: 'success', message: 'Saved' })), fail('Not saved'))}>
                Save
              </Button>
            </div>
          </div>
          <div className="card stack">
            <div className="card-head">
              <PenLine size={16} />
              <h3 className="grow">Who holds the pen?</h3>
            </div>
            <div className="pens" role="radiogroup" aria-label="Who holds the pen">
              {PENS.map((x) => (
                <button key={x.value} type="button" role="radio" aria-checked={life.pen === x.value} className="kind" onClick={() => saveLife({ pen: x.value })}>
                  <span className="kind-name">{x.label}</span>
                  <span className="kind-desc">{x.desc}</span>
                </button>
              ))}
            </div>
            <Field label="Follow-up questions">
              <Segmented value={life.push} options={[{ value: 'gentle', label: 'Gentle' }, { value: 'thorough', label: 'Thorough' }]} onChange={(push) => saveLife({ push })} />
            </Field>
          </div>
        </div>

        <h3 className="section-title">The shape</h3>
        <div className="shapes" role="radiogroup" aria-label="Shape">
          {SHAPES.map((x) => (
            <button key={x.value} type="button" role="radio" aria-checked={(life.shape ?? 'chronological') === x.value} className="kind" onClick={() => saveLife({ shape: x.value as typeof life.shape })}>
              <span className="kind-name">{x.label}</span>
              <span className="kind-desc">{x.desc}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Button icon={<Sparkles />} disabled={!stories.length || !!busy} onClick={() => run('propose', () => job<Proposal>('/life/shape/propose', { shape: life.shape }, 'Proposing chapters').then(setProposal))}>
            {rows?.length ? 'Propose chapters again' : 'Propose chapters'}
          </Button>
          {!stories.length && <span className="muted small">Chapters come from stories. Start with a session.</span>}
        </div>
        {busy === 'propose' && <Working fallback="Reading your stories" />}
        {proposal && (
          <div className="card stack proposal" style={{ marginTop: 12 }}>
            <div className="card-head">
              <h3 className="grow">Proposed: {SHAPES.find((s) => s.value === proposal.shape)?.label ?? proposal.shape}</h3>
              <Button size="sm" variant="ghost" icon={<X />} onClick={() => post('/life/shape/discard').then(() => setProposal(null))}>
                Discard
              </Button>
              <Button size="sm" variant="primary" icon={<Check />} onClick={() => run('accept', () => post('/life/shape/accept').then(refresh))}>
                Use these chapters
              </Button>
            </div>
            <p className="muted">{proposal.rationale}</p>
            <ol className="proposal-chapters">
              {proposal.chapters.map((c) => (
                <li key={c.id}>
                  <strong>{c.title}</strong>
                  {c.summary && <span className="muted"> · {c.summary}</span>}
                  <div className="faint small">{c.stories.map(title).join(' · ') || 'No stories yet'}</div>
                </li>
              ))}
            </ol>
            {proposal.left_out.length > 0 && (
              <p className="faint small">
                Kept, not cut: {proposal.left_out.map((x) => `${title(x.id)} (${x.why})`).join('; ')}
              </p>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 28 }}>
          <h3 className="section-title grow" style={{ margin: 0 }}>
            Chapters
          </h3>
          {waitingOnYou > 0 && <Badge kind="warning">{plural(waitingOnYou, 'chapter')} waiting on you</Badge>}
        </div>
        {!rows ? (
          <Working fallback="Loading chapters" />
        ) : rows.length === 0 ? (
          <p className="muted">No chapters yet. Propose some from your stories, or add them in the manuscript.</p>
        ) : (
          <div className="track" role="table" aria-label="Chapters and their stages">
            <div className="trow head" role="row">
              <div role="columnheader">Chapter</div>
              {COLUMNS.map((c) => (
                <div key={c.stage} role="columnheader">
                  {c.label}
                </div>
              ))}
            </div>
            {rows.map((r, i) => {
              const at = COLUMNS.findIndex((c) => c.stage === r.stage);
              return (
                <div className="trow" role="row" key={r.id}>
                  <div className="c1" role="cell">
                    <span className="serif">
                      {i + 1} · {r.title || r.id}
                    </span>
                    <small>
                      {plural(r.stories.length, 'story', 'stories')}
                      {r.words ? ` · ${r.words.toLocaleString('en')} words` : ''}
                      {r.round ? ` · draft ${r.round}` : ''}
                      {life.voice_sample === r.id ? ' · sets the voice' : ''}
                    </small>
                  </div>
                  {COLUMNS.map((c, k) => (
                    <div key={c.stage} role="cell" className={cx('cell', k < at && 'past')}>
                      {k === at && <ChapterToken row={r} pen={life.pen} busy={busy === r.id} onRun={(fn) => run(r.id, fn)} go={go} job={job} refresh={refresh} />}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {unplaced.length > 0 && rows && rows.length > 0 && (
          <>
            <h3 className="section-title">Stories not in a chapter</h3>
            <ul className="question-list">
              {unplaced.map((s) => (
                <li key={s.id}>
                  <div className="grow">
                    <div className="serif">{s.title}</div>
                    <div className="faint small">{[s.when, s.summary].filter(Boolean).join(' · ')}</div>
                  </div>
                  <select className="select" aria-label={`Chapter for ${s.title}`} value="" onChange={(e) => post(`/life/stories/${s.id}/assign`, { chapter: e.target.value }).then(() => (load(), refresh()), fail('Could not move the story'))}>
                    <option value="">Put in a chapter…</option>
                    {rows.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title || c.id}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function ChapterToken({ row, pen, busy, onRun, go, job, refresh }: { row: ChapterRow; pen: string; busy: boolean; onRun: (fn: () => Promise<unknown>) => void; go: (v: any, id?: string) => void; job: <T>(path: string, body?: unknown, label?: string) => Promise<T>; refresh: () => Promise<void> }) {
  const draft = () => onRun(() => job(`/life/chapters/${row.id}/draft`, {}, 'Drafting the chapter').then(refresh));
  const open = () => row.scenes[0] && go('scene', row.scenes[0]);
  const canDraft = pen !== 'interviewer' && row.stories.length > 0;
  if (busy) return <span className="tok gw">Working…</span>;
  switch (row.stage) {
    case 'gathering':
      return (
        <span className="tok you">
          <b>{row.stories.length ? 'Needs more' : 'No stories yet'}</b>
          <span className="tok-actions">
            <button className="link small" onClick={() => go('sessions')}>
              <Mic size={11} /> Talk about it
            </button>
            {canDraft && (
              <button className="link small" onClick={draft}>
                Draft anyway
              </button>
            )}
          </span>
        </span>
      );
    case 'ready':
      return (
        <span className="tok gw">
          <b>Ready to draft</b>
          {canDraft ? (
            <button className="link small" onClick={draft}>
              <FilePenLine size={11} /> Draft it
            </button>
          ) : (
            <button className="link small" onClick={() => go('outline')}>
              <PenLine size={11} /> You write it
            </button>
          )}
        </span>
      );
    case 'draft':
      return (
        <span className="tok gw">
          <b>Drafting</b>
          <button className="link small" onClick={open}>
            Open
          </button>
        </span>
      );
    case 'revising':
      return (
        <span className="tok you">
          <b>Changes to review</b>
          <button className="link small" onClick={() => go('revision', row.id)}>
            Review
          </button>
        </span>
      );
    case 'notes':
      return (
        <span className="tok you">
          <b>{row.open_notes ? plural(row.open_notes, 'question') : 'Read it'}</b>
          <span className="tok-actions">
            <button className="link small" onClick={open}>
              Open draft
            </button>
            <button className="link small" onClick={() => onRun(() => post(`/life/chapters/${row.id}/approve`).then(refresh))}>
              <Lock size={11} /> Approve
            </button>
          </span>
        </span>
      );
    case 'approved':
      return (
        <span className="tok ok">
          <b>Signed off</b>
          <button className="link small" onClick={() => onRun(() => post(`/life/chapters/${row.id}/reopen`).then(refresh))}>
            <LockOpen size={11} /> Reopen
          </button>
        </span>
      );
  }
}
