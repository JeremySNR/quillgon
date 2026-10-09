import { useState } from 'react';
import { Check, Link2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { del, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Obligation } from '../lib/types';
import { cx, plural } from '../lib/util';
import { Badge, Button, Drawer, Empty, Field } from '../components/ui';

export const OBLIGATION_KIND: Record<Obligation['kind'], string> = {
  clue: 'Clue',
  promise: 'Promise',
  question: 'Question',
  foreshadowing: 'Foreshadowing',
  chekhov: 'Chekhov’s gun',
  reveal: 'Reveal',
};

const blank: Obligation = { id: '', kind: 'clue', description: '', setup_scene: null, eligible_from: null, payoff_scene: null, status: 'planned', threads: [], facts: [], notes: '' };

/**
 * Every clue, promise and question the book plants, drawn across the book in story order:
 * a dot where it is planted, a ring where it pays off, and the span between. Anything the
 * book forgets to pay off is drawn trailing off the end, in the warning colour.
 */
export function Ledger({ onOffer }: { onOffer: (r: any, saved: string) => void }) {
  const { project: p, go } = useApp();
  const [editing, setEditing] = useState<Obligation | null>(null);
  if (!p) return null;
  const order = p.scenes.map((s) => s.id);
  const pos = (s: string | null) => (s ? order.indexOf(s) : -1);
  const list = [...p.obligations].sort((a, b) => pos(a.setup_scene) - pos(b.setup_scene) || pos(a.payoff_scene) - pos(b.payoff_scene));
  const issuesFor = (id: string) => p.obligationIssues.filter((i) => i.obligation === id);
  const col = (i: number) => `${((i + 0.5) / Math.max(1, order.length)) * 100}%`;

  return (
    <div className="stack lg">
      <div className="row">
        <p className="muted grow" style={{ margin: 0 }}>
          {p.obligations.length
            ? `${plural(p.obligations.length, 'promise')} to the reader. ${p.obligationIssues.length ? `${plural(p.obligationIssues.length, 'problem')}.` : 'Every one is set up before it pays off.'}`
            : 'Scene cards add clues, promises and questions here as they are planned.'}
        </p>
        <Button icon={<Plus />} onClick={() => setEditing(blank)}>
          New setup
        </Button>
      </div>
      {!list.length ? (
        <Empty icon={<Link2 />} title="Nothing planted yet">
          When the planner writes scene cards it records what each scene sets up and where it pays off. The writer is told exactly what to plant, what to pay, and what to keep open.
        </Empty>
      ) : (
        <div className="ledger card">
          <div className="ledger-axis">
            <div className="ledger-label" />
            <div className="ledger-track">
              {order.map((s, i) => (
                <button key={s} className="ledger-tick" style={{ left: col(i) }} onClick={() => go('scene', s)} title={p.scenes[i].card.title}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          {list.map((o) => {
            const a = pos(o.setup_scene);
            const b = pos(o.payoff_scene);
            const issues = issuesFor(o.id);
            const bad = issues.some((i) => i.severity === 'high');
            const end = b >= 0 ? b : order.length - 0.5;
            return (
              <button key={o.id} className={cx('ledger-row', issues.length > 0 && 'has-issue', bad && 'bad')} onClick={() => setEditing(o)}>
                <div className="ledger-label">
                  <Badge kind="outline">{OBLIGATION_KIND[o.kind]}</Badge>
                  <span className="ledger-desc">{o.description}</span>
                  {issues.length > 0 && (
                    <span className="ledger-issue">
                      <TriangleAlert size={12} /> {issues[0].message.replace(/^"[^"]*" /, '')}
                    </span>
                  )}
                </div>
                <div className="ledger-track">
                  {a >= 0 && (
                    <span
                      className={cx('ledger-span', b < 0 && 'open')}
                      style={{ left: col(a), width: `${((end - a) / Math.max(1, order.length)) * 100}%` }}
                    />
                  )}
                  {o.eligible_from && pos(o.eligible_from) >= 0 && <span className="ledger-gate" style={{ left: col(pos(o.eligible_from)) }} title={`Not before ${o.eligible_from}`} />}
                  {a >= 0 && <span className="ledger-plant" style={{ left: col(a) }} title={`Planted in ${o.setup_scene}`} />}
                  {b >= 0 && <span className={cx('ledger-pay', o.status === 'paid' && 'paid')} style={{ left: col(b) }} title={`Paid off in ${o.payoff_scene}`} />}
                </div>
              </button>
            );
          })}
          <div className="ledger-legend faint">
            <span>
              <i className="ledger-plant" /> planted
            </span>
            <span>
              <i className="ledger-pay paid" /> paid off
            </span>
            <span>
              <i className="ledger-gate" /> earliest allowed payoff
            </span>
          </div>
        </div>
      )}
      {editing && (
        <ObligationDrawer
          obligation={editing}
          onClose={() => setEditing(null)}
          onSaved={(r, msg) => {
            setEditing(null);
            onOffer(r, msg);
          }}
        />
      )}
    </div>
  );
}

function ObligationDrawer({ obligation, onClose, onSaved }: { obligation: Obligation; onClose: () => void; onSaved: (r: any, msg: string) => void }) {
  const { project: p, refresh } = useApp();
  const [o, setO] = useState(obligation);
  const isNew = !obligation.id;
  const save = async () => {
    const id = o.id || o.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'setup';
    const r = await put(`/obligations/${id}`, { obligation: { ...o, id, status: o.status === 'planned' && o.setup_scene ? 'open' : o.status } });
    onSaved(r, isNew ? 'Setup added' : 'Setup saved');
  };
  const remove = async () => {
    await del(`/obligations/${o.id}`);
    await refresh();
    onClose();
  };
  const sceneOpts = p!.scenes.map((s) => (
    <option key={s.id} value={s.id}>
      {s.id} {s.card.title}
    </option>
  ));
  const pick = (k: 'setup_scene' | 'payoff_scene' | 'eligible_from') => (
    <select className="select" value={o[k] ?? ''} onChange={(e) => setO({ ...o, [k]: e.target.value || null })}>
      <option value="">—</option>
      {sceneOpts}
    </select>
  );
  return (
    <Drawer
      title={isNew ? 'New setup' : OBLIGATION_KIND[o.kind]}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <Button variant="ghost" icon={<Trash2 />} onClick={remove}>
              Remove
            </Button>
          )}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check />} onClick={save} disabled={!o.description.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack lg">
        <Field label="What the reader is promised" hint="Phrase it the way you would remind yourself: “The ink of the storm entry is wrong.”">
          <textarea className="textarea" rows={3} value={o.description} onChange={(e) => setO({ ...o, description: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Kind">
            <select className="select" value={o.kind} onChange={(e) => setO({ ...o, kind: e.target.value as Obligation['kind'] })}>
              {Object.entries(OBLIGATION_KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={o.status} onChange={(e) => setO({ ...o, status: e.target.value as Obligation['status'] })}>
              <option value="planned">Planned</option>
              <option value="open">Open</option>
              <option value="paid">Paid off</option>
              <option value="dropped">Dropped on purpose</option>
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Planted in">{pick('setup_scene')}</Field>
          <Field label="Paid off in">{pick('payoff_scene')}</Field>
        </div>
        <Field label="Not before" hint="Optional. Stops the payoff landing too early, so the reader has time to forget.">
          {pick('eligible_from')}
        </Field>
        <Field label="Notes">
          <textarea className="textarea" rows={2} value={o.notes} onChange={(e) => setO({ ...o, notes: e.target.value })} />
        </Field>
        <p className="faint">Saving updates the cards that plant and pay it off, and offers a ripple if their prose needs to change.</p>
      </div>
    </Drawer>
  );
}
