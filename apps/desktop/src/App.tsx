import { useEffect } from 'react';
import { AppProvider, useApp } from './lib/app';
import { CommandPalette, Sidebar, StatusBar, Toasts, TopBar, useRail, useShortcuts } from './components/shell';
import { Welcome } from './views/welcome';
import { Dashboard } from './views/dashboard';
import { Build } from './views/build';
import { Outline } from './views/outline';
import { SceneEditor } from './views/scene';
import { RippleReview } from './views/ripple';
import { Characters, Threads } from './views/entities';
import { ReaderReport } from './views/reader';
import { HistoryView } from './views/history';
import { SettingsView } from './views/settings';
import { cx, isMac, loadPref } from './lib/util';

function Shell() {
  const { project, loading, route, focus } = useApp();
  const [rail, toggleRail] = useRail();
  useShortcuts(toggleRail);
  useEffect(() => {
    document.documentElement.style.setProperty('--prose-size', `${loadPref('proseSize', 19)}px`);
    document.documentElement.style.setProperty('--prose-measure', `${loadPref('measure', 66)}ch`);
    document.body.classList.toggle('is-mac', isMac && !!window.quillgon);
  }, []);
  useEffect(() => {
    if (project) document.title = `${project.book.title} — Quillgon`;
  }, [project?.book.title]);

  if (loading) return <div className="welcome" />;
  if (!project)
    return (
      <>
        <Welcome />
        <Toasts />
      </>
    );

  const view = (() => {
    switch (route.view) {
      case 'build':
        return <Build step={route.id} />;
      case 'outline':
        return <Outline />;
      case 'scene':
        return route.id ? <SceneEditor key={route.id} id={route.id} /> : <Outline />;
      case 'ripple':
        return <RippleReview />;
      case 'threads':
        return <Threads id={route.id} />;
      case 'characters':
        return <Characters id={route.id} />;
      case 'reader':
        return <ReaderReport />;
      case 'history':
        return <HistoryView id={route.id} />;
      case 'settings':
        return <SettingsView tab={route.id} />;
      default:
        return <Dashboard />;
    }
  })();

  return (
    <div className={cx('app', rail && 'rail', focus && route.view === 'scene' && 'focus')}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <Sidebar rail={rail} onToggle={toggleRail} />
      <TopBar />
      <main className="main" id="main" tabIndex={-1}>
        {view}
      </main>
      <StatusBar />
      <CommandPalette />
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
