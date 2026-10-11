import { useEffect, useState } from 'react';
import { BookOpen, FolderOpen, Feather, ArrowRight, Clock } from 'lucide-react';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app';
import { ago } from '../lib/util';
import { Badge, Button, Field, Segmented } from '../components/ui';

type Kind = 'novel' | 'life-story' | 'memoir' | 'guide';
const KINDS: { value: Kind; label: string; desc: string }[] = [
  { value: 'novel', label: 'A novel', desc: 'Plan, draft and revise fiction' },
  { value: 'life-story', label: 'A life story', desc: 'A whole life, gathered by interview' },
  { value: 'memoir', label: 'A memoir', desc: 'One part of a life, told with hindsight' },
  { value: 'guide', label: 'A guide', desc: 'Teach what you know: coaching, money, self-help' },
];
type Preset = 'general' | 'coaching' | 'finance' | 'self-help';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'coaching', label: 'Coaching or sales' },
  { value: 'finance', label: 'Money' },
  { value: 'self-help', label: 'Self-help' },
  { value: 'general', label: 'Something else' },
];

export function Welcome() {
  const { refresh, toast, go, fail } = useApp();
  const [recent, setRecent] = useState<{ dir: string; title: string; opened: string; kind?: Kind }[]>([]);
  const [kind, setKind] = useState<Kind>('novel');
  const [subject, setSubject] = useState<'self' | 'other'>('self');
  const [subjectName, setSubjectName] = useState('');
  const [audience, setAudience] = useState<'family' | 'public'>('family');
  const [born, setBorn] = useState('');
  const [preset, setPreset] = useState<Preset>('coaching');
  const [reader, setReader] = useState('');
  const [promise, setPromise] = useState('');
  const [where, setWhere] = useState('UK');
  const [authorName, setAuthorName] = useState('');
  const [title, setTitle] = useState('');
  const [dir, setDir] = useState('');
  const [words, setWords] = useState(12000);
  const [lifeWords, setLifeWords] = useState(50000);
  const [provider, setProvider] = useState('openai');
  const [openPath, setOpenPath] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get('/health').then((h) => setRecent(h.recent ?? []), fail('Could not reach the Quillgon server'));
  }, []);

  const open = async (d: string) => {
    setBusy(true);
    try {
      await post('/open', { dir: d });
      go('dashboard');
      await refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Could not open that folder', detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const life = kind !== 'novel';
      await post('/init', {
        title,
        dir: dir || `~/${life ? 'Books' : 'Novels'}/${title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}`,
        target_words: life ? lifeWords : words,
        offline: provider === 'offline',
        codex: provider === 'codex',
        kind,
        ...(kind === 'guide'
          ? { subject_name: authorName.trim(), guide: { preset, reader: reader.trim(), promise: promise.trim(), ...(preset === 'finance' ? { jurisdiction: where.trim() } : {}) } }
          : life
            ? { subject, subject_name: subject === 'other' ? subjectName.trim() : '', audience, born: born.trim() }
            : {}),
      });
      go(life ? 'sessions' : 'build');
      await refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Could not create the book', detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const sample = async () => {
    setBusy(true);
    try {
      await post('/open-sample');
      go('dashboard');
      await refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Could not open the sample', detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    const d = await window.quillgon?.chooseFolder?.().catch(fail('Could not choose a folder'));
    if (d) open(d);
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 20 }}>
          <span className="brand-mark" style={{ width: 52, height: 52, borderRadius: 14 }}>
            <Feather size={36} strokeWidth={1.4} />
          </span>
        </div>
        <h1>Quillgon</h1>
        <p className="tag">A considered space for your next book. From the first idea to the final page.</p>
        <div className="welcome-grid">
          <div className="card">
            <h3>Start a new book</h3>
            <div className="stack">
              <Field label="What are you writing?">
                <div className="kinds" role="radiogroup" aria-label="Kind of book">
                  {KINDS.map((k) => (
                    <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} className="kind" onClick={() => setKind(k.value)}>
                      <span className="kind-name">{k.label}</span>
                      <span className="kind-desc">{k.desc}</span>
                    </button>
                  ))}
                </div>
              </Field>
              {kind === 'guide' && (
                <>
                  <Field label="What kind of guide?" hint={preset === 'finance' ? 'Adds checks for figures that date, advice wording and the sums in worked examples.' : 'Every guide checks that its figures have a source and its examples add up.'}>
                    <Segmented value={preset} options={PRESETS} onChange={setPreset} />
                  </Field>
                  <Field label="Who is it for?" hint="One real kind of person, and where they are stuck.">
                    <input className="input" value={reader} onChange={(e) => setReader(e.target.value)} placeholder="New B2B sales reps who freeze on the follow-up call" />
                  </Field>
                  <Field label="What will they be able to do after reading it?">
                    <input className="input" value={promise} onChange={(e) => setPromise(e.target.value)} placeholder="Book twice as many second meetings" />
                  </Field>
                  <div className="grid-2">
                    <Field label="Your name" hint="Optional; the book is in your voice.">
                      <input className="input" value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Sam Reed" />
                    </Field>
                    {preset === 'finance' && (
                      <Field label="Where must the figures hold?">
                        <input className="input" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="UK" />
                      </Field>
                    )}
                  </div>
                </>
              )}
              {kind !== 'novel' && kind !== 'guide' && (
                <>
                  <Field label="Whose story is it?" hint={subject === 'other' ? 'The ghostwriter will interview them, and write in their voice.' : 'The ghostwriter will interview you, and write in your voice.'}>
                    <Segmented value={subject} options={[{ value: 'self', label: 'Mine' }, { value: 'other', label: 'Someone else’s' }]} onChange={setSubject} />
                  </Field>
                  {subject === 'other' && (
                    <Field label="Their name">
                      <input className="input" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="Margaret Ellis" />
                    </Field>
                  )}
                  <div className="grid-2">
                    <Field label="Who is it for?">
                      <Segmented value={audience} options={[{ value: 'family', label: 'Family' }, { value: 'public', label: 'Publishing it' }]} onChange={setAudience} />
                    </Field>
                    <Field label="Year of birth" hint="Optional; for ages on the timeline.">
                      <input className="input" value={born} onChange={(e) => setBorn(e.target.value)} placeholder="1948" inputMode="numeric" />
                    </Field>
                  </div>
                </>
              )}
              <Field label="Title">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your title" autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
              </Field>
              <div className="grid-2">
                {kind === 'novel' ? (
                  <Field label="Target length">
                    <select className="select" value={words} onChange={(e) => setWords(Number(e.target.value))}>
                      <option value={12000}>Novella · 12k words</option>
                      <option value={40000}>Short novel · 40k</option>
                      <option value={80000}>Novel · 80k</option>
                      <option value={110000}>Long novel · 110k</option>
                    </select>
                  </Field>
                ) : kind === 'guide' ? (
                  <Field label="Length">
                    <select className="select" value={lifeWords} onChange={(e) => setLifeWords(Number(e.target.value))}>
                      <option value={25000}>A short guide · 25k words</option>
                      <option value={50000}>A full book · 50k</option>
                      <option value={70000}>A big book · 70k</option>
                    </select>
                  </Field>
                ) : (
                  <Field label="Length">
                    <select className="select" value={lifeWords} onChange={(e) => setLifeWords(Number(e.target.value))}>
                      <option value={25000}>A family book · 25k words</option>
                      <option value={50000}>A memoir · 50k</option>
                      <option value={80000}>A full autobiography · 80k</option>
                    </select>
                  </Field>
                )}
                <Field label="Models">
                  <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
                    <option value="openai">OpenAI (API key)</option>
                    <option value="codex">Codex subscription</option>
                    <option value="offline">Offline (try it out)</option>
                  </select>
                </Field>
              </div>
              <p className="muted">{provider === 'codex' ? 'Sign in with ChatGPT using codex login on this computer first. Your Codex plan limits apply.' : provider === 'openai' ? 'Set OPENAI_API_KEY before starting Quillgon. API usage is billed separately from ChatGPT.' : 'Placeholder output for exploring the workflow without a model connection.'}</p>
              <Field label="Folder" hint="Choose where your manuscript is saved on this computer.">
                <input className="input" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={`~/${kind === 'novel' ? 'Novels' : 'Books'}/${title.replace(/\s+/g, '-') || 'my-book'}`} />
              </Field>
              <Button variant="primary" size="lg" disabled={!title.trim() || busy} onClick={create} icon={<Feather />}>
                Create book
              </Button>
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <h3>Open a book</h3>
              {recent.length > 0 && (
                <div className="list" style={{ marginBottom: 12 }}>
                  {recent.slice(0, 5).map((r) => (
                    <button key={r.dir} className="list-item" onClick={() => open(r.dir)} disabled={busy}>
                      <Clock size={15} className="faint" />
                      <span className="grow">
                        <div className="primary-text serif">{r.title}</div>
                        <div className="secondary-text">{r.dir}</div>
                      </span>
                      {r.kind && r.kind !== 'novel' && <Badge kind="accent">{r.kind === 'memoir' ? 'Memoir' : r.kind === 'guide' ? 'Guide' : 'Life story'}</Badge>}
                      <span className="end faint">{ago(r.opened)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="row">
                <input className="input grow" value={openPath} onChange={(e) => setOpenPath(e.target.value)} placeholder="/path/to/book" onKeyDown={(e) => e.key === 'Enter' && openPath && open(openPath)} />
                {window.quillgon?.chooseFolder ? (
                  <Button icon={<FolderOpen />} onClick={choose}>
                    Browse
                  </Button>
                ) : (
                  <Button icon={<ArrowRight />} disabled={!openPath} onClick={() => open(openPath)}>
                    Open
                  </Button>
                )}
              </div>
            </div>
            <div className="card">
              <h3>Explore the sample</h3>
              <p className="muted" style={{ lineHeight: 1.55, marginBottom: 12 }}>
                <span className="serif" style={{ color: 'var(--text)' }}>The Tidekeeper’s Ledger</span> is a 12-scene Cornish mystery, already written. Change a fact and watch the ripple.
              </p>
              <Button onClick={sample} disabled={busy} icon={<BookOpen />}>
                Open the sample novella
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
