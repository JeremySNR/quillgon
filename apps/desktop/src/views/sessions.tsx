import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, CircleDot, Clock, EyeOff, HeartHandshake, MessageCircleQuestion, Mic, Play, SendHorizontal, SkipForward, Square, Undo2, UserRound, X } from 'lucide-react';
import { audioUrl, get, post, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Question, Session, Story } from '../lib/types';
import { cx, plural } from '../lib/util';
import { Badge, Button, Field, Segmented, Working } from '../components/ui';
import { fieldTarget, MicButton, useDictation, type DictateResponse } from '../components/dictate';
import { LADDER } from '@quillgon/core/schemas';
import { RUNG_LABEL, enoughForScene } from '@quillgon/core/life';

/**
 * Sessions: interviews with the ghostwriter. With no session running, the queue of questions it
 * wants to ask and the sessions so far; in a session, the agenda, the conversation, and the story
 * being drawn out with what each answer filed.
 */
export function Sessions({ id }: { id?: string }) {
  const { project: p, go, job } = useApp();
  const life = p?.life;
  const active = life?.sessions.find((s) => !s.ended);
  const showing = id ?? active?.id;
  if (!p || !life) return null;
  if (showing) return <SessionView key={showing} id={showing} />;
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Sessions</h1>
            <p className="sub">Your ghostwriter interviews you, a few questions at a time, and files what you say under the stories it belongs to. Talk or type; stop whenever you like.</p>
          </div>
        </div>
        <div className="sessions-grid">
          <div className="stack lg">
            <StartCard onStarted={(s) => go('sessions', s.id)} start={(body) => job<Session>('/sessions/start', body, 'Planning the session')} />
            <QuestionQueue questions={life.questions} />
          </div>
          <div className="stack">
            <h3 className="section-title">Sessions so far</h3>
            {life.sessions.length ? (
              <div className="list">
                {life.sessions.map((s) => (
                  <button key={s.id} className="list-item" onClick={() => go('sessions', s.id)}>
                    <Clock size={15} className="faint" />
                    <span className="grow">
                      <div className="primary-text serif">{s.title || 'Session'}</div>
                      <div className="secondary-text">{s.summary || `${s.turns} turns`}</div>
                    </span>
                    <span className="end faint">{new Date(s.started).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">None yet. The first session starts with the shape of the life: its chapters, and who the book is for.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StartCard({ start, onStarted }: { start: (body: unknown) => Promise<Session>; onStarted: (s: Session) => void }) {
  const { project: p } = useApp();
  const [minutes, setMinutes] = useState(p!.book.life.session_minutes);
  const [who, setWho] = useState<'narrator' | 'other'>('narrator');
  const [speaker, setSpeaker] = useState('');
  const [busy, setBusy] = useState(false);
  const narrator = p!.characters.find((c) => c.id === p!.book.life.narrator)?.bio.name ?? 'you';
  return (
    <div className="card stack">
      <div className="card-head">
        <Mic size={16} />
        <h3 className="grow">Start a session</h3>
        <span className="faint">{p!.dictation.ready ? (p!.dictation.local ? 'Voice stays on this computer' : 'Voice transcribed by OpenAI') : 'Typing only: no recogniser set up'}</span>
      </div>
      <div className="grid-2">
        <Field label="How long">
          <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                About {m} minutes
              </option>
            ))}
          </select>
        </Field>
        <Field label="Who is answering?">
          <Segmented value={who} options={[{ value: 'narrator', label: p!.book.life.subject === 'self' ? 'Me' : narrator }, { value: 'other', label: 'Someone else' }]} onChange={setWho} />
        </Field>
      </div>
      {who === 'other' && (
        <Field label="Their name" hint="What they say is kept as their version of each story, never merged into the narrator's memory.">
          <input className="input" value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="Peter" />
        </Field>
      )}
      <div>
        <Button
          variant="primary"
          icon={<Play />}
          disabled={busy || (who === 'other' && !speaker.trim())}
          onClick={async () => {
            setBusy(true);
            try {
              onStarted(await start({ minutes, speaker: who === 'other' ? speaker.trim() : '' }));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Planning…' : 'Start'}
        </Button>
      </div>
    </div>
  );
}

function QuestionQueue({ questions }: { questions: Question[] }) {
  const { project: p, refresh, fail } = useApp();
  const name = (id: string) => p!.characters.find((c) => c.id === id)?.bio.name ?? id;
  const mine = questions.filter((q) => q.status === 'queued' && !q.ask).sort((a, b) => a.priority - b.priority);
  const others = questions.filter((q) => q.status === 'queued' && q.ask);
  const set = (id: string, patch: Partial<Question>) =>
    put('/questions', { questions: questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) })
      .then(refresh)
      .catch(fail('Could not update the question'));
  return (
    <div className="card stack">
      <div className="card-head">
        <MessageCircleQuestion size={16} />
        <h3 className="grow">What your ghostwriter wants to ask</h3>
        <span className="faint">{plural(mine.length, 'question')}</span>
      </div>
      {mine.length === 0 && <p className="muted">Nothing queued. Each session adds questions from the gaps it finds.</p>}
      <ul className="question-list">
        {mine.slice(0, 8).map((q) => (
          <li key={q.id}>
            <div className="grow">
              <div>{q.text}</div>
              {q.why && <div className="faint small">{q.why}</div>}
            </div>
            <Button size="sm" variant="ghost" tip="Not now" iconOnly icon={<Clock />} onClick={() => set(q.id, { status: 'parked' })} />
            <Button size="sm" variant="ghost" tip="Never ask this" iconOnly icon={<X />} onClick={() => set(q.id, { status: 'off-limits' })} />
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <>
          <h4 className="eyebrow">To ask someone else</h4>
          <ul className="question-list">
            {others.map((q) => (
              <li key={q.id}>
                <UserRound size={14} className="faint" />
                <div className="grow">
                  <strong>{name(q.ask)}:</strong> {q.text}
                </div>
                <Button size="sm" variant="ghost" tip="Done" iconOnly icon={<CheckCircle2 />} onClick={() => set(q.id, { status: 'answered' })} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ a session

type Heard = { raw: string[]; audio: string[]; seconds: number };
const NOTHING_HEARD: Heard = { raw: [], audio: [], seconds: 0 };

function SessionView({ id }: { id: string }) {
  const { project: p, go, job, refresh, fail } = useApp();
  const [s, setS] = useState<Session | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  // What dictation heard for the answer being composed. A ref, not state: send reads it right
  // after the last piece lands, before React has rendered.
  const heard = useRef<Heard>(NOTHING_HEARD);
  const sending = useRef(false);
  const putText = useCallback((v: string) => {
    textRef.current = v;
    setText(v);
  }, []);
  const log = useRef<HTMLDivElement>(null);

  const load = useCallback(() => get<Session>(`/sessions/${id}`).then(setS, fail('Could not load the session')), [id, fail]);
  useEffect(() => void load(), [load]);
  useEffect(() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }), [s?.turns.length, pending]);

  const onText = useCallback((r: DictateResponse) => {
    const h = heard.current;
    heard.current = { raw: [...h.raw, r.raw], audio: r.audio ? [...h.audio, r.audio] : h.audio, seconds: h.seconds + r.seconds };
  }, []);
  const ended = !!s?.ended;
  const target = useMemo(() => fieldTarget(() => inputRef.current, () => textRef.current, putText), [putText]);
  const dictation = useDictation({ target: ended ? null : target, long: true, session: id, onText });

  const send = async (signal: string | null = null) => {
    // A ref, not `pending`: a second Enter while the last words are still landing must not send twice.
    if (sending.current || !s) return;
    sending.current = true;
    try {
      // Everything said before pressing send is part of the answer: wait for the last piece to land.
      await dictation.stop();
      const message = textRef.current.trim();
      if (message || signal) await answer(message, signal);
    } finally {
      sending.current = false;
    }
  };
  const answer = async (message: string, signal: string | null) => {
    setPending(message || SIGNALS.find((x) => x.signal === signal)?.label || '');
    putText('');
    const h = heard.current;
    heard.current = NOTHING_HEARD;
    try {
      setS(await job<Session>(`/sessions/${id}/answer`, { text: message, signal, raw: h.raw.join(' ') || null, audio: h.audio, seconds: h.seconds }, 'The ghostwriter'));
    } catch {
      putText(message); // nothing said is lost to a failed call
      heard.current = h;
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };
  const undo = (turn: number) => post<Session>(`/sessions/${id}/undo`, { turn }).then((x) => (setS(x), refresh()), fail('Could not undo'));
  const end = async () => {
    await dictation.stop();
    setS(await job<Session>(`/sessions/${id}/end`, {}, 'Closing the session'));
  };

  if (!p?.life) return null;
  if (!s) return <div className="page"><div className="page-inner"><Working fallback="Opening the session" /></div></div>;
  const lastAsk = [...s.turns].reverse().find((t) => t.role === 'ghostwriter');
  const story = lastAsk?.story ? p.life.stories.find((x) => x.id === lastAsk.story) ?? null : null;
  const lastFiled = [...s.turns.entries()].reverse().find(([, t]) => t.role === 'ghostwriter' && t.changes.length && !t.undone);
  const name = (cid: string) => p.characters.find((c) => c.id === cid)?.bio.name ?? cid;

  return (
    <div className="session-page">
      <aside className="session-agenda">
        <button className="link faint small" onClick={() => go('sessions')}>
          ← All sessions
        </button>
        <h2 className="serif">{s.title || 'Session'}</h2>
        <div className="eyebrow">
          {ended ? `Ended ${new Date(s.ended!).toLocaleString()}` : `Today · about ${s.minutes} min`}
          {s.speaker ? ` · with ${s.speaker}` : ''}
        </div>
        <ol className="agenda">
          {s.agenda.map((a, i) => (
            <li key={i} className={cx(a.done && 'done', !a.done && s.agenda.findIndex((x) => !x.done) === i && 'now')}>
              {a.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
              <div>
                <div className="agenda-topic">{a.topic}</div>
                {a.why && <div className="faint small">{a.why}</div>}
              </div>
            </li>
          ))}
        </ol>
        {ended && s.summary && <p className="session-summary">{s.summary}</p>}
      </aside>

      <section className="session-talk">
        <div className="session-log" ref={log} aria-live="polite">
          {s.turns.map((t, i) =>
            t.role === 'ghostwriter' ? (
              <div key={i} className="gw-turn">
                <span className="gw-avatar" aria-hidden>
                  GW
                </span>
                <div>
                  <div className="gw-text">{t.text}</div>
                  {(t.technique || t.why) && (
                    <div className="faint small" title={t.why}>
                      {t.technique}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div key={i} className={cx('author-turn', t.off_record && 'off')}>
                {t.audio.map((a, k) => (
                  <audio key={a} controls preload="none" src={audioUrl(s.id, a)} aria-label={t.audio.length > 1 ? `Your recording, part ${k + 1} of ${t.audio.length}` : 'Your recording'} />
                ))}
                <div>{t.off_record ? <em className="faint">Off the record.</em> : t.text}</div>
                {t.seconds > 0 && <div className="faint small">{Math.round(t.seconds)} s recorded</div>}
              </div>
            ),
          )}
          {pending && (
            <>
              <div className="author-turn pending">{pending}</div>
              <div className="gw-turn">
                <span className="gw-avatar" aria-hidden>
                  GW
                </span>
                <div className="typing" role="status" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </>
          )}
        </div>
        {!ended ? (
          <div className="session-composer">
            <textarea
              ref={inputRef}
              className="textarea"
              rows={3}
              value={text}
              aria-label="Your answer"
              placeholder="Talk (press the microphone) or type your answer…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="row wrap">
              <MicButton dictation={dictation} label="Talk" />
              <span className="grow" />
              {SIGNALS.map((x) => (
                <Button key={x.signal} size="sm" variant="ghost" icon={x.icon} onClick={() => send(x.signal)} disabled={!!pending} tip={x.tip}>
                  {x.label}
                </Button>
              ))}
              <Button variant="primary" size="sm" icon={<SendHorizontal />} onClick={() => send()} disabled={!text.trim() || !!pending}>
                Send
              </Button>
            </div>
            <div className="row">
              <span className="faint small grow">Enter to send. Your words are filed as you said them; anything off the record is never used.</span>
              <Button size="sm" icon={<Square />} onClick={end} disabled={!!pending}>
                End session
              </Button>
            </div>
          </div>
        ) : (
          <div className="session-composer">
            <Button variant="primary" icon={<Play />} onClick={() => go('sessions')}>
              Back to sessions
            </Button>
          </div>
        )}
      </section>

      <aside className="session-side">
        {story ? <StoryLadder story={story} name={name} /> : <p className="muted small">When the conversation settles on a memory, it shows here, with how far it has been drawn out.</p>}
        {lastFiled && (
          <div className="card stack filed">
            <div className="card-head">
              <h3 className="grow">Filed from your last answer</h3>
            </div>
            <ul className="filed-list">
              {lastFiled[1].changes.map((c, k) => (
                <li key={k}>{c.label}</li>
              ))}
            </ul>
            {!ended && (
              <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => undo(lastFiled[0])}>
                Undo
              </Button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

const SIGNALS = [
  { signal: 'dont-remember', label: 'That’s all I remember', icon: <SkipForward />, tip: 'Move on from this story; nothing more is asked about it today' },
  { signal: 'move-on', label: 'Move on', icon: <SkipForward />, tip: 'Next topic' },
  { signal: 'off-record', label: 'Off the record', icon: <EyeOff />, tip: 'Say it, and nothing from it is filed or used' },
  { signal: 'hard', label: 'This is hard', icon: <HeartHandshake />, tip: 'Marks the story sensitive; the ghostwriter stops asking about it' },
] as const;

/** How far a story has been drawn out: a gist is not a scene. */
export function StoryLadder({ story, name }: { story: Story; name: (id: string) => string }) {
  const enough = enoughForScene(story);
  return (
    <div className="card stack ladder-card">
      <div>
        <div className="ladder-title">{story.title}</div>
        <div className="faint small">{[story.when, story.place, story.people.map(name).join(', ')].filter(Boolean).join(' · ')}</div>
      </div>
      <ul className="ladder">
        {LADDER.map((r) => (
          <li key={r} className={story.ladder[r]}>
            {story.ladder[r] === 'yes' ? <CheckCircle2 size={14} /> : story.ladder[r] === 'some' ? <CircleDot size={14} /> : <Circle size={14} />}
            {RUNG_LABEL[r]}
          </li>
        ))}
      </ul>
      {enough && <Badge kind="success">Enough for a scene</Badge>}
      {story.sensitive && <Badge kind="warning">Sensitive: kept out of drafts until you say</Badge>}
      {story.quotes.length > 0 && (
        <div className="stack">
          <div className="eyebrow">Kept word for word</div>
          {story.quotes.map((q, i) => (
            <blockquote key={i} className="verbatim">
              “{q.text}”{q.who && <span className="faint small"> · {name(q.who)}</span>}
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
