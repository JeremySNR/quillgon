import { useEffect, useState } from 'react';
import { BookOpen, FolderOpen, Sparkles, ArrowRight, Clock } from 'lucide-react';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app';
import { ago } from '../lib/util';
import { Button, Field } from '../components/ui';

export function Welcome() {
  const { refresh, toast, go } = useApp();
  const [recent, setRecent] = useState<{ dir: string; title: string; opened: string }[]>([]);
  const [title, setTitle] = useState('');
  const [dir, setDir] = useState('');
  const [words, setWords] = useState(12000);
  const [offline, setOffline] = useState(false);
  const [openPath, setOpenPath] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get('/health').then((h) => setRecent(h.recent ?? []));
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
      await post('/init', { title, dir: dir || `~/Novels/${title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}`, target_words: words, offline });
      go('build');
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
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    const d = await window.novel?.chooseFolder?.();
    if (d) open(d);
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 20 }}>
          <span className="brand-mark" style={{ width: 52, height: 52, borderRadius: 14 }}>
            <BookOpen size={26} strokeWidth={2.2} />
          </span>
        </div>
        <h1>Novel Engine</h1>
        <p className="tag">Plan it, write it, change your mind. The story stays consistent and every change waits for your approval.</p>
        <div className="welcome-grid">
          <div className="card">
            <h3>Start a new book</h3>
            <div className="stack">
              <Field label="Title">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your title" autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
              </Field>
              <div className="grid-2">
                <Field label="Target length">
                  <select className="select" value={words} onChange={(e) => setWords(Number(e.target.value))}>
                    <option value={12000}>Novella · 12k words</option>
                    <option value={40000}>Short novel · 40k</option>
                    <option value={80000}>Novel · 80k</option>
                    <option value={110000}>Long novel · 110k</option>
                  </select>
                </Field>
                <Field label="Models">
                  <select className="select" value={offline ? 'offline' : 'claude'} onChange={(e) => setOffline(e.target.value === 'offline')}>
                    <option value="claude">Claude (API key)</option>
                    <option value="offline">Offline (try it out)</option>
                  </select>
                </Field>
              </div>
              <Field label="Folder" hint="Each book is a folder of plain Markdown and YAML, tracked with git.">
                <input className="input" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={`~/Novels/${title.replace(/\s+/g, '-') || 'my-book'}`} />
              </Field>
              <Button variant="primary" size="lg" disabled={!title.trim() || busy} onClick={create} icon={<Sparkles />}>
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
                      <span className="end faint">{ago(r.opened)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="row">
                <input className="input grow" value={openPath} onChange={(e) => setOpenPath(e.target.value)} placeholder="/path/to/book" onKeyDown={(e) => e.key === 'Enter' && openPath && open(openPath)} />
                {window.novel?.chooseFolder ? (
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
