import { useMemo, useRef, useState } from 'react';
import { Check, Clock, MessageSquareText, Wand2, X } from 'lucide-react';
import { post } from '../lib/api';
import { useApp } from '../lib/app';
import type { MarginNote } from '../lib/types';
import { cx } from '../lib/util';
import { Badge, Button } from './ui';
import { fieldTarget, MicButton, useDictation } from './dictate';

export const NOTE_KIND: Record<MarginNote['kind'], { label: string; badge: 'accent' | 'info' | 'warning' | 'outline' | 'danger' }> = {
  gap: { label: 'Gap', badge: 'accent' },
  versions: { label: 'Two versions', badge: 'info' },
  thin: { label: 'Thin', badge: 'warning' },
  voice: { label: 'Voice', badge: 'outline' },
  source: { label: 'No source', badge: 'danger' },
};

/**
 * The ghostwriter's margin notes on a draft: gaps it refused to fill, tellings that disagree,
 * thin passages, choices about the author's voice, and sentences nothing the author said covers.
 * Answer by typing or talking; "later" turns a note into a question for the next session.
 */
export function NotesPanel({ scene, notes, onJump, onChanged, footer }: { scene: string; notes: MarginNote[]; onJump: (quote: string) => void; onChanged: () => void; footer?: React.ReactNode }) {
  const [showDone, setShowDone] = useState(false);
  const open = notes.filter((n) => n.status === 'open');
  const done = notes.filter((n) => n.status !== 'open');
  return (
    <aside className="notes-pane" aria-label="Margin notes">
      <div className="inspector-title">
        <span className="row">
          <MessageSquareText size={14} /> Notes from your ghostwriter
        </span>
        <Badge kind={open.length ? 'warning' : 'success'}>{open.length ? `${open.length} open` : 'All answered'}</Badge>
      </div>
      <div className="notes-list">
        {open.map((n) => (
          <NoteCard key={n.id} scene={scene} note={n} onJump={onJump} onChanged={onChanged} />
        ))}
        {!open.length && <p className="muted small">Nothing waiting on you in this scene.</p>}
        {done.length > 0 && (
          <button className="link faint small" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} {done.length} answered
          </button>
        )}
        {showDone && done.map((n) => <NoteCard key={n.id} scene={scene} note={n} onJump={onJump} onChanged={onChanged} />)}
      </div>
      {footer && <div className="notes-footer">{footer}</div>}
    </aside>
  );
}

function NoteCard({ scene, note, onJump, onChanged }: { scene: string; note: MarginNote; onJump: (quote: string) => void; onChanged: () => void }) {
  const { fail } = useApp();
  const [answer, setAnswer] = useState(note.answer);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const dictation = useDictation({ target: useMemo(() => fieldTarget(() => ref.current, () => answerRef.current, setAnswer), []), long: true });
  const save = async (patch: { answer?: string; status?: MarginNote['status'] }) => {
    setBusy(true);
    try {
      await post(`/scenes/${scene}/notes/${note.id}`, patch);
      onChanged();
    } catch (e) {
      fail('Could not save the answer')(e);
    } finally {
      setBusy(false);
    }
  };
  const k = NOTE_KIND[note.kind];
  const closed = note.status !== 'open';
  return (
    <div className={cx('note-card', closed && 'closed')}>
      <div className="row">
        <Badge kind={k.badge}>{k.label}</Badge>
        {note.status === 'later' && <span className="faint small">Next session</span>}
        {note.status === 'dismissed' && <span className="faint small">Dismissed</span>}
      </div>
      {note.quote && (
        <button className="note-quote" onClick={() => onJump(note.quote)} title="Show in the text">
          {note.quote.length > 120 ? `${note.quote.slice(0, 118)}…` : note.quote}
        </button>
      )}
      <p className="note-text">{note.text}</p>
      {closed ? (
        note.answer && <p className="note-answer">{note.answer}</p>
      ) : (
        <>
          {note.options.length > 0 && (
            <div className="btn-row">
              {note.options.map((o) => (
                <Button key={o} size="sm" onClick={() => save({ answer: o, status: 'answered' })} disabled={busy}>
                  {o}
                </Button>
              ))}
            </div>
          )}
          <textarea ref={ref} className="textarea" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Tell me, or talk…" aria-label="Your answer" />
          <div className="btn-row">
            <MicButton dictation={dictation} label="Talk" compact />
            <Button size="sm" variant="primary" icon={<Check />} disabled={!answer.trim() || busy} onClick={() => save({ answer, status: 'answered' })}>
              Answer
            </Button>
            <Button size="sm" variant="ghost" icon={<Clock />} disabled={busy} onClick={() => save({ status: 'later' })} tip="Ask me in the next session">
              Later
            </Button>
            <Button size="sm" variant="ghost" iconOnly icon={<X />} disabled={busy} onClick={() => save({ status: 'dismissed' })} tip="Leave it as it is" />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Say what is wrong in your own words ("too posh", "Dad wasn't like that"); the ghostwriter reads
 * back a plan and proposes changes passage by passage, using your answers to the notes too.
 */
export function ReviseBox({ scene }: { scene: string }) {
  const { project: p, job, go, refresh } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const dictation = useDictation({ target: useMemo(() => fieldTarget(() => ref.current, () => textRef.current, setText), []), long: true });
  const chapter = p?.structure.acts.flatMap((a) => a.chapters).find((c) => c.scenes.includes(scene));
  if (!chapter || p?.book.life.pen === 'interviewer') return null;
  const revise = async () => {
    setBusy(true);
    try {
      await job(`/life/chapters/${chapter.id}/revise`, { feedback: text }, 'Revising');
      await refresh();
      go('revision', chapter.id);
    } catch {
      // reported by job()
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="eyebrow">Anything else about this chapter?</div>
      <textarea ref={ref} className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="It’s too posh. Dad wasn’t like that…" aria-label="What to change" />
      <div className="btn-row">
        <MicButton dictation={dictation} label="Talk" compact />
        <Button size="sm" variant="primary" icon={<Wand2 />} disabled={busy} onClick={revise}>
          {busy ? 'Revising…' : text.trim() ? 'Revise' : 'Revise with my answers'}
        </Button>
      </div>
    </>
  );
}
