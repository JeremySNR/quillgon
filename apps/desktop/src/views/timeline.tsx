import { useMemo, useState } from 'react';
import { CalendarPlus, Check, Mic, Trash2 } from 'lucide-react';
import { del, post, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Timeline as TimelineData } from '../lib/types';
import { cx, plural } from '../lib/util';
import { Badge, Button, Field } from '../components/ui';
import { ageAt, lifeGaps, yearOf } from '@quillgon/core/life';

type Event = TimelineData['events'][number];
const KEY_LABEL: Record<string, string> = { high: 'high point', low: 'low point', turning: 'turning point', earliest: 'earliest memory', wisdom: 'understood something' };

/**
 * A life laid out by year, with the narrator's age beneath. Key moments stand out, unsure dates
 * show as bars, and empty stretches are shaded: each one a question for the next session.
 */
export function TimelineView() {
  const { project: p, refresh, fail, toast, go } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const life = p?.life;
  const born = p?.book.life.born ?? '';
  const items = useMemo(() => {
    if (!p || !life) return [];
    const fromEvents = p.timeline.events.map((e) => ({ id: e.id, when: e.when, title: e.description, key: e.key ?? null, precision: e.precision ?? 'year', kind: 'event' as const }));
    const told = new Set(p.timeline.events.flatMap((e) => e.stories ?? []));
    const fromStories = life.stories.filter((s) => s.when && !told.has(s.id)).map((s) => ({ id: `story:${s.id}`, when: s.when, title: s.title, key: s.key, precision: s.precision ?? 'year', kind: 'story' as const }));
    return [...fromEvents, ...fromStories].filter((x) => yearOf(x.when) !== null).sort((a, b) => (yearOf(a.when) ?? 0) - (yearOf(b.when) ?? 0));
  }, [p, life]);
  if (!p || !life) return null;
  const now = new Date().getFullYear();
  const years = items.map((x) => yearOf(x.when)!);
  const start = yearOf(born) ?? (years.length ? Math.min(...years) : now - 60);
  const end = Math.max(now, ...years);
  const gaps = lifeGaps(born, [...p.timeline.events.map((e) => e.when), ...life.stories.map((s) => s.when)], now);
  const W = 1000;
  const x = (y: number) => 40 + ((y - start) / Math.max(1, end - start)) * (W - 80);
  const ticks = Array.from({ length: Math.floor((end - start) / 10) + 1 }, (_, i) => Math.ceil(start / 10) * 10 + i * 10).filter((y) => y <= end);
  const chapters = p.structure.acts.flatMap((a) => a.chapters).map((c) => {
    const ys = (c.stories ?? []).map((sid) => yearOf(life.stories.find((s) => s.id === sid)?.when ?? '')).filter((y): y is number => y !== null);
    return { id: c.id, title: c.title, from: ys.length ? Math.min(...ys) : null, to: ys.length ? Math.max(...ys) : null };
  });
  const askAbout = (gap: string) => {
    const questions = [...life.questions, { id: `q-years-${gap.replace(/\D+/g, '-')}`, text: `What was happening in your life between ${gap.replace(' to ', ' and ')}?`, why: 'Nothing is on the timeline for these years yet.', technique: 'Gap in the years', about: `period:${gap}`, ask: '', priority: 1, status: 'queued' as const, asked_in: null }];
    put('/questions', { questions }).then(() => (refresh(), toast({ kind: 'success', message: 'Added to your next session' })), fail('Not saved'));
  };
  const event = selected ? p.timeline.events.find((e) => e.id === selected) : null;

  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <h1>Timeline</h1>
            <p className="sub">
              {born ? `${born} to today` : 'Add a year of birth in Settings → Book to see ages'} · {plural(items.length, 'event')} · {plural(p.characters.length - 1, 'person', 'people')}
            </p>
          </div>
          <div className="actions">
            <Button icon={<CalendarPlus />} onClick={() => setAdding(true)}>
              Add a date
            </Button>
          </div>
        </div>

        <div className="card timeline-card">
          <svg viewBox={`0 0 ${W} 230`} width="100%" role="img" aria-label="Life timeline">
            {gaps.map((g) => {
              const [a, b] = g.split(' to ').map(Number);
              return (
                <g key={g}>
                  <rect x={x(a)} y={36} width={Math.max(4, x(b + 1) - x(a))} height={118} className="tl-gap" />
                  <text x={(x(a) + x(b + 1)) / 2} y={52} textAnchor="middle" className="tl-gap-label">
                    {g}
                  </text>
                </g>
              );
            })}
            <line x1={40} x2={W - 40} y1={120} y2={120} className="tl-axis" />
            {ticks.map((y) => (
              <g key={y}>
                <line x1={x(y)} x2={x(y)} y1={116} y2={124} className="tl-axis" />
                <text x={x(y)} y={140} textAnchor="middle" className="tl-tick">
                  {y}
                </text>
                {born && (
                  <text x={x(y)} y={154} textAnchor="middle" className="tl-age">
                    {ageAt(born, String(y))}
                  </text>
                )}
              </g>
            ))}
            {items.map((it, i) => {
              const y = yearOf(it.when)!;
              const fuzzy = it.precision === 'decade' || it.precision === 'about';
              const cx_ = x(y);
              const up = 100 - (i % 3) * 22;
              return (
                <g key={it.id} className={cx('tl-item', it.key && 'key', it.key === 'low' && 'low', selected === it.id && 'selected')} onClick={() => it.kind === 'event' && setSelected(it.id)} role="button" aria-label={`${it.when}: ${it.title}`}>
                  {fuzzy ? <rect x={cx_ - 14} y={116} width={28} height={8} rx={4} className="tl-fuzzy" /> : <circle cx={cx_} cy={120} r={it.key ? 6 : 4} className="tl-dot" />}
                  <line x1={cx_} x2={cx_} y1={up + 4} y2={114} className="tl-stem" />
                  <text x={cx_} y={up} textAnchor={cx_ < 140 ? 'start' : cx_ > W - 140 ? 'end' : 'middle'} className="tl-label">
                    {it.title.length > 26 ? `${it.title.slice(0, 24)}…` : it.title}
                  </text>
                  {it.key && (
                    <text x={cx_} y={up - 13} textAnchor={cx_ < 140 ? 'start' : cx_ > W - 140 ? 'end' : 'middle'} className="tl-key">
                      {KEY_LABEL[it.key]}
                    </text>
                  )}
                </g>
              );
            })}
            {chapters.filter((c) => c.from !== null).map((c, i) => (
              <g key={c.id}>
                <rect x={x(c.from!) - 6} y={176 + (i % 2) * 22} width={Math.max(40, x(c.to!) - x(c.from!) + 12)} height={18} rx={4} className="tl-chapter" />
                <text x={x(c.from!)} y={189 + (i % 2) * 22} className="tl-chapter-label">
                  {c.title}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {gaps.length > 0 && (
          <div className="gap-row">
            {gaps.map((g) => (
              <span key={g} className="row">
                <Badge kind="warning">Gap</Badge>
                <span className="muted small">{g}</span>
                <Button size="sm" icon={<Mic />} onClick={() => askAbout(g)}>
                  Ask me about these years
                </Button>
              </span>
            ))}
          </div>
        )}

        <div className="timeline-lower">
          <div className="list">
            {items.map((it) => (
              <button key={it.id} className={cx('list-item', selected === it.id && 'active')} onClick={() => (it.kind === 'event' ? setSelected(it.id) : go('sessions'))}>
                <span className="mono faint tl-when">{it.when}</span>
                <span className="grow">
                  <div className="primary-text">{it.title}</div>
                  <div className="secondary-text">
                    {it.kind === 'story' ? 'from a story' : 'event'}
                    {born && ageAt(born, it.when) !== null ? ` · age ${ageAt(born, it.when)}` : ''}
                    {it.key ? ` · ${KEY_LABEL[it.key]}` : ''}
                  </div>
                </span>
              </button>
            ))}
            {!items.length && <p className="muted">Nothing dated yet. Dates are filed from your sessions as you mention them, or add one here.</p>}
          </div>
          {(event || adding) && <EventEditor key={event?.id ?? 'new'} event={event ?? null} onDone={() => (setAdding(false), setSelected(null), refresh())} />}
        </div>
      </div>
    </div>
  );
}

function EventEditor({ event, onDone }: { event: Event | null; onDone: () => void }) {
  const { project: p, fail, toast } = useApp();
  const [e, setE] = useState<Partial<Event>>(event ?? { when: '', description: '', precision: 'year', source: 'memory', certainty: 'sure' });
  const people = p!.characters.filter((c) => c.id !== p!.book.life.narrator);
  const save = async () => {
    try {
      if (event) {
        const r = await put<{ affected: string[] }>(`/timeline/events/${event.id}`, { event: e });
        toast({ kind: 'success', message: 'Saved', detail: r.affected.length ? `${plural(r.affected.length, 'scene')} told from this has a note to check the new date.` : undefined });
      } else await post('/timeline/events', { event: e });
      onDone();
    } catch (err) {
      fail('Not saved')(err);
    }
  };
  return (
    <div className="card stack">
      <div className="card-head">
        <h3 className="grow">{event ? 'Edit' : 'Add a date'}</h3>
        {event && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} tip="Remove" onClick={() => del(`/timeline/events/${event.id}`).then(onDone, fail('Not removed'))} />}
      </div>
      <Field label="What happened">
        <input className="input" value={e.description ?? ''} onChange={(x) => setE({ ...e, description: x.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="When" hint="1962, 1962-07, or about 1960">
          <input className="input" value={e.when ?? ''} onChange={(x) => setE({ ...e, when: x.target.value })} />
        </Field>
        <Field label="How sure of the date">
          <select className="select" value={e.precision ?? 'year'} onChange={(x) => setE({ ...e, precision: x.target.value as Event['precision'] })}>
            <option value="day">The exact day</option>
            <option value="month">The month</option>
            <option value="year">The year</option>
            <option value="decade">The decade</option>
            <option value="about">Roughly</option>
          </select>
        </Field>
        <Field label="Where it comes from">
          <select className="select" value={e.source ?? 'memory'} onChange={(x) => setE({ ...e, source: x.target.value as Event['source'] })}>
            <option value="memory">Memory</option>
            <option value="letter">A letter</option>
            <option value="photo">A photo</option>
            <option value="record">A record or document</option>
            <option value="someone-else">Someone else</option>
          </select>
        </Field>
        <Field label="Key moment">
          <select className="select" value={e.key ?? ''} onChange={(x) => setE({ ...e, key: (x.target.value || undefined) as Event['key'] })}>
            <option value="">No</option>
            {Object.entries(KEY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                A {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {people.length > 0 && (
        <Field label="Who was there">
          <div className="row wrap">
            {people.map((c) => {
              const on = (e.people ?? []).includes(c.id);
              return (
                <button key={c.id} type="button" className={cx('chip-toggle', on && 'on')} aria-pressed={on} onClick={() => setE({ ...e, people: on ? (e.people ?? []).filter((x) => x !== c.id) : [...(e.people ?? []), c.id] })}>
                  {c.bio.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <div className="btn-row">
        <Button variant="primary" icon={<Check />} disabled={!e.when?.trim() || !e.description?.trim()} onClick={save}>
          Save
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
