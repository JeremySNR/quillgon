import { useEffect, useState } from 'react';
import { BookOpen, Download, Sparkles } from 'lucide-react';
import { coverImageUrl, get } from '../lib/api';
import { useApp } from '../lib/app';
import { Button } from '../components/ui';

interface Cover {
  id: string; title: string; created: string; model: string; prompt: string;
  options: { author: string; direction: string; style: string; typography: boolean };
}
interface Library { ready: boolean; reason?: string; covers: Cover[] }

export function Covers() {
  const { project, job, jobs, toast } = useApp();
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [author, setAuthor] = useState('');
  const [direction, setDirection] = useState('');
  const [style, setStyle] = useState('auto');
  const [typography, setTypography] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [thumbnail, setThumbnail] = useState(false);
  const running = jobs.some(j => j.name === 'cover');
  useEffect(() => {
    let active = true;
    get<Library>('/covers').then(value => { if (active) setLibrary(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [running]);
  const cover = library?.covers.find(c => c.id === selected) ?? library?.covers[0];
  const generate = async () => {
    setBusy(true); setError('');
    try {
      const result = await job<Cover>('/covers/generate', { author, direction, style, typography }, 'Cover generation');
      setSelected(result.id);
      setLibrary(await get<Library>('/covers'));
      toast({ kind: 'success', message: 'Your cover is ready' });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="page"><div className="page-inner wide">
    <div className="page-head"><div><h1>Book covers</h1><p className="sub">Give your story a first impression. Start with the book, or bring your own vision.</p></div></div>
    <div className="cover-workspace">
      <section className="cover-controls" aria-label="Cover direction">
        <h2>Make it yours</h2>
        <p className="muted">We’ll use {project?.book.title}’s premise, tone, characters and setting to choose a distinctive cover. Every field below is optional.</p>
        <label htmlFor="cover-author">Author name</label>
        <input className="input" id="cover-author" value={author} maxLength={120} onChange={e => setAuthor(e.target.value)} placeholder="Name or pen name" />
        <label htmlFor="cover-style">Art direction</label>
        <select className="select" id="cover-style" value={style} onChange={e => setStyle(e.target.value)}>
          <option value="auto">Choose for my book</option><option value="illustration">Painterly illustration</option><option value="photography">Natural photography</option><option value="printmaking">Ink & printmaking</option><option value="minimal">Minimal & symbolic</option>
        </select>
        <label htmlFor="cover-direction">Your creative direction</label>
        <textarea className="textarea" id="cover-direction" rows={5} maxLength={3000} value={direction} onChange={e => setDirection(e.target.value)} placeholder="A salt-stained ledger on a quiet shoreline. Muted blues, one red thread. No faces. Or leave this blank and let the story lead." />
        <label className="row"><input type="checkbox" checked={typography} onChange={e => setTypography(e.target.checked)} /> Include title and author lettering</label>
        <p className="faint">Turn lettering off for artwork with space to add your own type.</p>
        <Button variant="primary" icon={<Sparkles size={16} />} disabled={!library?.ready || busy || running} onClick={generate}>{busy || running ? 'Creating your cover…' : direction.trim() || style !== 'auto' ? 'Generate with my direction' : 'Generate from my book'}</Button>
        <p className="faint">One image per click. OpenAI API charges apply. Generation may take a few minutes.</p>
        {library && !library.ready && <p role="status" className="muted">{library.reason}</p>}
        {error && <p role="alert">{error}</p>}
        <details><summary>What goes into a good cover?</summary><p className="muted">A clear genre promise, one memorable focal point, restrained color and readable typography. We ask for deliberate materials and natural detail to avoid a generic glossy finish.</p></details>
      </section>
      <section className="cover-results" aria-label="Generated covers" aria-busy={busy || running}>
        {cover ? <>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><h2>Your cover</h2><label className="row"><input type="checkbox" checked={thumbnail} onChange={e => setThumbnail(e.target.checked)} /> Thumbnail check</label></div>
          <div className="cover-preview"><img className={thumbnail ? 'thumbnail' : ''} src={coverImageUrl(cover.id)} alt={`Generated cover for ${cover.title}`} /></div>
          <div className="row"><a className="btn" href={coverImageUrl(cover.id, true)} download="book-cover.png"><Download size={16} /> Download PNG</a><Button variant="ghost" onClick={() => { setAuthor(cover.options.author); setStyle(cover.options.style); setDirection(cover.options.direction); setTypography(cover.options.typography); }}>Reuse direction</Button></div>
          <p className="faint">Front cover only. Check spelling, visual details and thumbnail legibility before publishing. Print editions need a separate spine and back cover layout.</p>
          <div className="cover-gallery">{library?.covers.map(c => <button key={c.id} aria-label={`View cover from ${new Date(c.created).toLocaleString()}`} aria-pressed={cover.id === c.id} onClick={() => setSelected(c.id)}><img src={coverImageUrl(c.id)} alt={c.title} loading="lazy" /></button>)}</div>
          <details><summary>View generation brief</summary><pre className="cover-brief">{cover.prompt}</pre></details>
        </> : <div className="cover-placeholder"><BookOpen size={40} strokeWidth={1} /><h2>A cover that belongs to your story</h2><p className="muted">Generate your first cover. Each version stays here, so you can explore a new direction without losing a favorite.</p></div>}
      </section>
    </div>
  </div></div>;
}
