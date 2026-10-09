import { useEffect, useState } from 'react';
import { ArrowRight, Check, Lightbulb, Plus, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert, Undo2, Users } from 'lucide-react';
import { post } from '../lib/api';
import { useApp } from '../lib/app';
import type { IdeaBoard, IdeaItem } from '../lib/types';
import { cx, plural } from '../lib/util';
import { Avatar, Badge, Button, Empty, Field, Segmented, Working } from '../components/ui';

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

/**
 * Idea → premise. Models drift to the same stories; this step asks several different minds
 * for ideas, shows the least typical first, flags clichés, and lets the author keep or bin
 * each one before the premise is grown one level at a time.
 */
export function IdeaStep({ job }: { job: any }) {
  const { project: p, job: run, refresh, go, toast } = useApp();
  const [board, setBoard] = useState<IdeaBoard>(p!.idea);
  const [seed, setSeed] = useState(p!.idea.seed);
  const [genre, setGenre] = useState(p!.idea.genre);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'new' | 'kept' | 'discarded'>('new');
  const [own, setOwn] = useState('');
  useEffect(() => setBoard(p!.idea), [p!.idea]);

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

  return (
    <div className="stack lg">
      <div className="card">
        <div className="card-head">
          <h3>Start with a spark</h3>
          <span className="grow" />
          <Button variant="ghost" size="sm" onClick={skip}>
            I already have a premise
          </Button>
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 220px' }}>
          <Field label="Seed" hint="A line, an image, a what-if, a person. Unfinished is good.">
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

      {board.pile.length > 0 && (
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
                <IdeaCard key={i.id} idea={i} onMark={(s) => mark(i.id, s)} />
              ))}
            </div>
          ) : (
            <p className="muted">{filter === 'new' ? 'All sorted. Ask for more, or grow the premise below.' : 'Nothing here yet.'}</p>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <input className="input grow" value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOwn()} placeholder="Add an idea of your own. Yours always count as kept." />
            <Button icon={<Plus />} onClick={addOwn} disabled={!own.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}

      {board.pile.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Grow the premise</h3>
            <span className="muted">One level at a time, from what you kept. Pick one option or rewrite it.</span>
          </div>
          <ol className="ladder">
            {LADDER.map(({ step, title, hint }, n) => {
              const options = board[`${step}_options`];
              const chosen = board[step];
              const prevChosen = n === 0 ? counts.kept > 0 : !!board[LADDER[n - 1].step];
              return (
                <li key={step} className={cx('rung', chosen && 'done', !prevChosen && 'locked')}>
                  <div className="rung-head">
                    <span className="rung-dot">{chosen ? <Check size={13} /> : n + 1}</span>
                    <div className="grow">
                      <div className="rung-title">{title}</div>
                      <div className="faint" style={{ fontSize: 'var(--fs-label)' }}>{hint}</div>
                    </div>
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
            <li className={cx('rung', board.cast.length > 0 && 'done', !board.synopsis && 'locked')}>
              <div className="rung-head">
                <span className="rung-dot">{board.cast.length ? <Check size={13} /> : 4}</span>
                <div className="grow">
                  <div className="rung-title">The people</div>
                  <div className="faint" style={{ fontSize: 'var(--fs-label)' }}>What each wants, what they need, the wound and the lie they believe.</div>
                </div>
                <Button size="sm" variant={board.cast.length ? 'ghost' : 'default'} icon={<Users />} onClick={() => expand('cast')} disabled={!board.synopsis || !!busy}>
                  {board.cast.length ? 'Recast' : 'Cast it'}
                </Button>
              </div>
              {busy === 'cast' && <Working job={job} fallback="Casting" />}
              {board.cast.length > 0 && (
                <div className="cast-grid">
                  {board.cast.map((c) => (
                    <div key={c.id} className="cast-card">
                      <div className="row">
                        <Avatar id={c.id} name={c.name} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                          <div className="faint" style={{ fontSize: 'var(--fs-label)' }}>{c.role}</div>
                        </div>
                      </div>
                      <dl className="arc">
                        <dt>Wants</dt>
                        <dd>{c.want}</dd>
                        <dt>Needs</dt>
                        <dd>{c.need}</dd>
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

      {!board.pile.length && busy !== 'diverge' && (
        <Empty icon={<Lightbulb />} title="Ideas first, decisions later">
          You sort; the machine only suggests. Keep what sparks something, bin the rest, add your own. Nothing becomes part of the book until you grow it into a premise.
        </Empty>
      )}
    </div>
  );
}

function IdeaCard({ idea, onMark }: { idea: IdeaItem; onMark: (s: IdeaItem['status']) => void }) {
  // Lower model probability = less typical. Show it as rarity, not as a score.
  const rarity = Math.max(0, Math.min(1, 1 - idea.probability));
  return (
    <article className={cx('idea', idea.status, idea.mine && 'mine', idea.near_cliche && 'near-cliche')}>
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
