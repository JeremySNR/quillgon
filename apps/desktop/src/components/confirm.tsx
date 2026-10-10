import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { Button, Dialog, Field } from './ui';

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

export interface PromptOptions {
  title: ReactNode;
  message?: ReactNode;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to keep the dialog open. */
  validate?: (value: string) => string | null;
}

type Request =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void };

interface Dialogs {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const Ctx = createContext<Dialogs | null>(null);

/** The app's replacement for window.confirm/prompt: promise-based, rendered with Dialog, one at a time. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setQueue((q) => [...q, { kind: 'confirm', opts, resolve }])), []);
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => setQueue((q) => [...q, { kind: 'prompt', opts, resolve }])), []);
  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const top = queue[0];
  const settle = (v: boolean | string | null) => {
    if (!top) return;
    setQueue((q) => q.slice(1));
    (top.resolve as (x: typeof v) => void)(v);
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {top?.kind === 'confirm' && <ConfirmDialog opts={top.opts} onDone={settle} />}
      {top?.kind === 'prompt' && <PromptDialog opts={top.opts} onDone={settle} />}
    </Ctx.Provider>
  );
}

function useDialogs(): Dialogs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('DialogsProvider is missing');
  return ctx;
}

export const useConfirm = () => useDialogs().confirm;
export const usePrompt = () => useDialogs().prompt;

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
  return (
    <Dialog
      title={opts.title}
      onClose={() => onDone(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onDone(false)}>
            {opts.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={opts.danger ? 'danger' : 'primary'} onClick={() => onDone(true)}>
            {opts.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      {opts.message && <p className="muted">{opts.message}</p>}
    </Dialog>
  );
}

function PromptDialog({ opts, onDone }: { opts: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const submit = () => {
    const v = value.trim();
    if (!v) return setError('Enter a name first.');
    const problem = opts.validate?.(v) ?? null;
    if (problem) return setError(problem);
    onDone(v);
  };
  return (
    <Dialog
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            {opts.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {opts.message && <p className="muted">{opts.message}</p>}
        <Field label={opts.label} hint={error ?? undefined}>
          <input className="input" value={value} placeholder={opts.placeholder} aria-invalid={!!error} onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)} onChange={(e) => (setValue(e.target.value), setError(null))} />
        </Field>
      </form>
    </Dialog>
  );
}
