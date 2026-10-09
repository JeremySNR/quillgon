import { useEffect, useState } from 'react';
import { GitBranch, GitCommitHorizontal, RotateCcw, Spline } from 'lucide-react';
import { get } from '../lib/api';
import { useApp } from '../lib/app';
import type { Commit } from '../lib/types';
import { ago, cx } from '../lib/util';
import { Button, Empty } from '../components/ui';
import { ProseDiff } from '../components/diff';

interface Compare {
  a: string;
  b: string;
  files: string[];
  scenes: { id: string; card: { a: string | null; b: string | null }; prose: { a: string | null; b: string | null } }[];
}

const body = (md: string | null) => (md ?? '').replace(/^---[\s\S]*?---\s*/, '');

export function HistoryView({ id }: { id?: string }) {
  const { project: p, job, toast, go } = useApp();
  const [log, setLog] = useState<Commit[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [patch, setPatch] = useState<{ files: string[]; patch: string } | null>(null);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const compareBranch = id?.startsWith('compare:') ? id.slice(8) : null;

  useEffect(() => {
    get<Commit[]>('/history?limit=200').then((l) => {
      setLog(l);
      if (!compareBranch) setSel(id && l.some((c) => c.hash === id) ? id : (l[0]?.hash ?? null));
    });
  }, [p?.totals.words, p?.ripple?.round, id]);
  useEffect(() => {
    if (sel) get(`/history/${sel}`).then(setPatch);
  }, [sel]);
  useEffect(() => {
    if (compareBranch) get<Compare>(`/branches/compare?a=main&b=${encodeURIComponent(compareBranch)}`).then(setCmp);
    else setCmp(null);
  }, [compareBranch]);

  if (!p) return null;
  const revert = async (hash: string) => {
    if (!confirm('Revert this change? A new commit undoes it; nothing is lost.')) return;
    await job('/history/revert', { hash }, 'Revert');
    toast({ kind: 'success', message: 'Change reverted' });
  };

  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <h1>{compareBranch ? `What-if: ${compareBranch}` : 'History'}</h1>
            <p className="sub">{compareBranch ? 'Scene by scene, how this what-if differs from main.' : 'Every accepted change is a commit. Revert anything; nothing is ever lost.'}</p>
          </div>
          <div className="actions">
            {p.branches.all
              .filter((b) => b !== 'main')
              .map((b) => (
                <Button key={b} size="sm" variant={compareBranch === b ? 'primary' : 'default'} icon={<Spline />} onClick={() => go('history', `compare:${b}`)}>
                  Compare {b}
                </Button>
              ))}
            {compareBranch && (
              <Button size="sm" variant="ghost" onClick={() => go('history')}>
                Back to history
              </Button>
            )}
          </div>
        </div>
        {cmp ? (
          cmp.scenes.length ? (
            <div className="stack lg">
              {cmp.scenes.map((s) => (
                <div className="card" key={s.id}>
                  <div className="card-head">
                    <span className="mono faint">{s.id}</span>
                    <h3>{p.scenes.find((x) => x.id === s.id)?.card.title}</h3>
                    <span className="faint">main → {cmp.b}</span>
                  </div>
                  {s.prose.a !== s.prose.b ? <ProseDiff before={body(s.prose.a)} after={body(s.prose.b)} /> : <pre className="patch">{s.card.b}</pre>}
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<GitBranch />} title="No scene differs yet">
              Changes on {cmp.b} so far touch {cmp.files.length ? cmp.files.join(', ') : 'nothing'}.
            </Empty>
          )
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 20, alignItems: 'start' }}>
            <div className="card tight" style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
              {log.map((c) => (
                <div key={c.hash} className={cx('timeline-commit', c.message.startsWith('Ripple') && 'ripple')} style={sel === c.hash ? { background: 'var(--accent-subtle)' } : undefined} onClick={() => setSel(c.hash)} role="button" tabIndex={0}>
                  <span className="node" />
                  <span>
                    <div className="msg">{c.message}</div>
                    <div className="faint mono">{c.hash.slice(0, 7)}</div>
                  </span>
                  <span className="when">{ago(c.date)}</span>
                </div>
              ))}
            </div>
            <div className="card">
              {patch && sel ? (
                <>
                  <div className="card-head">
                    <GitCommitHorizontal size={16} />
                    <h3>{log.find((c) => c.hash === sel)?.message}</h3>
                    <Button size="sm" className="more" icon={<RotateCcw />} onClick={() => revert(sel)}>
                      Revert
                    </Button>
                  </div>
                  {log.find((c) => c.hash === sel)?.body && <pre className="patch" style={{ marginBottom: 12 }}>{log.find((c) => c.hash === sel)?.body}</pre>}
                  <div className="faint" style={{ marginBottom: 8 }}>{patch.files.join(' · ')}</div>
                  <pre className="patch">
                    {patch.patch.split('\n').slice(0, 800).map((l, i) => (
                      <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : ''}>
                        {l || ' '}
                      </div>
                    ))}
                  </pre>
                </>
              ) : (
                <p className="muted">Select a change.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
