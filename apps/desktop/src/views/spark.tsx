import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowRight, Check, Eraser, Lightbulb, MessageCircle, MessagesSquare, Plus, RefreshCw, SendHorizontal, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert, Undo2, Users, X } from 'lucide-react';
import { post } from '../lib/api';
import { useApp } from '../lib/app';
import type { IdeaBoard, IdeaItem } from '../lib/types';
import { cx, plural } from '../lib/util';
import { Avatar, Badge, Button, Empty, Field, ListEditor, Segmented, Working } from '../components/ui';
import { fieldTarget, MicButton, useDictation } from '../components/dictate';

const KIND: Record<IdeaItem['kind'], string> = {
  'what-if': 'What if',
  logline: 'Logline',
  character: 'Character',
  setting: 'Setting',
  twist: 'Twist',
  theme: 'Theme',
  image: 'Image',
  note: 'Note',
};

type Step = 'logline' | 'paragraph' | 'synopsis';
const LADDER: { step: Step; title: string; hint: string }[] = [
  { step: 'logline', title: 'One sentence', hint: 'Who wants what, and what stands in the way.' },
  { step: 'paragraph', title: 'One paragraph', hint: 'Setup, three disasters, ending.' },
  { step: 'synopsis', title: 'One page', hint: 'The whole story, beginning to end.' },
];

const FOCUS: Record<string, string> = {
  seed: 'the seed',
  genre: 'the genre',
  logline: 'the one-sentence version',
  paragraph: 'the paragraph',
  synopsis: 'the one-page version',
  cast: 'the cast',
  tone: 'the tone',
  ending: 'the ending',
  themes: 'the themes',
  never: 'what it must never do',
  open: 'the open questions',
};

const clip = (t: string, n = 44) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

function focusLabel(focus: string, board: IdeaBoard): string {
  const [kind, id] = focus.split(/:(.*)/s);
  if (kind === 'cast') return board.cast.find((c) => c.id === id)?.name ?? id;
  if (kind === 'idea') return `“${clip(board.pile.find((i) => i.id === id)?.text ?? id)}”`;
  return FOCUS[focus] ?? focus;
}

/** A small button that points the thinking partner at one part of the board. */
function TalkAbout({ onTalk }: { onTalk: () => void }) {
  return <Button size="sm" variant="ghost" iconOnly icon={<MessageCircle />} tip="Talk about this" onClick={onTalk} />;
}

/**
 * Idea → premise. Models drift to the same stories; this step asks several different minds
 * for ideas, shows the least typical first, flags clichés, and lets the author keep or bin
 * each one before the premise is grown one level at a time. Beside the board, a thinking
 * partner talks the idea through and writes what is said and settled onto the board as it
 * goes; the parts it just changed light up, and every turn can be undone.
 */
