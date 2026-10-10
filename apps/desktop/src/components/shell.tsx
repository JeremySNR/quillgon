import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Cloud,
  CloudOff,
  FileText,
  GitBranch,
  GitMerge,
  Hammer,
  History,
  Info,
  LayoutDashboard,
  ListTree,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
  Waves,
  X,
  Activity,
  Spline,
  Focus,
  ShieldCheck,
  Download,
  Feather,
  ChevronRight,
} from 'lucide-react';
import { useApp, type View } from '../lib/app';
import { get, post } from '../lib/api';
import { ago, cx, isMac, keys, loadPref, mod, plural, savePref } from '../lib/util';
import { Button, Kbd, stageName } from './ui';

const NAV: { view: View; label: string; icon: typeof LayoutDashboard; shortcut: string }[] = [
  { view: 'dashboard', label: 'Writing desk', icon: LayoutDashboard, shortcut: '1' },
  { view: 'build', label: 'Story planning', icon: Hammer, shortcut: '2' },
  { view: 'outline', label: 'Manuscript', icon: ListTree, shortcut: '3' },
  { view: 'ripple', label: 'Ripple review', icon: Waves, shortcut: '4' },
  { view: 'threads', label: 'Threads', icon: Spline, shortcut: '5' },
  { view: 'characters', label: 'Characters', icon: Users, shortcut: '6' },
  { view: 'reader', label: 'Reader report', icon: Activity, shortcut: '7' },
];

export function Sidebar({ rail, onToggle }: { rail: boolean; onToggle: () => void }) {
  const { project, route, go, setPalette } = useApp();
  if (!project) return null;
  const counts: Partial<Record<View, { n: number; alert?: boolean }>> = {
    outline: { n: project.totals.scenes },
    ripple: project.ripple ? { n: (project.ripple.counts.pending ?? 0) + (project.ripple.counts.conflicts ?? 0), alert: true } : undefined,
    threads: { n: project.threads.length },
    characters: { n: project.characters.length },
  };
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Feather size={21} strokeWidth={1.5} />
        </span>
        <span className="brand-name">Quillgon<span className="brand-caption">A SPACE FOR YOUR STORY</span></span>
      </div>
      <button className="book-switch" onClick={() => go('settings', 'book')} title={project.dir}>
        <span className="eyebrow">CURRENT MANUSCRIPT</span><span className="book-title">{project.book.title}</span>
        <span className="faint" style={{ fontSize: 'var(--fs-caption)' }}>
          {plural(project.totals.words, 'word')} · {project.book.genre || 'novel'}
        </span>
      </button>
      <button className="sidebar-search" onClick={() => setPalette(true)} title="Search and commands"><Search size={15} /><span>Find anything</span><Kbd>{keys('K')}</Kbd></button>
      <nav className="nav" aria-label="Main">
        <div className="nav-group">Workspace</div>
        {NAV.slice(0, 3).map((n) => (
          <NavItem key={n.view} {...n} current={route.view === n.view || (n.view === 'outline' && route.view === 'scene')} count={counts[n.view]} onClick={() => go(n.view)} />
        ))}
        {!rail && project.structure.acts.length > 0 && <div className="manuscript-tree">
          <div className="nav-group">Chapters</div>
          {project.structure.acts.flatMap(a => a.chapters).map((c, index) => <details key={c.id} open={route.view === 'scene' && c.scenes.includes(route.id ?? '') || undefined}>
            <summary><ChevronRight size={12} /><span className="tree-number">{String(index + 1).padStart(2, '0')}</span><span>{c.title || c.id}</span></summary>
            {c.scenes.map(id => { const scene = project.scenes.find(s => s.id === id); return scene ? <button key={id} aria-current={route.view === 'scene' && route.id === id ? 'page' : undefined} onClick={() => go('scene', id)}><span className={`tree-dot ${scene.sync === 'unwritten' ? '' : 'written'}`} /><span>{scene.card.title || 'Untitled scene'}</span></button> : null; })}
          </details>)}
        </div>}
        <div className="nav-group">Story & review</div>
        {NAV.slice(3).map((n) => (
          <NavItem key={n.view} {...n} current={route.view === n.view} count={counts[n.view]} onClick={() => go(n.view)} />
        ))}
      </nav>
      <div className="sidebar-foot">
        <NavItem view="history" label="History" icon={History} current={route.view === 'history'} onClick={() => go('history')} />
        <NavItem view="settings" label="Settings" icon={Settings} current={route.view === 'settings'} onClick={() => go('settings')} />
        <button className="nav-item" onClick={onToggle} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} title={`${rail ? 'Expand' : 'Collapse'} sidebar (${mod}\\)`}>
          <PanelLeft />
          <span className="label">Collapse</span>
        </button>
      </div>
    </aside>
  );
}

