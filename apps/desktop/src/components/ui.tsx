import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, CircleDashed, Lock, Plus, X } from 'lucide-react';
import { cx, hue } from '../lib/util';
import type { Job, SyncState } from '../lib/types';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'success' | 'default';
  size?: 'sm' | 'lg';
  icon?: ReactNode;
  kbd?: string;
  iconOnly?: boolean;
  tip?: string;
};

export function Button({ variant = 'default', size, icon, kbd, iconOnly, tip, className, children, ...rest }: BtnProps) {
  const b = (
    <button
      {...rest}
      aria-label={rest['aria-label'] ?? (iconOnly ? tip : undefined)}
      className={cx('btn', variant !== 'default' && variant, size, iconOnly && 'icon', className)}
    >
      {icon}
      {!iconOnly && children}
      {kbd && !iconOnly && <span className="kbd">{kbd}</span>}
    </button>
  );
  return tip ? <Tooltip label={tip} kbd={kbd}>{b}</Tooltip> : b;
}

export function Tooltip({ label, kbd, children }: { label: string; kbd?: string; children: ReactNode }) {
  return (
    <span className="tooltip-host">
      {children}
      <span className="tooltip" role="tooltip">
        {label}
        {kbd && <span className="kbd">{kbd}</span>}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Badge({ kind, children, icon }: { kind?: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'outline'; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx('badge', kind)}>
      {icon}
      {children}
    </span>
  );
}

export function Chip({ id, children, title }: { id: string; children: ReactNode; title?: string }) {
  return (
    <span className="chip" style={{ '--h': hue(id) } as React.CSSProperties} title={title}>
      <span className="swatch" />
      {children}
    </span>
  );
}

export function Avatar({ id, name, size }: { id: string; name: string; size?: 'lg' | 'xl' }) {
  return (
    <span className={cx('avatar', size)} style={{ '--h': hue(id) } as React.CSSProperties} title={name}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const SYNC_LABEL: Record<SyncState, string> = {
  in_sync: 'In sync',
  card_ahead: 'Card ahead',
  prose_ahead: 'Prose edited',
  conflict: 'Conflict',
  unwritten: 'Not written',
};
const SYNC_HELP: Record<SyncState, string> = {
  in_sync: 'Card and prose agree',
  card_ahead: 'The card changed after the prose was written',
  prose_ahead: 'The prose was edited and has not been read back into the story',
  conflict: 'Both the card and the prose changed; resolve before generating',
  unwritten: 'No prose yet',
};
export function SyncBadge({ state, compact }: { state: SyncState; compact?: boolean }) {
  return (
    <span className={cx('sync', state)} title={SYNC_HELP[state]}>
      {state === 'unwritten' ? <CircleDashed size={11} /> : <span className={cx('dot', state === 'conflict' && 'pulse')} />}
      {!compact && SYNC_LABEL[state]}
    </span>
  );
}
export const syncLabel = (s: SyncState) => SYNC_LABEL[s];

export function StatusBadge({ status, lock }: { status: string; lock?: string }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {status === 'approved' && <Badge kind="success" icon={<Check />}>Approved</Badge>}
      {status === 'draft' && <Badge>Draft</Badge>}
      {(status === 'locked' || (lock && lock !== 'none')) && (
        <Badge kind="info" icon={<Lock />}>
          {lock && lock !== 'none' && lock !== 'both' ? `${lock} locked` : 'Locked'}
        </Badge>
      )}
    </span>
  );
}

export function Empty({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="btn-row">{actions}</div>}
    </div>
  );
}

export function Working({ job, fallback }: { job?: Job | null; fallback?: string }) {
  return (
    <div className="working" role="status" aria-live="polite">
      <span className="spinner" />
      <div>
        <div className="stage">{job ? stageName(job.stage, job.name) : fallback ?? 'Working…'}</div>
        {job?.detail && <div className="detail">{job.detail}</div>}
      </div>
    </div>
  );
}

const STAGES: Record<string, string> = {
  write: 'Writing',
  voice: 'Voice check',
  banned: 'Banned patterns',
  humanise: 'Humaniser pass',
  extract: 'Reading back into the graph',
  propose: 'Reviewing affected scenes',
  prose: 'Revising prose',
  apply: 'Applying round',
  read: 'Reading as a first reader',
  continuity: 'Checking continuity',
  cards: 'Planning scene cards',
  starting: 'Starting',
};
export const stageName = (stage: string, name?: string) => STAGES[stage] ?? STAGES[name ?? ''] ?? stage;

export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={cx('dialog', wide && 'wide')} role="dialog" aria-modal="true">
        <div className="dialog-head">
          <h2>{title}</h2>
          <span className="grow" />
          <Button variant="ghost" iconOnly icon={<X />} tip="Close" kbd="Esc" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <h2>{title}</h2>
          <span className="grow" />
          <Button variant="ghost" iconOnly icon={<X />} tip="Close" kbd="Esc" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </aside>
    </>
  );
}

export function useEscape(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && ref.current();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Ordered list of short texts (beats, rules, sample lines). */
export function ListEditor({ items, onChange, placeholder, numbered = true }: { items: string[]; onChange: (v: string[]) => void; placeholder?: string; numbered?: boolean }) {
  return (
    <div className="list-editor">
      {items.map((it, i) => (
        <div className="list-editor-row" key={i}>
          <span className="n">{numbered ? i + 1 : '•'}</span>
          <textarea
            className="textarea"
            rows={1}
            value={it}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const next = [...items.slice(0, i + 1), '', ...items.slice(i + 1)];
                onChange(next);
                requestAnimationFrame(() => (e.currentTarget.closest('.list-editor')?.querySelectorAll('textarea')[i + 1] as HTMLTextAreaElement | undefined)?.focus());
              }
              if (e.key === 'Backspace' && !it && items.length > 1) {
                e.preventDefault();
                onChange(items.filter((_, j) => j !== i));
              }
            }}
          />
          <Button variant="ghost" size="sm" iconOnly icon={<X />} tip="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => onChange([...items, ''])} style={{ alignSelf: 'flex-start' }}>
        {placeholder ?? 'Add'}
      </Button>
    </div>
  );
}

/** Pick a set of ids from known options, shown as coloured chips. */
export function TagSelect({ value, options, onChange, placeholder = 'Add…' }: { value: string[]; options: { id: string; label: string }[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const rest = options.filter((o) => !value.includes(o.id));
  return (
    <div className="tag-input">
      {value.map((id) => (
        <span className="chip" key={id} style={{ '--h': hue(id) } as React.CSSProperties}>
          {options.find((o) => o.id === id)?.label ?? id}
          <button aria-label={`Remove ${id}`} onClick={() => onChange(value.filter((x) => x !== id))}>
            <X />
          </button>
        </span>
      ))}
      {rest.length > 0 && (
        <select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label={placeholder}>
          <option value="">{placeholder}</option>
          {rest.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function Ring({ value, max, label, sub }: { value: number; max: number; label: ReactNode; sub: ReactNode }) {
  const r = 58;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="ring">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ transition: 'stroke-dasharray 600ms var(--ease-out)' }} />
      </svg>
      <div className="ring-label">
        <div>
          <div className="big">{label}</div>
          <div className="small">{sub}</div>
        </div>
      </div>
    </div>
  );
}
