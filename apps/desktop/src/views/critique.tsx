import { useEffect, useState } from 'react';
import { Gauge, ScanSearch, ShieldCheck, ThumbsUp } from 'lucide-react';
import { get } from '../lib/api';
import { useApp } from '../lib/app';
import type { Critique, Predictability, ShapeFinding } from '../lib/types';
import { ago, cx } from '../lib/util';
import { Badge, Button, Working } from '../components/ui';

export const FINDING: Record<ShapeFinding['kind'], string> = {
  'theme-stated': 'Theme stated, not shown',
  'single-track': 'Only one storyline',
  'flat-escalation': 'Stakes don’t rise',
  'tidy-resolution': 'Everything resolves at once',
  'no-moral-ambiguity': 'No one is in the wrong for a good reason',
  archetype: 'A stock character',
  rushed: 'Rushed',
  'sagging-middle': 'Sagging middle',
  'passive-protagonist': 'Protagonist things happen to',
  coincidence: 'Solved by coincidence',
  'unpaid-setup': 'Setup never paid off',
  other: 'Note',
};

export function FindingList({ findings, empty }: { findings: ShapeFinding[]; empty?: string }) {
  if (!findings.length)
    return (
      <div className="row muted" style={{ padding: '6px 2px' }}>
        <ShieldCheck size={15} style={{ color: 'var(--success)' }} /> {empty ?? 'No structural tells found.'}
      </div>
    );
  const order = { high: 0, medium: 1, low: 2 };
  return (
    <ul className="findings">
      {[...findings]
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((f, i) => (
          <li key={i} className={cx('finding', f.severity)}>
            <div className="row" style={{ gap: 8 }}>
              <span className={cx('sev', f.severity)} aria-label={`${f.severity} severity`} />
              <strong>{FINDING[f.kind]}</strong>
              {f.where && <span className="faint mono">{f.where}</span>}
            </div>
            <p className="finding-evidence">{f.evidence}</p>
            {f.suggestion && <p className="finding-fix">{f.suggestion}</p>}
          </li>
        ))}
    </ul>
  );
}

/** The whole-plan critic: run it before writing, when changing the plan is cheap. */
export function PlanCritique() {
  const { project: p, job: run, jobs } = useApp();
  const [c, setC] = useState<Critique | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<Critique | null>('/reports/critique').then(setC).catch(() => undefined);
  }, [p?.critique?.ran_at]);
  const go = async () => {
    setBusy(true);
    try {
      setC(await run<Critique>('/critique', {}, 'Plan check'));
    } finally {
      setBusy(false);
    }
  };
  const findings = c ? [...c.mechanical, ...c.findings] : [];
  return (
    <div className="card">
      <div className="card-head">
        <h3>Plan check</h3>
        <span className="muted grow">The shapes AI-planned stories fall into, caught before a word is written.</span>
        <Button size="sm" icon={<ScanSearch />} onClick={go} disabled={busy || !p?.scenes.length}>
          {c ? 'Check again' : 'Check the plan'}
        </Button>
      </div>
      {busy && <Working job={jobs[jobs.length - 1]} fallback="Reading the plan" />}
      {c && !busy && (
        <>
          <FindingList findings={findings} />
          {c.strengths.length > 0 && (
            <div className="strengths">
              {c.strengths.map((s, i) => (
                <div key={i} className="row muted" style={{ gap: 8 }}>
                  <ThumbsUp size={13} style={{ color: 'var(--success)' }} /> {s}
                </div>
              ))}
            </div>
          )}
          <p className="faint" style={{ fontSize: 'var(--fs-label)', marginTop: 8 }}>Checked {ago(c.ran_at)}</p>
        </>
      )}
      {!c && !busy && <p className="muted">Finds single-track plots, sagging middles, tidy endings, stated themes, rushed relationships and setups that never pay off.</p>}
    </div>
  );
}

/** “Would a model have picked this turn anyway?” for one scene. */
export function PredictabilityCheck({ scene }: { scene: string }) {
  const { job: run } = useApp();
  const [r, setR] = useState<Predictability | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      setR(await run<Predictability>(`/scenes/${scene}/predictability`, {}, 'Predictability'));
    } finally {
      setBusy(false);
    }
  };
  const tone = r?.verdict === 'predictable' ? 'danger' : r?.verdict === 'expected' ? 'warning' : 'success';
  return (
    <div className="predict">
      <div className="row">
        <Gauge size={15} className="faint" />
        <span className="grow" style={{ fontWeight: 600 }}>
          How predictable is this turn?
        </span>
        <Button size="sm" variant="ghost" onClick={go} disabled={busy}>
          {busy ? 'Sampling…' : r ? 'Again' : 'Test it'}
        </Button>
      </div>
      {r && (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="row">
            <Badge kind={tone}>{r.verdict}</Badge>
            <span className="faint" style={{ fontSize: 'var(--fs-label)' }}>
              {Math.round(r.score * 100)}% of the model’s own guesses land on your turn
            </span>
          </div>
          <ul className="samples">
            {r.samples.map((s, i) => (
              <li key={i} className={cx(s.similarity >= 0.3 && 'match')}>
                {s.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!r && <p className="faint" style={{ fontSize: 'var(--fs-label)', margin: '4px 0 0' }}>Asks the model what it would have made happen here. If it guesses your turn, readers will too.</p>}
    </div>
  );
}
