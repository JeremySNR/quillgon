import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, Check, CircleCheck, CircleHelp, ExternalLink, FileText, Library, MessageCircleQuestion, Play, ScrollText, Trash2, Upload, X } from 'lucide-react';
import { del, get, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { CompTitle, Evidence, ResearchGap, ResearchRun, ResearchView as Data } from '../lib/types';
import { ago, cx, plural } from '../lib/util';
import { Badge, Button, Empty, Field, Segmented, Working } from '../components/ui';
import { fieldTarget, MicButton, useDictation } from '../components/dictate';

type Tab = 'shelf' | 'evidence' | 'questions' | 'material' | 'runs';

const CHECK: Record<Evidence['check'], { label: string; kind: 'success' | 'warning' | 'danger' | 'outline' }> = {
  found: { label: 'Quote found on the page', kind: 'success' },
  unreachable: { label: 'Page could not be read', kind: 'warning' },
  'not-found': { label: 'Quote not on the page', kind: 'danger' },
  unchecked: { label: 'Not checked', kind: 'outline' },
};

const GAP_KIND: Record<ResearchGap['kind'], string> = { 'reader-question': 'Readers ask', uncovered: 'Not covered', disagreement: 'Books disagree', check: 'To check' };

/**
 * Research for any book: the books already on its shelf and what readers say about them, the
 * questions readers ask, and facts with the exact words that support them, each quote checked
 * against its page. Research sharpens the author's questions and backs their claims; it never
 * replaces what they know.
 */
export function ResearchView() {
  const { project: p, job, fail, refresh } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>('shelf');
  const load = useCallback(() => get<Data>('/research').then(setData, fail('Could not load research')), [fail]);
  useEffect(() => void load(), [load]);
  if (!p) return null;
  if (!data) return <div className="page"><div className="page-inner"><Working fallback="Opening the library" /></div></div>;
  const lib = data.library;
  const live = (x: { status: string }) => x.status !== 'dismissed';
  const apply = (next: Data) => (setData(next), refresh());
  const guide = p.book.kind === 'guide';
  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <h1>Research</h1>
            <p className="sub">{guide ? 'The books already on your shelf, what your readers keep asking, and facts with their sources. Research sharpens the questions your ghostwriter asks you; it never replaces what you know.' : 'Books like yours, what readers say about them, and facts with their sources, each quote checked against its page.'}</p>
          </div>
        </div>

        <RunCard data={data} onDone={() => (load(), refresh())} run={(body) => job<ResearchRun>('/research/run', body, 'Researching')} />

        <div className="research-tabs">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'shelf', label: `The shelf (${lib.comps.filter(live).length})` },
              { value: 'evidence', label: `Evidence (${lib.evidence.filter(live).length})` },
              { value: 'questions', label: `Questions (${lib.gaps.filter((g) => g.status === 'open').length})` },
              { value: 'material', label: `Your material (${lib.sources.filter((s) => s.kind === 'upload').length})` },
              { value: 'runs', label: 'Runs' },
            ]}
          />
        </div>
        {tab === 'shelf' && <Shelf data={data} onChange={apply} />}
        {tab === 'evidence' && <EvidenceList data={data} onChange={apply} />}
        {tab === 'questions' && <Questions data={data} onChange={apply} canAsk={!!p.life} />}
        {tab === 'material' && <Material data={data} onChange={() => (load(), refresh())} />}
        {tab === 'runs' && <Runs data={data} />}
      </div>
    </div>
  );
}

