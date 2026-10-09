import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, CircleHelp, Eye, Moon, Telescope, Target } from 'lucide-react';
import { get } from '../lib/api';
import { useApp } from '../lib/app';
import type { ReaderReport as Report } from '../lib/types';
import { ago, plural } from '../lib/util';
import { Badge, Button, Empty, Working } from '../components/ui';
import { EngagementChart } from '../components/chart';

export function ReaderReport() {
  const { project: p, job: run, go, jobs, toast } = useApp();
  const [list, setList] = useState<{ id: string; ran_at: string; scope: string; mean: number }[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const load = async (id?: string) => {
    const l = await get('/reports/reader');
    setList(l);
    const pick = id ?? l[0]?.id;
    setReport(pick ? await get<Report>(`/reports/reader/${pick}`) : null);
  };
  useEffect(() => {
    load();
  }, []);
  if (!p) return null;
  const runReader = async () => {
    setBusy(true);
    try {
      const r = await run<Report>('/quality/reader', act ? { act } : {}, 'Reader run');
      toast({ kind: 'success', message: 'Reader run complete', detail: `Mean engagement ${r.mean_engagement}/5` });
      await load(r.id);
    } finally {
      setBusy(false);
    }
  };
  const job = jobs[jobs.length - 1];
  const written = p.scenes.filter((s) => s.sync !== 'unwritten').length;
  const selEntry = report?.log.find((e) => e.scene === sel);

  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <h1>Reader report</h1>
            <p className="sub">A simulated first reader, one scene at a time, with no notes and nothing ahead. Use a different model from the writer so their blind spots differ.</p>
          </div>
          <div className="actions">
            {list.length > 1 && (
              <select className="select" style={{ width: 200 }} value={report?.id ?? ''} onChange={(e) => load(e.target.value)} aria-label="Report">
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.ran_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {r.scope}
                  </option>
                ))}
              </select>
            )}
            <select className="select" style={{ width: 140 }} value={act} onChange={(e) => setAct(e.target.value)} aria-label="Scope">
              <option value="">Whole book</option>
              {p.structure.acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title || a.id}
                </option>
              ))}
            </select>
            <Button variant="primary" icon={<Telescope />} onClick={runReader} disabled={busy || !written}>
              Run reader
            </Button>
          </div>
        </div>
        {busy && <div style={{ marginBottom: 20 }}><Working job={job} fallback="Reading" /></div>}
        {!report ? (
          <Empty icon={<Activity />} title={written ? 'No reader runs yet' : 'Nothing to read yet'}>
            {written ? 'Run the reader to see an engagement curve, where it got confused, and which twists it saw coming.' : 'Write some scenes first.'}
          </Empty>
        ) : (
          <div className="stack lg">
            <div className="tiles">
              <div className="tile">
                <span className="tile-label">
                  <Activity /> Mean engagement
                </span>
                <span className="tile-value">
                  {report.mean_engagement.toFixed(1)}
                  <small>/ 5</small>
                </span>
                <span className="tile-foot">{plural(report.scenes.length, 'scene')} · {ago(report.ran_at)}</span>
              </div>
              <div className="tile">
                <span className="tile-label">
                  <Target /> Twists called early
                </span>
                <span className="tile-value" style={{ color: report.predictions.length ? 'var(--warning)' : 'var(--success)' }}>
                  {report.predictions.length}
                </span>
                <span className="tile-foot">{report.predictions.length ? 'The single most useful signal here' : 'Nothing was guessed before its reveal'}</span>
              </div>
              <div className="tile">
                <span className="tile-label">
                  <CircleHelp /> Confusion left open
                </span>
                <span className="tile-value">{report.confusions.filter((c) => !c.resolved_in).length}</span>
                <span className="tile-foot">{plural(report.confusions.length, 'confusion')} in total</span>
              </div>
              <div className="tile">
                <span className="tile-label">
                  <Moon /> Boredom runs
                </span>
                <span className="tile-value" style={{ color: report.boredom.length ? 'var(--danger)' : undefined }}>
                  {report.boredom.length}
                </span>
                <span className="tile-foot">3+ scenes rated 2 or below</span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Engagement by scene</h3>
                <span className="faint" style={{ fontSize: 'var(--fs-label)' }}>Click a point to see what the reader thought. Shaded = boredom run. Arcs = a twist guessed early.</span>
              </div>
              <EngagementChart
                points={report.engagement.map((e) => ({ id: e.scene, label: e.title, value: e.engagement, act: p.scenes.find((s) => s.id === e.scene)?.act }))}
                acts={p.structure.acts.map((a) => ({ id: a.id, title: a.title || a.id }))}
                boredom={report.boredom}
                predictions={report.predictions.map((x) => ({ from: x.guessed_in, to: x.revealed_in, label: x.prediction }))}
                onSelect={setSel}
                selected={sel}
              />
              {selEntry && (
                <div className="card flat tight" style={{ marginTop: 12 }}>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <span className="mono faint">{selEntry.scene}</span>
                    <strong>{p.scenes.find((s) => s.id === selEntry.scene)?.card.title}</strong>
                    <Badge kind="accent">{selEntry.engagement}/5</Badge>
                    <span className="grow" />
                    <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => go('scene', selEntry.scene)}>
                      Open scene
                    </Button>
                  </div>
                  <p style={{ lineHeight: 1.55 }}>
                    <span className="faint">Believes: </span>
                    {selEntry.believes}
                  </p>
                  <p style={{ lineHeight: 1.55, marginTop: 6 }}>
                    <span className="faint">Expects: </span>
                    {selEntry.expects}
                  </p>
                  {selEntry.predictions.length > 0 && (
                    <p style={{ lineHeight: 1.55, marginTop: 6 }}>
                      <span className="faint">Predicts: </span>
                      {selEntry.predictions.join(' · ')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="two-col">
              <div className="card">
                <div className="card-head">
                  <h3>Twists the reader saw coming</h3>
                </div>
                {report.predictions.length ? (
                  <div className="stack">
                    {report.predictions.map((x, i) => (
                      <div key={i} className="banner warning" style={{ marginBottom: 0 }}>
                        <AlertTriangle />
                        <div className="banner-body">
                          <span className="banner-title">
                            Guessed in {x.guessed_in}, revealed in {x.revealed_in} ({plural(x.early_by, 'scene')} early)
                          </span>
                          <span className="serif" style={{ fontStyle: 'italic' }}>“{x.prediction}”</span>
                          <span className="faint">The truth: {x.statement}</span>
                          <div className="btn-row">
                            <Button size="sm" onClick={() => go('scene', x.guessed_in)}>
                              What gave it away?
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="row" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 size={16} /> No reveal was predicted before it happened.
                  </p>
                )}
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>Where the reader got confused</h3>
                </div>
                {report.confusions.length ? (
                  <div className="list">
                    {report.confusions.map((c) => (
                      <button key={c.id} className="list-item" onClick={() => go('scene', c.scene)}>
                        {c.resolved_in ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }} /> : <CircleHelp size={15} style={{ color: 'var(--warning)' }} />}
                        <span className="grow">
                          <div className="primary-text" style={{ fontWeight: 400, whiteSpace: 'normal' }}>{c.text}</div>
                          <div className="secondary-text">
                            {c.scene} · {c.resolved_in ? `cleared up in ${c.resolved_in}` : 'never cleared up'}
                          </div>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">The reader followed everything.</p>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Reading log</h3>
              </div>
              <div className="list">
                {report.log.map((e, i) => (
                  <details key={e.scene} style={{ borderBottom: '1px solid var(--border)', padding: '8px 4px' }}>
                    <summary style={{ cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span className="mono faint" style={{ width: 28 }}>{i + 1}</span>
                      <span style={{ fontWeight: 500 }}>{p.scenes.find((s) => s.id === e.scene)?.card.title ?? e.scene}</span>
                      <span className="grow" />
                      <span className="faint">{'●'.repeat(e.engagement)}{'○'.repeat(5 - e.engagement)}</span>
                    </summary>
                    <div className="stack" style={{ padding: '10px 0 6px 40px', gap: 6 }}>
                      <p><span className="faint">Believes: </span>{e.believes}</p>
                      <p><span className="faint">Expects: </span>{e.expects}</p>
                      {e.predictions.length > 0 && <p><span className="faint">Predicts: </span>{e.predictions.join(' · ')}</p>}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