function NavItem({ label, icon: Icon, current, count, onClick }: { view: View; label: string; icon: typeof LayoutDashboard; current: boolean; count?: { n: number; alert?: boolean }; onClick: () => void; shortcut?: string }) {
  return (
    <button className="nav-item" aria-current={current ? 'page' : undefined} onClick={onClick} title={label}>
      <Icon />
      <span className="label">{label}</span>
      {count && count.n > 0 && <span className={cx('count', count.alert && 'alert')}>{count.n}</span>}
    </button>
  );
}

const TITLES: Record<View, string> = {
  dashboard: 'Writing desk',
  build: 'Story planning',
  outline: 'Manuscript',
  scene: 'Scene',
  ripple: 'Ripple review',
  threads: 'Threads',
  characters: 'Characters',
  reader: 'Reader report',
  history: 'History',
  settings: 'Settings',
};

export function TopBar() {
  const { project, route, go, setPalette, toast, refresh } = useApp();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [menu]);
  if (!project) return null;
  const scene = route.view === 'scene' ? project.scenes.find((s) => s.id === route.id) : null;
  const branch = project.branches.current;

  const newWhatIf = async () => {
    const name = prompt('Name this what-if (a git branch):', 'what-if-');
    if (!name) return;
    try {
      await post('/branches', { name: name.trim().replace(/\s+/g, '-') });
      toast({ kind: 'success', message: `Now exploring “${name}”`, detail: 'Changes here stay on this branch until you merge.' });
      refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Could not create the what-if', detail: (e as Error).message });
    }
  };
  const switchTo = async (b: string) => {
    setMenu(false);
    await post('/branches/switch', { name: b });
    toast({ kind: 'info', message: `Switched to ${b}` });
    refresh();
  };
  const merge = async () => {
    setMenu(false);
    await post('/branches/switch', { name: 'main' });
    const r = await post<{ ok: boolean; conflicts: string[] }>('/branches/merge', { from: branch });
    toast(r.ok ? { kind: 'success', message: `Merged “${branch}” into main` } : { kind: 'error', message: 'Merge conflicts', detail: r.conflicts.join(', ') });
    refresh();
  };

  return (
    <header className="topbar">
      <div className="crumbs">
        <button className="crumb-book" onClick={() => go('dashboard')}>{project.book.title}</button><span className="sep">/</span><span className="muted">{TITLES[route.view]}</span>
        {scene && (
          <>
            <span className="sep">/</span>
            <span>
              <span className="mono faint">{scene.id}</span> {scene.card.title}
            </span>
          </>
        )}
      </div>
      <div className="spacer" /><ThemeToggle />
      {project.mode === 'offline' && (
        <span className="badge warning" title="book.yaml uses the offline provider: placeholder output, no API calls. Change models in Settings.">
          <CloudOff /> Offline models
        </span>
      )}
      <div ref={ref} style={{ position: 'relative' }}>
        <Button size="sm" variant="ghost" icon={<GitBranch />} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
          {branch} <ChevronDown size={12} />
        </Button>
        {menu && (
          <div className="menu" role="menu" style={{ right: 0, top: 34 }}>
            <div className="menu-label">What-ifs</div>
            {project.branches.all.map((b) => (
              <button key={b} role="menuitem" onClick={() => switchTo(b)}>
                {b === branch ? <Check /> : <GitBranch />} {b}
              </button>
            ))}
            <hr />
            <button role="menuitem" onClick={() => (setMenu(false), newWhatIf())}>
              <Plus /> New what-if from here
            </button>
            {branch !== 'main' && (
              <>
                <button role="menuitem" onClick={() => (setMenu(false), go('history', `compare:${branch}`))}>
                  <Spline /> Compare with main
                </button>
                <button role="menuitem" onClick={merge}>
                  <GitMerge /> Merge into main
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <Button size="sm" variant="ghost" icon={<Search />} onClick={() => setPalette(true)} tip="Search and commands" kbd={keys('K')}>
        <span className="muted">Search</span>
      </Button>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return <Button size="sm" variant="ghost" iconOnly icon={theme === 'dark' ? <Sun /> : <Moon />} tip={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    savePref('theme', next); document.documentElement.dataset.theme = next; setTheme(next);
  }} />;
}

export function StatusBar() {
  const { project, jobs, savedAt } = useApp();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  if (!project) return null;
  const sync = project.totals.bySync;
  const out = (sync.card_ahead ?? 0) + (sync.prose_ahead ?? 0) + (sync.conflict ?? 0);
  const issues = project.continuity.mechanical.length + project.continuity.model.length;
  const job = jobs[jobs.length - 1];
  return (
    <footer className="statusbar">
      {job ? (
        <span className="item job">
          <span className="dot pulse" style={{ color: 'var(--accent)' }} />
          {stageName(job.stage, job.name)}
          {job.detail && <span className="faint">— {job.detail}</span>}
        </span>
      ) : (
        <span className="item">
          <Cloud /> {savedAt ? `Saved · ${ago(savedAt)}` : 'All changes saved'}
        </span>
      )}
      <span className="grow" />
      <span className="item" title="Scenes whose card and prose disagree">
        {out ? <AlertTriangle style={{ color: 'var(--warning)' }} /> : <ShieldCheck style={{ color: 'var(--success)' }} />}
        {out ? `${out} out of sync` : 'All in sync'}
      </span>
      <span className="item" title="Open continuity issues">
        <CircleAlert style={{ color: issues ? 'var(--danger)' : undefined }} />
        {plural(issues, 'issue')}
      </span>
      <span className="item">{project.totals.words.toLocaleString('en')} / {project.book.target_words.toLocaleString('en')} words</span>
      <span className="item">${project.costs.total_usd.toFixed(2)} spent</span>
    </footer>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useApp();
  const icon = { success: <CheckCircle2 />, error: <CircleAlert />, warning: <AlertTriangle />, info: <Info /> };
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.kind)}>
          {icon[t.kind]}
          <div className="msg">
            {t.message}
            {t.detail && <small>{t.detail}</small>}
          </div>
          {t.action && (
            <Button size="sm" onClick={() => (t.action!.run(), dismiss(t.id))}>
              {t.action.label}
            </Button>
          )}
          <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Dismiss" onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

export function CommandPalette() {
  const { project, palette, setPalette, go, job, toast, setFocus, focus } = useApp();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setPalette(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setPalette]);
  if (!palette || !project) return null;
  const run = (fn: () => void) => () => {
    setPalette(false);
    fn();
  };
  const theme = (t: string) => {
    savePref('theme', t);
    try {
      localStorage.setItem('ne.theme', t);
    } catch {
      // ignore
    }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return (
    <>
      <div className="scrim" onClick={() => setPalette(false)} />
      <Command className="cmdk" label="Command palette" loop>
        <Command.Input autoFocus placeholder="Search scenes, characters, threads, or type a command…" />
        <Command.List>
          <Command.Empty>Nothing matches.</Command.Empty>
          <Command.Group heading="Go to">
            {NAV.map((n) => (
              <Command.Item key={n.view} value={`go ${n.label}`} onSelect={run(() => go(n.view))}>
                <n.icon /> {n.label}
                <span className="end">
                  <Kbd>{mod}</Kbd>
                  <Kbd>{n.shortcut}</Kbd>
                </span>
              </Command.Item>
            ))}
            <Command.Item value="go history" onSelect={run(() => go('history'))}>
              <History /> History
            </Command.Item>
            <Command.Item value="go settings" onSelect={run(() => go('settings'))}>
              <Settings /> Settings
            </Command.Item>
          </Command.Group>
          <Command.Group heading="Actions">
            <Command.Item value="run reader simulated first reader" onSelect={run(() => job('/quality/reader', {}, 'Reader run').then(() => (toast({ kind: 'success', message: 'Reader run complete' }), go('reader'))))}>
              <Activity /> Run the first reader
            </Command.Item>
            <Command.Item value="check continuity" onSelect={run(() => job('/quality/continuity', {}, 'Continuity check').then(() => toast({ kind: 'success', message: 'Continuity checked' })))}>
              <ShieldCheck /> Check continuity
            </Command.Item>
            <Command.Item value="voice repetition report" onSelect={run(() => post('/quality/voice').then((r: any) => toast({ kind: 'info', message: `${plural(r.warnings, 'voice warning')}` })))}>
              <Sparkles /> Check voice and repetition
            </Command.Item>
            <Command.Item value="focus mode distraction free" onSelect={run(() => setFocus(!focus))}>
              <Focus /> {focus ? 'Leave' : 'Enter'} focus mode
              <span className="end">
                <Kbd>{mod}</Kbd>
                <Kbd>.</Kbd>
              </span>
            </Command.Item>
            <Command.Item value="export manuscript markdown" onSelect={run(() => get('/export?format=md').then((r: any) => toast({ kind: 'success', message: 'Exported', detail: r.file })))}>
              <Download /> Export manuscript (Markdown)
            </Command.Item>
            <Command.Item value="theme light" onSelect={run(() => theme('light'))}>
              <Sun /> Light theme
            </Command.Item>
            <Command.Item value="theme dark" onSelect={run(() => theme('dark'))}>
              <Moon /> Dark theme
            </Command.Item>
            <Command.Item value="theme system" onSelect={run(() => theme('system'))}>
              <Sun /> Follow system theme
            </Command.Item>
          </Command.Group>
          <Command.Group heading="Scenes">
            {project.scenes.map((s) => (
              <Command.Item key={s.id} value={`scene ${s.id} ${s.card.title} ${s.card.purpose}`} onSelect={run(() => go('scene', s.id))}>
                <FileText /> <span className="mono faint">{s.id}</span> {s.card.title}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Characters">
            {project.characters.map((c) => (
              <Command.Item key={c.id} value={`character ${c.bio.name} ${c.bio.role}`} onSelect={run(() => go('characters', c.id))}>
                <Users /> {c.bio.name} <span className="faint">{c.bio.role}</span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Threads">
            {project.threads.map((t) => (
              <Command.Item key={t.id} value={`thread ${t.title} ${t.id}`} onSelect={run(() => go('threads', t.id))}>
                <Spline /> {t.title || t.id}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </>
  );
}

/** Global keyboard shortcuts. */
export function useShortcuts(toggleRail: () => void) {
  const { go, setPalette, palette, setFocus, focus } = useApp();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const m = isMac ? e.metaKey : e.ctrlKey;
      if (!m) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!palette);
      } else if (e.key === '\\') {
        e.preventDefault();
        toggleRail();
      } else if (e.key === '.') {
        e.preventDefault();
        setFocus(!focus);
      } else if (/^[1-7]$/.test(e.key)) {
        e.preventDefault();
        go(NAV[Number(e.key) - 1].view);
      } else if (e.key === ',') {
        e.preventDefault();
        go('settings');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [go, setPalette, palette, toggleRail, setFocus, focus]);
}

export function useRail(): [boolean, () => void] {
  const [rail, setRail] = useState(() => loadPref('rail', false));
  return [rail, () => setRail((r) => (savePref('rail', !r), !r))];
}