function RunCard({ data, run, onDone }: { data: Data; run: (body: { brief: string; depth: 'quick' | 'deep' }) => Promise<ResearchRun>; onDone: () => void }) {
  const { toast } = useApp();
  const [brief, setBrief] = useState(data.library.brief);
  const [depth, setDepth] = useState<'quick' | 'deep'>('quick');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const dictation = useDictation({ target: useMemo(() => fieldTarget(() => ref.current, () => briefRef.current, setBrief), []), long: true });
  const est = data.estimate[depth];
  const go = async () => {
    setBusy(true);
    try {
      const r = await run({ brief, depth });
      toast({ kind: r.status === 'done' ? 'success' : 'warning', message: r.status === 'done' ? 'Research done' : `Research ${r.status}`, detail: `${plural(r.found.comps, 'book')}, ${plural(r.found.evidence, 'fact')}, ${plural(r.found.gaps, 'question')}${r.cost_usd ? ` · $${r.cost_usd}` : ''}` });
      onDone();
    } catch {
      // reported by job()
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack research-run">
      <Field label="What should research look into?" hint="The topic, the reader, anything you want checked. Leave it empty to research the book as it stands.">
        <textarea ref={ref} className="textarea" rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Follow-up in B2B sales: what other books teach, what new reps struggle with, and any figures on how many calls it takes…" aria-label="What to research" />
      </Field>
      {!data.can.ok && (
        <div className="banner info">
          <CircleHelp />
          <div className="banner-body">
            <span>{data.can.reason}</span>
          </div>
        </div>
      )}
      <div className="row wrap">
        <Segmented<'quick' | 'deep'> value={depth} onChange={setDepth} options={[{ value: 'quick', label: 'Quick' }, { value: 'deep', label: 'Deep' }]} />
        <span className="muted small grow">{data.can.ok ? `About ${est.searches} searches and ${est.comps} books${est.subscription ? ', on your subscription' : est.cost_usd ? `, roughly $${est.cost_usd}` : ''} · ${est.model}` : 'Reads only your own material'}</span>
        <MicButton dictation={dictation} label="Talk" compact />
        <Button variant="primary" icon={<Play />} disabled={busy} onClick={go}>
          {busy ? 'Researching…' : 'Research'}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the shelf

function Shelf({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const { fail } = useApp();
  const lib = data.library;
  const [positioning, setPositioning] = useState(lib.positioning);
  const [showDismissed, setShowDismissed] = useState(false);
  const comps = lib.comps.filter((c) => showDismissed || c.status !== 'dismissed');
  const sources = new Map(lib.sources.map((s) => [s.id, s]));
  const set = (id: string, patch: Partial<Pick<CompTitle, 'status' | 'difference' | 'shelf'>>) => put<Data>(`/research/comps/${id}`, patch).then(onChange, fail('Not saved'));
  if (!lib.comps.length && !lib.positioning)
    return (
      <Empty icon={<Library />} title="No books on the shelf yet">
        Run research to find the books already written for your reader: what they promise, how they are built, and what their readers wish they did better.
      </Empty>
    );
  return (
    <div className="stack lg">
      <div className="card stack">
        <h3>Where your book sits</h3>
        <textarea className="textarea serif" rows={3} value={positioning} onChange={(e) => setPositioning(e.target.value)} placeholder="Research writes a first version from the shelf. Make it yours: who it is for, and what it does that the others do not." aria-label="Positioning" />
        {positioning !== lib.positioning && (
          <div className="btn-row">
            <Button size="sm" variant="primary" icon={<Check />} onClick={() => put<Data>('/research/positioning', { text: positioning }).then(onChange, fail('Not saved'))}>
              Save
            </Button>
          </div>
        )}
        {lib.patterns.length > 0 && (
          <>
            <div className="eyebrow">How the strongest books are built</div>
            <ul className="filed-list">
              {lib.patterns.map((x, i) => (
                <li key={i}>{x.text}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="comp-grid">
        {comps.map((c) => (
          <CompCard key={c.id} comp={c} url={c.source ? sources.get(c.source)?.url : undefined} onSet={(patch) => set(c.id, patch)} />
        ))}
      </div>
      {lib.comps.some((c) => c.status === 'dismissed') && (
        <button className="link faint small" onClick={() => setShowDismissed(!showDismissed)}>
          {showDismissed ? 'Hide' : 'Show'} dismissed books
        </button>
      )}
    </div>
  );
}

function CompCard({ comp: c, url, onSet }: { comp: CompTitle; url?: string; onSet: (patch: Partial<Pick<CompTitle, 'status' | 'difference' | 'shelf'>>) => void }) {
  const [difference, setDifference] = useState(c.difference);
  return (
    <div className={cx('card stack comp-card', c.status === 'dismissed' && 'dismissed')}>
      <div className="row">
        <BookMarked size={16} className="faint" />
        <div className="grow">
          <div className="comp-title serif">{c.title}</div>
          <div className="faint small">{[c.authors.join(', '), c.year].filter(Boolean).join(' · ')}</div>
        </div>
        <Badge kind={c.shelf === 'core' ? 'accent' : 'outline'}>{c.shelf === 'core' ? 'Same reader' : 'Nearby'}</Badge>
        {c.status === 'kept' && <Badge kind="success">Kept</Badge>}
      </div>
      {c.promise && <p className="comp-line"><span className="eyebrow">Promises</span> {c.promise}</p>}
      {c.framework && <p className="comp-line"><span className="eyebrow">Framework</span> {c.framework}</p>}
      {c.structure && <p className="comp-line"><span className="eyebrow">Built</span> {c.structure}</p>}
      {(c.praise.length > 0 || c.complaints.length > 0) && (
        <div className="comp-says">
          {c.praise.map((x, i) => (
            <span key={`p${i}`} className="say plus">+ {x}</span>
          ))}
          {c.complaints.map((x, i) => (
            <span key={`c${i}`} className="say minus">− {x}</span>
          ))}
        </div>
      )}
      <Field label="How yours differs">
        <textarea className="textarea" rows={2} value={difference} onChange={(e) => setDifference(e.target.value)} onBlur={() => difference !== c.difference && onSet({ difference })} placeholder="Theirs is for…; mine is for…" />
      </Field>
      <div className="btn-row">
        {c.status !== 'kept' && (
          <Button size="sm" icon={<Check />} onClick={() => onSet({ status: 'kept' })}>
            Keep
          </Button>
        )}
        {c.status !== 'dismissed' ? (
          <Button size="sm" variant="ghost" icon={<X />} onClick={() => onSet({ status: 'dismissed' })}>
            Not relevant
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onSet({ status: 'new' })}>
            Restore
          </Button>
        )}
        {url && (
          <a className="btn sm ghost" href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> Catalogue
          </a>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ evidence

function EvidenceList({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const { fail } = useApp();
  const lib = data.library;
  const [showDismissed, setShowDismissed] = useState(false);
  const sources = new Map(lib.sources.map((s) => [s.id, s]));
  const items = lib.evidence.filter((e) => showDismissed || e.status !== 'dismissed');
  const set = (id: string, patch: Partial<Pick<Evidence, 'status' | 'as_of' | 'jurisdiction'>>) => put<Data>(`/research/evidence/${id}`, patch).then(onChange, fail('Not saved'));
  if (!lib.evidence.length)
    return (
      <Empty icon={<ScrollText />} title="No evidence yet">
        Facts research finds come with the exact words that support them and the page they are on. A quote that is not on its page is dropped. Your own notes, added under Your material, count too.
      </Empty>
    );
  return (
    <div className="stack">
      <p className="muted small">Drafts may state only facts from here, and cite them. Keep what you trust; dismiss what you do not.</p>
      <div className="list">
        {items.map((e) => {
          const s = sources.get(e.source);
          const c = CHECK[e.check];
          return (
            <div key={e.id} className={cx('list-item evidence', e.status === 'dismissed' && 'dismissed')}>
              <span className="grow stack sm">
                <span className="primary-text">{e.claim}</span>
                {e.quote && e.quote !== e.claim && <blockquote className="verbatim">“{e.quote}”</blockquote>}
                <span className="row wrap small">
                  <Badge kind={c.kind}>{s?.kind === 'upload' && e.check === 'found' ? 'Quote found in your file' : c.label}</Badge>
                  {e.status === 'kept' && <Badge kind="success">Kept</Badge>}
                  {(e.as_of || e.jurisdiction) && <span className="faint">{[e.jurisdiction, e.as_of && `as of ${e.as_of}`].filter(Boolean).join(', ')}</span>}
                  {s?.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="faint source-link">
                      {s.publisher || s.title || new URL(s.url).hostname}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    s?.file && <span className="faint">From {s.file}</span>
                  )}
                </span>
              </span>
              <span className="row">
                {e.status !== 'kept' && <Button size="sm" iconOnly icon={<Check />} tip="Keep" onClick={() => set(e.id, { status: 'kept' })} />}
                {e.status !== 'dismissed' ? <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Dismiss" onClick={() => set(e.id, { status: 'dismissed' })} /> : <Button size="sm" variant="ghost" onClick={() => set(e.id, { status: 'new' })}>Restore</Button>}
              </span>
            </div>
          );
        })}
      </div>
      {lib.evidence.some((e) => e.status === 'dismissed') && (
        <button className="link faint small" onClick={() => setShowDismissed(!showDismissed)}>
          {showDismissed ? 'Hide' : 'Show'} dismissed
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ questions

function Questions({ data, onChange, canAsk }: { data: Data; onChange: (d: Data) => void; canAsk: boolean }) {
  const { fail, toast } = useApp();
  const gaps = data.library.gaps;
  const open = gaps.filter((g) => g.status === 'open');
  const done = gaps.filter((g) => g.status !== 'open');
  const set = (id: string, status: ResearchGap['status']) =>
    put<Data>(`/research/gaps/${id}`, { status }).then((d) => (onChange(d), status === 'queued' && toast({ kind: 'success', message: 'Added to your next session' })), fail('Not saved'));
  if (!gaps.length)
    return (
      <Empty icon={<MessageCircleQuestion />} title="No questions yet">
        What readers ask, and what the other books leave out, become questions for you: research finds the gaps, and you fill them from experience.
      </Empty>
    );
  return (
    <div className="stack">
      <div className="list">
        {open.map((g) => (
          <div key={g.id} className="list-item">
            <span className="grow stack sm">
              <span className="primary-text">{g.question}</span>
              <span className="row wrap small">
                <Badge kind="outline">{GAP_KIND[g.kind]}</Badge>
                {g.why && <span className="faint">{g.why}</span>}
              </span>
            </span>
            <span className="row">
              {canAsk && (
                <Button size="sm" icon={<MessageCircleQuestion />} onClick={() => set(g.id, 'queued')}>
                  Ask me in a session
                </Button>
              )}
              <Button size="sm" variant="ghost" iconOnly icon={<CircleCheck />} tip="Already covered" onClick={() => set(g.id, 'covered')} />
              <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Dismiss" onClick={() => set(g.id, 'dismissed')} />
            </span>
          </div>
        ))}
      </div>
      {done.length > 0 && <p className="faint small">{plural(done.filter((g) => g.status === 'queued').length, 'question')} queued for a session, {done.filter((g) => g.status === 'covered').length} covered, {done.filter((g) => g.status === 'dismissed').length} dismissed.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ the author's material

function Material({ data, onChange }: { data: Data; onChange: () => void }) {
  const { job, fail, toast } = useApp();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const files = data.library.sources.filter((s) => s.kind === 'upload');
  const counts = (id: string) => data.library.evidence.filter((e) => e.source === id).length;
  const slug = (n: string) => `${n.toLowerCase().replace(/\.(md|txt)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'notes'}.md`;
  const read = async (f: File) => (setName(f.name), setText(await f.text()));
  const add = async () => {
    setBusy(true);
    try {
      const r = await job<{ evidence: number; gaps: number }>('/research/material', { file: slug(name || 'my-notes'), text }, 'Reading your material');
      toast({ kind: 'success', message: 'Read', detail: `${plural(r.evidence, 'fact')} quoted from it, ${plural(r.gaps, 'question')} for you` });
      setName('');
      setText('');
      onChange();
    } catch {
      // reported by job()
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="research-material">
      <div className="card stack">
        <h3>Add your own material</h3>
        <p className="muted small">Course notes, talk transcripts, old posts, a client handout: what you already know, written down. It stays in the book’s folder. Facts are quoted from it exactly, and what it mentions but the book does not yet explain becomes questions for you.</p>
        <label className="btn sm file-btn">
          <Upload /> Choose a text or Markdown file
          <input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} hidden />
        </label>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="course-notes" />
        </Field>
        <textarea className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or paste it here." aria-label="Material" />
        <div className="btn-row">
          <Button variant="primary" icon={<FileText />} disabled={!text.trim() || busy} onClick={add}>
            {busy ? 'Reading…' : 'Add and read it'}
          </Button>
        </div>
      </div>
      <div className="stack">
        <h3 className="section-title">In the library</h3>
        {files.length ? (
          <div className="list">
            {files.map((f) => (
              <div key={f.id} className="list-item">
                <FileText size={15} className="faint" />
                <span className="grow">
                  <div className="primary-text">{f.title || f.file}</div>
                  <div className="secondary-text">{f.file} · {plural(counts(f.id), 'fact')} · added {f.retrieved}</div>
                </span>
                <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} tip="Remove" onClick={() => del(`/research/material/${f.file}`).then(onChange, fail('Not removed'))} />
              </div>
            ))}
          </div>
        ) : (
          <p className="faint small">Nothing yet.</p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ runs

function Runs({ data }: { data: Data }) {
  const { fail } = useApp();
  const [open, setOpen] = useState<ResearchRun | null>(null);
  if (!data.runs.length) return <p className="muted">No research runs yet.</p>;
  return (
    <div className="stack">
      <div className="list">
        {data.runs.map((r) => (
          <button key={r.id} className={cx('list-item', open?.id === r.id && 'active')} onClick={() => get<ResearchRun>(`/research/runs/${r.id}`).then(setOpen, fail('Could not open the run'))}>
            <span className="grow">
              <div className="primary-text">{r.brief || 'The book as it stands'}</div>
              <div className="secondary-text">
                {r.depth === 'deep' ? 'Deep' : 'Quick'} · {ago(r.started)} · {plural(r.found.comps, 'book')}, {plural(r.found.evidence, 'fact')}, {plural(r.found.gaps, 'question')} · {plural(r.searches, 'search', 'searches')}
                {r.cost_usd ? ` · $${r.cost_usd}` : ''}
              </div>
            </span>
            <Badge kind={r.status === 'done' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>{r.status}</Badge>
          </button>
        ))}
      </div>
      {open && (
        <div className="card stack">
          <h3>What the run did</h3>
          <ol className="run-log">
            {open.log.map((l, i) => (
              <li key={i} className={l.kind}>
                <span className="faint mono">{new Date(l.at).toLocaleTimeString()}</span> {l.text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