export function IdeaStep({ job }: { job: any }) {
  const { project: p, job: run, refresh, go, toast } = useApp();
  const [board, setBoard] = useState<IdeaBoard>(p!.idea);
  const [seed, setSeed] = useState(p!.idea.seed);
  const [genre, setGenre] = useState(p!.idea.genre);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'new' | 'kept' | 'discarded'>('new');
  const [own, setOwn] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setBoard(p!.idea), [p!.idea]);
  // The partner can write the seed and genre too.
  useEffect(() => setSeed(board.seed), [board.seed]);
  useEffect(() => setGenre(board.genre), [board.genre]);

  // What the latest reply wrote, so those parts of the board can light up.
  const fresh = useMemo(() => {
    const last = [...board.talk].reverse().find((t) => t.role === 'partner');
    return new Set(last && !last.undone ? last.changes.map((c) => c.path) : []);
  }, [board.talk]);
  const lit = (...paths: string[]) => (paths.some((x) => fresh.has(x)) ? 'just-changed' : undefined);
  const talkAbout = (f: string) => {
    setFocus(f);
    composer.current?.focus();
  };
  const update = (patch: Partial<IdeaBoard>) => post<IdeaBoard>('/idea/update', { patch }).then(setBoard);
  // A seed or genre typed but not yet used is saved before the partner reads the board.
  const saveSpark = async () => {
    if (seed !== board.seed || genre !== board.genre) setBoard(await post<IdeaBoard>('/idea/start', { seed, genre }));
  };

  const act = async (what: string, fn: () => Promise<IdeaBoard>) => {
    setBusy(what);
    try {
      setBoard(await fn());
    } finally {
      setBusy(null);
    }
  };
  const diverge = () =>
    act('diverge', async () => {
      if (seed !== board.seed || genre !== board.genre) await post('/idea/start', { seed, genre });
      const b = await run<IdeaBoard>('/idea/diverge', {}, 'Ideas');
      setFilter('new');
      return b;
    });
  const mark = (id: string, status: IdeaItem['status']) => post<IdeaBoard>('/idea/mark', { id, status }).then(setBoard);
  const addOwn = async () => {
    if (!own.trim()) return;
    setBoard(await post<IdeaBoard>('/idea/own', { text: own }));
    setOwn('');
  };
  const expand = (step: Step | 'cast') => act(step, () => run<IdeaBoard>('/idea/expand', { step }, step === 'cast' ? 'Cast' : 'Premise'));
  const choose = (step: Step, text: string) => post<IdeaBoard>('/idea/choose', { step, text }).then(setBoard);
  const finish = async () => {
    await post('/idea/finish');
    toast({ kind: 'success', message: 'Premise ready', detail: 'Your premise, kept ideas and cast are in the intent. The interviewer only asks what is missing.' });
    await refresh();
    go('build', 'intent');
  };
  const skip = async () => {
    await post('/idea/skip');
    await refresh();
    go('build', 'intent');
  };

  const counts = { new: board.pile.filter((i) => i.status === 'new').length, kept: board.pile.filter((i) => i.status === 'kept').length, discarded: board.pile.filter((i) => i.status === 'discarded').length };
  const shown = board.pile.filter((i) => i.status === filter);
  const ready = !!board.logline;
  const settled = !!(board.tone || board.ending || board.themes.length || board.never.length || board.open.length);
  const started = board.pile.length > 0 || board.talk.length > 0 || !!board.logline || board.cast.length > 0 || settled;

  return (
    <div className="idea-layout">
      <div className="stack lg">
        <div className="card">
          <div className="card-head">
            <h3>Start with a spark</h3>
            <span className="grow" />
            <Button variant="ghost" size="sm" onClick={skip}>
              I already have a premise
            </Button>
          </div>
          <div className={cx('grid-2', lit('seed', 'genre'))} style={{ gridTemplateColumns: '1fr 220px' }}>
            <Field label="Seed" hint="A line, an image, a what-if, a person. Unfinished is good. Or just start talking.">
              <textarea className="textarea prose" rows={3} value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="A harbourmaster drowns on a flat-calm night, and his tide ledger records a storm." />
            </Field>
            <Field label="Genre" hint="Optional. Names the clichés to avoid.">
              <input className="input" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Literary mystery" />
            </Field>
          </div>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <Button variant="primary" icon={<Sparkles />} onClick={diverge} disabled={!seed.trim() || !!busy}>
              {board.pile.length ? 'More ideas' : 'Show me ideas'}
            </Button>
            <span className="faint" style={{ fontSize: 'var(--fs-label)' }}>
              Four different minds answer at once. The least typical ideas come first.
            </span>
          </div>
        </div>

        {busy === 'diverge' && <Working job={job} fallback="Asking four different minds" />}

        {board.cliches.length > 0 && (
          <div className="banner cliche-banner">
            <TriangleAlert size={16} />
            <div>
              <strong>Steering away from</strong>
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                {board.cliches.slice(0, 10).map((c) => (
                  <span key={c} className="cliche">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {started && (
          <div className="card">
            <div className="card-head">
              <h3>Ideas</h3>
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'new', label: `To sort · ${counts.new}` },
                  { value: 'kept', label: `Kept · ${counts.kept}` },
                  { value: 'discarded', label: `Binned · ${counts.discarded}` },
                ]}
              />
            </div>
            {shown.length ? (
              <div className="idea-grid">
                {shown.map((i) => (
                  <IdeaCard key={i.id} idea={i} onMark={(s) => mark(i.id, s)} onTalk={() => talkAbout(`idea:${i.id}`)} className={lit(`idea:${i.id}`)} />
                ))}
              </div>
            ) : (
              <p className="muted">{!board.pile.length ? 'No ideas yet. Ask for some above, add your own, or talk it through.' : filter === 'new' ? 'All sorted. Ask for more, or grow the premise below.' : 'Nothing here yet.'}</p>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <input className="input grow" value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOwn()} placeholder="Add an idea of your own. Yours always count as kept." />
              <Button icon={<Plus />} onClick={addOwn} disabled={!own.trim()}>
                Add
              </Button>
            </div>
          </div>
        )}

        {started && (
          <div className="card">
            <div className="card-head">
              <h3>What you’ve settled</h3>
              <span className="muted">Goes into the intent with your premise. Edit anything.</span>
            </div>
            <div className="stack lg">
              <div className="grid-2">
                <div className={lit('tone')}>
                  <Field label={<FieldHead label="Tone" onTalk={() => talkAbout('tone')} />}>
                    <SettledText value={board.tone} placeholder="How it should feel to read" onSave={(tone) => update({ tone })} />
                  </Field>
                </div>
                <div className={lit('ending')}>
                  <Field label={<FieldHead label="Ending" onTalk={() => talkAbout('ending')} />}>
                    <SettledText value={board.ending} placeholder="How it ends, and what that costs" onSave={(ending) => update({ ending })} />
                  </Field>
                </div>
              </div>
              <div className="grid-2">
                <div className={lit('themes')}>
                  <Field label={<FieldHead label="Themes" onTalk={() => talkAbout('themes')} />}>
                    <SettledList items={board.themes} placeholder="Add theme" onSave={(themes) => update({ themes })} />
                  </Field>
                </div>
                <div className={lit('never')}>
                  <Field label={<FieldHead label="Never" onTalk={() => talkAbout('never')} />} hint="Each one becomes a hard rule every agent must keep.">
                    <SettledList items={board.never} placeholder="Add something it must never do" onSave={(never) => update({ never })} />
                  </Field>
                </div>
              </div>
              <div className={lit('open')}>
                <Field label={<FieldHead label="Still open" onTalk={() => talkAbout('open')} />} hint="Questions raised and not yet answered. Remove one once it is settled.">
                  <SettledList items={board.open} placeholder="Add a question" onSave={(open) => update({ open })} />
                </Field>
              </div>
            </div>
          </div>
        )}

        {started && (
          <div className="card">
            <div className="card-head">
              <h3>Grow the premise</h3>
              <span className="muted">One level at a time, from what you kept. Pick one option or rewrite it.</span>
            </div>
            <ol className="ladder">
              {LADDER.map(({ step, title, hint }, n) => {
                const options = board[`${step}_options`];
                const chosen = board[step];
                const prevChosen = n === 0 ? counts.kept > 0 || board.talk.length > 0 : !!board[LADDER[n - 1].step];
                return (
                  <li key={step} className={cx('rung', chosen && 'done', !prevChosen && !chosen && 'locked', lit(step))}>
                    <div className="rung-head">
                      <span className="rung-dot">{chosen ? <Check size={13} /> : n + 1}</span>
                      <div className="grow">
                        <div className="rung-title">{title}</div>
                        <div className="faint" style={{ fontSize: 'var(--fs-label)' }}>{hint}</div>
                      </div>
                      <TalkAbout onTalk={() => talkAbout(step)} />
                      <Button size="sm" variant={chosen ? 'ghost' : 'default'} icon={options.length ? <RefreshCw /> : <Sparkles />} onClick={() => expand(step)} disabled={!prevChosen || !!busy}>
                        {options.length ? 'Other options' : 'Draft options'}
                      </Button>
                    </div>
                    {busy === step && <Working job={job} fallback={`Drafting ${title.toLowerCase()} options`} />}
                    {options.length > 0 && !chosen && (
                      <div className="stack" style={{ marginTop: 10 }}>
                        {options.map((o, k) => (
                          <button key={k} className="option-card" onClick={() => choose(step, o)}>
                            <span className="serif">{o}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {chosen && <ChosenText value={chosen} onSave={(t) => choose(step, t)} onClear={() => choose(step, '')} />}
                  </li>
                );
              })}
              <li className={cx('rung', board.cast.length > 0 && 'done', !board.synopsis && !board.cast.length && 'locked')}>
                <div className="rung-head">
                  <span className="rung-dot">{board.cast.length ? <Check size={13} /> : 4}</span>
                  <div className="grow">
                    <div className="rung-title">The people</div>
                    <div className="faint" style={{ fontSize: 'var(--fs-label)' }}>What each wants, what they need, the wound and the lie they believe.</div>
                  </div>
                  <TalkAbout onTalk={() => talkAbout('cast')} />
                  <Button size="sm" variant={board.cast.length ? 'ghost' : 'default'} icon={<Users />} onClick={() => expand('cast')} disabled={!board.synopsis || !!busy}>
                    {board.cast.length ? 'Recast' : 'Cast it'}
                  </Button>
                </div>
                {busy === 'cast' && <Working job={job} fallback="Casting" />}
                {board.cast.length > 0 && (
                  <div className="cast-grid">
                    {board.cast.map((c) => (
                      <div key={c.id} className={cx('cast-card', lit(`cast:${c.id}`))}>
                        <div className="row">
                          <Avatar id={c.id} name={c.name} />
                          <div className="grow">
                            <div style={{ fontWeight: 600 }}>{c.name}</div>
                            <div className="faint" style={{ fontSize: 'var(--fs-label)' }}>{c.role}</div>
                          </div>
                          <TalkAbout onTalk={() => talkAbout(`cast:${c.id}`)} />
                        </div>
                        <dl className="arc">
                          {c.want && (
                            <>
                              <dt>Wants</dt>
                              <dd>{c.want}</dd>
                            </>
                          )}
                          {c.need && (
                            <>
                              <dt>Needs</dt>
                              <dd>{c.need}</dd>
                            </>
                          )}
                          {c.wound && (
                            <>
                              <dt>Wound</dt>
                              <dd>{c.wound}</dd>
                            </>
                          )}
                          {c.lie && (
                            <>
                              <dt>Believes</dt>
                              <dd>{c.lie}</dd>
                            </>
                          )}
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            </ol>
            <div className="btn-row" style={{ marginTop: 18 }}>
              <Button variant="primary" icon={<ArrowRight />} onClick={finish} disabled={!ready}>
                Use this premise
              </Button>
              {!ready && <span className="faint" style={{ fontSize: 'var(--fs-label)' }}>Choose at least a one-sentence version first.</span>}
            </div>
          </div>
        )}

        {!started && busy !== 'diverge' && (
          <Empty icon={<Lightbulb />} title="Ideas first, decisions later">
            You sort; the machine only suggests. Ask for ideas, or talk it through with the thinking partner: what you settle is written here as you go. Nothing becomes part of the book until you grow it into a premise.
          </Empty>
        )}
      </div>
      <TalkPanel board={board} onBoard={setBoard} beforeSend={saveSpark} focus={focus} setFocus={setFocus} inputRef={composer} />
    </div>
  );
}

// ------------------------------------------------------------------ thinking partner

const STARTERS = [
  { label: 'I have a half-formed idea…', text: 'I have a half-formed idea: ', needsSeed: false },
  { label: 'Poke holes in it', text: 'Poke holes in what is on the board so far. Where is it weakest?', needsSeed: true },
  { label: 'Who should this happen to?', text: 'Who should this happen to, and why them?', needsSeed: true },
  { label: 'Help me find the ending', text: 'Help me find the ending.', needsSeed: true },
];

function TalkPanel({ board, onBoard, beforeSend, focus, setFocus, inputRef }: { board: IdeaBoard; onBoard: (b: IdeaBoard) => void; beforeSend: () => Promise<void>; focus: string | null; setFocus: (f: string | null) => void; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const { job: run } = useApp();
  const [text, setText] = useState('');
  const textRef = useRef(text);
  textRef.current = text;
  const putText = useCallback((v: string) => {
    textRef.current = v;
    setText(v);
  }, []);
  // Talk instead of typing: long takes are cut at pauses and land in the box as you go.
  const dictation = useDictation({ target: useMemo(() => fieldTarget(() => inputRef.current, () => textRef.current, putText), [inputRef, putText]), long: true });
  const [pending, setPending] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [board.talk.length, pending]);

  const sending = useRef(false);
  const send = async () => {
    // A ref, not `pending`: a second Enter while the last words are still landing must not send twice.
    if (sending.current) return;
    sending.current = true;
    try {
      // Everything said before pressing send is part of the message: wait for the last piece to land.
      await dictation.stop();
      const message = textRef.current.trim();
      if (message) await talk(message);
    } finally {
      sending.current = false;
    }
  };
  const talk = async (message: string) => {
    setPending(message);
    putText('');
    try {
      await beforeSend();
      onBoard(await run<IdeaBoard>('/idea/talk', { message, focus }, 'Thinking partner'));
      setFocus(null);
    } catch {
      putText(message); // Nothing typed is lost to a failed call.
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };
  const undo = (turn: number) => post<IdeaBoard>('/idea/talk/undo', { turn }).then(onBoard);
  const clear = () => post<IdeaBoard>('/idea/talk/clear').then(onBoard);
  const start = (t: string) => {
    setText(t);
    inputRef.current?.focus();
  };

  return (
    <aside className="card talk" aria-label="Thinking partner">
      <div className="talk-head">
        <MessagesSquare size={16} />
        <h3 className="grow">Thinking partner</h3>
        {board.talk.length > 0 && <Button size="sm" variant="ghost" iconOnly icon={<Eraser />} tip="Clear the conversation (the board stays)" onClick={clear} />}
      </div>
      <div className="talk-log" ref={log} aria-live="polite">
        {!board.talk.length && !pending && (
          <div className="talk-intro">
            <p>Tell me the idea the way you would tell a friend. I’ll ask questions, push back on the weak spots, and offer a few directions of my own.</p>
            <p>Whatever you say or settle is written on the board as we go. My suggestions land in your pile to keep or bin.</p>
            <div className="starters">
              {STARTERS.filter((x) => !x.needsSeed || board.seed).map((x) => (
                <button key={x.label} className="starter" onClick={() => start(x.text)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {board.talk.map((t, i) =>
          t.role === 'author' ? (
            <div key={i} className="msg mine">
              <div className="bubble">
                {t.focus && <span className="msg-focus">About {focusLabel(t.focus, board)}</span>}
                {t.text}
              </div>
            </div>
          ) : (
            <div key={i} className="msg partner">
              <div className="bubble">{t.text}</div>
              {t.changes.length > 0 && (
                <div className={cx('changes', t.undone && 'undone')}>
                  {t.changes.map((c, k) => (
                    <span key={k} className="change" title={preview(c.after)}>
                      {c.label}
                    </span>
                  ))}
                  {t.undone ? (
                    <span className="faint" style={{ fontSize: 'var(--fs-caption)' }}>
                      Undone
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => undo(i)}>
                      Undo
                    </Button>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        {pending && (
          <>
            <div className="msg mine pending">
              <div className="bubble">{pending}</div>
            </div>
            <div className="msg partner">
              <div className="typing" role="status" aria-label="Thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          </>
        )}
      </div>
      <div className="composer">
        {focus && (
          <div className="focus-chip">
            About {focusLabel(focus, board)}
            <button aria-label="Stop pointing at this" onClick={() => setFocus(null)}>
              <X size={12} />
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="textarea"
          rows={3}
          value={text}
          aria-label="Message the thinking partner"
          placeholder={board.talk.length ? 'Reply, push back, or ask for a draft…' : 'Tell me the idea the way you’d tell a friend.'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row">
          <span className="faint grow" style={{ fontSize: 'var(--fs-caption)' }}>
            Enter to send · Shift+Enter for a new line
          </span>
          <MicButton dictation={dictation} label="Talk" compact />
          <Button variant="primary" size="sm" icon={<SendHorizontal />} onClick={send} disabled={!text.trim() || !!pending}>
            Send
          </Button>
        </div>
      </div>
    </aside>
  );
}

/** What a change wrote, for the chip's tooltip. */
function preview(v: unknown): string {
  if (v === null || v === undefined) return 'Removed';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('\n');
  const o = v as Record<string, unknown>;
  return String(o.text ?? o.name ?? '');
}

function FieldHead({ label, onTalk }: { label: string; onTalk: () => void }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {label}
      <TalkAbout onTalk={onTalk} />
    </span>
  );
}

/** A settled text field: saved when you click away, and kept in step with the partner's edits. */
function SettledText({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (t: string) => void }) {
  const [text, setText] = useState(value);
  // While focused, a reply writing this field does not replace what is being typed; on blur
  // the author's text is saved only if they changed it, otherwise the reply's value shows.
  const editing = useRef<string | null>(null);
  useEffect(() => {
    if (editing.current === null) setText(value);
  }, [value]);
  return (
    <textarea
      className="textarea"
      rows={2}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => (editing.current = text)}
      onBlur={() => {
        const changed = text.trim() !== editing.current?.trim();
        editing.current = null;
        if (changed && text.trim() !== value) onSave(text.trim());
        else if (!changed) setText(value);
      }}
    />
  );
}

/** A settled list: edited locally, saved when focus leaves it, so typing never races a save. */
function SettledList({ items, placeholder, onSave }: { items: string[]; placeholder: string; onSave: (v: string[]) => void }) {
  const [local, setLocal] = useState(items);
  const editing = useRef<string[] | null>(null);
  useEffect(() => {
    if (editing.current === null) setLocal(items);
  }, [items]);
  return (
    <div
      onFocus={() => (editing.current ??= local)}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        const clean = local.map((x) => x.trim()).filter(Boolean);
        const changed = clean.join('\n') !== (editing.current ?? []).map((x) => x.trim()).filter(Boolean).join('\n');
        editing.current = null;
        if (changed && clean.join('\n') !== items.join('\n')) onSave(clean);
        else if (!changed) setLocal(items);
      }}
    >
      <ListEditor items={local} onChange={setLocal} numbered={false} placeholder={placeholder} />
    </div>
  );
}

function IdeaCard({ idea, onMark, onTalk, className }: { idea: IdeaItem; onMark: (s: IdeaItem['status']) => void; onTalk: () => void; className?: string }) {
  // Lower model probability = less typical. Show it as rarity, not as a score.
  const rarity = Math.max(0, Math.min(1, 1 - idea.probability));
  return (
    <article className={cx('idea', idea.status, idea.mine && 'mine', idea.near_cliche && 'near-cliche', className)}>
      <div className="row" style={{ gap: 6 }}>
        <Badge kind={idea.mine ? 'accent' : 'outline'}>{idea.mine ? 'Yours' : KIND[idea.kind]}</Badge>
        {!idea.mine && (
          <span className="rarity" title={`The model rated this ${Math.round(idea.probability * 100)}% typical`}>
            <span className="rarity-bar" style={{ width: `${Math.round(rarity * 100)}%` }} />
          </span>
        )}
      </div>
      <p className="idea-text">{idea.text}</p>
      {idea.near_cliche && (
        <div className="idea-warn">
          <TriangleAlert size={12} /> Close to “{idea.near_cliche}”
        </div>
      )}
      <div className="row idea-foot">
        <span className="faint grow" title={idea.persona}>
          {idea.mine ? '' : idea.persona.replace(/^an? /, '').split(' ').slice(0, 4).join(' ')}
        </span>
        <TalkAbout onTalk={onTalk} />
        {idea.status === 'new' ? (
          <>
            <Button size="sm" variant="ghost" iconOnly icon={<ThumbsDown />} tip="Bin it" onClick={() => onMark('discarded')} />
            <Button size="sm" variant="success" icon={<ThumbsUp />} onClick={() => onMark('kept')}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => onMark('new')}>
            Undo
          </Button>
        )}
      </div>
    </article>
  );
}

function ChosenText({ value, onSave, onClear }: { value: string; onSave: (t: string) => void; onClear: () => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div style={{ marginTop: 10 }}>
      <textarea className="textarea prose" rows={Math.min(10, Math.max(2, Math.ceil(text.length / 90)))} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onSave(text)} />
      <div className="row" style={{ marginTop: 6 }}>
        <span className="faint grow" style={{ fontSize: 'var(--fs-label)' }}>
          {plural(text.split(/\s+/).filter(Boolean).length, 'word')} · edits save when you click away
        </span>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Choose again
        </Button>
      </div>
    </div>
  );
}
