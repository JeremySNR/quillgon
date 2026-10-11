import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { post } from '../lib/api';
import { useApp } from '../lib/app';
import { blobToBase64, Recorder } from '../lib/recorder';
import { cx } from '../lib/util';
import { Tooltip } from './ui';

/** Where dictated text goes: a CodeMirror editor, a textarea, a list of answers. */
export interface DictationTarget {
  /** The text around the cursor right now, so the dictation joins it. */
  context(): { before: string; after: string };
  /** Put text in at the cursor; returns a function that swaps it for other text (undo the tidy-up). */
  insert(text: string): (replacement: string) => void;
}

export interface DictateResponse {
  raw: string;
  text: string;
  level: 'verbatim' | 'light' | 'polished';
  provider: 'openai' | 'local' | 'offline';
  seconds: number;
  flags: string[];
  /** The recording's file name, when it was kept for an interview session. */
  audio?: string;
}

export type DictationState = 'idle' | 'listening' | 'tidying';

/** A textarea or input as a dictation target (controlled by React state). */
export function fieldTarget(el: () => HTMLTextAreaElement | HTMLInputElement | null, value: () => string, set: (v: string) => void): DictationTarget {
  // React applies `set` on its next render, so until it does, read back what was just written:
  // the next piece of a long take needs the text and cursor as they are after this one.
  let written: { from: string; to: string; at: number } | null = null;
  const read = () => {
    const v = value();
    if (written && v === written.from) return { v: written.to, start: written.at, end: written.at };
    written = null;
    const node = el();
    const start = node?.selectionStart ?? v.length;
    return { v, start, end: node?.selectionEnd ?? start };
  };
  const write = (from: string, to: string, at: number) => {
    written = { from, to, at };
    set(to);
  };
  return {
    context() {
      const { v, start, end } = read();
      return { before: v.slice(0, start), after: v.slice(end) };
    },
    insert(text) {
      const { v, start, end } = read();
      write(v, v.slice(0, start) + text + v.slice(end), start + text.length);
      const node = el();
      requestAnimationFrame(() => node?.setSelectionRange(start + text.length, start + text.length));
      let current = text;
      return (replacement) => {
        const { v: now } = read();
        const at = now.indexOf(current, Math.max(0, start - 2));
        if (at < 0) return;
        write(now, now.slice(0, at) + replacement + now.slice(at + current.length), at + replacement.length);
        current = replacement;
      };
    },
  };
}

/**
 * Speak, and the words land at the cursor. Short dictation is one take, sent when you stop; long
 * dictation (`long`) is cut at pauses and each piece is transcribed and inserted while you keep
 * talking, in order.
 */
export function useDictation({ target, scene = null, long = false, session, onText }: { target: DictationTarget | null; scene?: string | null; long?: boolean; session?: string; onText?: (r: DictateResponse) => void }) {
  const { project, toast, fail } = useApp();
  const [state, setState] = useState<DictationState>('idle');
  const [level, setLevel] = useState(0);
  const rec = useRef<Recorder | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // The recorder handing over its last piece: a second stop must wait for it to be queued too.
  const stopping = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const ready = !!project?.dictation?.ready;

  const send = useCallback(
    (wav: Blob) => {
      pending.current++;
      const audio = blobToBase64(wav);
      // Transcribe in order, so a later piece never lands before an earlier one.
      chain.current = chain.current.then(async () => {
        try {
          const t = targetRef.current;
          if (!t) return;
          const { before, after } = t.context();
          const r = await post<DictateResponse>('/dictate', { audio: await audio, before, after, scene, ...(session ? { session } : {}) });
          if (!r.text) return;
          const swap = t.insert(r.text);
          onTextRef.current?.(r);
          if (r.flags.length)
            toast({ kind: 'warning', message: 'Kept your words as you said them', detail: `The tidy-up ${r.flags.join('; ')}.` });
          else if (r.raw && r.level !== 'verbatim' && r.raw.trim() !== r.text.trim())
            toast({ kind: 'info', message: 'Dictation tidied', detail: r.raw, action: { label: 'Use what I said', run: () => swap(rawJoin(r.raw, before)) } });
        } catch (e) {
          fail('Dictation failed')(e);
        } finally {
          if (--pending.current === 0 && !rec.current) setState('idle');
        }
      });
    },
    [scene, session, toast, fail],
  );

  const start = useCallback(async () => {
    // A take still being tidied finishes first; a second capture would interleave with it.
    if (rec.current || pending.current || !ready) return;
    if (!Recorder.supported()) return fail('Dictation unavailable')(new Error('This window cannot use a microphone.'));
    const r = new Recorder({ onLevel: setLevel, ...(long ? { onSegment: (wav) => send(wav) } : {}) });
    rec.current = r;
    setState('listening');
    try {
      await r.start();
    } catch (e) {
      rec.current = null;
      setState('idle');
      fail('Could not use the microphone')(e instanceof DOMException && e.name === 'NotAllowedError' ? new Error('Microphone access was refused. Allow it for Quillgon in your system settings.') : e);
    }
  }, [ready, long, send, fail]);

  /** Stop listening, and resolve once every piece said so far has landed in the target. */
  const stop = useCallback(async () => {
    const r = rec.current;
    if (r) {
      rec.current = null;
      // Out of "listening" at once, so a second click cannot start another capture mid-flush.
      setState('tidying');
      const settle = () => void (!pending.current && setState('idle'));
      stopping.current = r.stop().then((last) => (last ? send(last.wav) : settle()), settle);
    }
    await stopping.current;
    await chain.current;
  }, [send]);

  const toggle = useCallback(() => (rec.current ? stop() : pending.current ? undefined : start()), [start, stop]);
  useEffect(() => () => void rec.current?.stop(), []);
  return { state, level, start, stop, toggle, ready, reason: project?.dictation?.reason, local: !!project?.dictation?.local };
}

/** Undoing the tidy-up puts back the words as said, joined to the text before. */
function rawJoin(raw: string, before: string) {
  const t = raw.trim();
  return (before && !/\s$/.test(before) ? ' ' : '') + t;
}

export type Dictation = ReturnType<typeof useDictation>;

/** The record button: a red pill with a level meter while listening. */
export function MicButton({ dictation, label = 'Dictate', hint, compact }: { dictation: Dictation; label?: string; hint?: string; compact?: boolean }) {
  const { state, level, toggle, ready, reason, local } = dictation;
  const tip = !ready ? reason ?? 'Set up a speech recogniser in Settings → Voice' : state === 'listening' ? 'Stop and insert' : `${label}${hint ? ` (${hint})` : ''}${local ? ' · stays on this computer' : ''}`;
  return (
    <Tooltip label={tip}>
      <button
        type="button"
        className={cx('btn sm mic', state !== 'idle' && 'on', compact && 'icon')}
        aria-pressed={state === 'listening'}
        aria-label={state === 'listening' ? 'Stop dictating' : label}
        disabled={!ready || state === 'tidying'}
        onClick={toggle}
      >
        {state === 'tidying' ? <Loader2 className="spin" /> : state === 'listening' ? <Square /> : <Mic />}
        {state === 'listening' && <span className="mic-level" aria-hidden style={{ '--level': level } as React.CSSProperties} />}
        {!compact && <span>{state === 'listening' ? 'Listening' : state === 'tidying' ? 'Tidying' : label}</span>}
      </button>
    </Tooltip>
  );
}

/** Hold a key combination to talk (Alt+D by default): press starts, releasing either key stops. */
export function useHoldToTalk(d: Dictation, enabled = true, code = 'KeyD') {
  // The dictation object changes every render; the listeners must survive that mid-hold.
  const ref = useRef(d);
  ref.current = d;
  useEffect(() => {
    if (!enabled) return;
    let holding = false;
    const down = (e: KeyboardEvent) => {
      if (e.code !== code || !e.altKey || e.repeat || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      holding = true;
      ref.current.start();
    };
    const up = (e: KeyboardEvent) => {
      if (!holding || (e.code !== code && e.key !== 'Alt')) return;
      holding = false;
      ref.current.stop();
    };
    const blur = () => {
      if (holding) (holding = false), ref.current.stop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled, code]);
}
