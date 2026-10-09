import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Spline, Users, Waves, MapPin, Heart, Target, Skull } from 'lucide-react';
import { post, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { CharacterEntry, ImpactResult, StateSnapshot, Thread } from '../lib/types';
import { factLabel, hue, plural } from '../lib/util';
import { Avatar, Badge, Button, Chip, Drawer, Empty, Field, ListEditor, Segmented } from '../components/ui';
import { Ledger } from './ledger';

/** After an edit that has an impact, offer the ripple. */
function useRippleOffer() {
  const { toast, go, refresh } = useApp();
  return (r: { change: unknown; impact: ImpactResult | null }, saved: string) => {
    refresh();
    const n = r.impact?.impacts.filter((i) => i.hop <= 2).length ?? 0;
    if (!n) return toast({ kind: 'success', message: saved, detail: 'No scene is affected.' });
    toast({
      kind: 'warning',
      message: `${saved}: ${plural(n, 'scene')} affected`,
      detail: r.impact!.description,
      action: { label: 'Review ripple', run: () => post('/ripple/start', { change: r.change }).then(() => go('ripple')) },
    });
  };
}

// ------------------------------------------------------------------ threads

export function Threads({ id }: { id?: string }) {
  const { project: p, go } = useApp();
  const offer = useRippleOffer();
  const [editing, setEditing] = useState<Thread | null>(null);
  const tab = id === 'ledger' ? 'ledger' : 'threads';
  useEffect(() => {
    if (id && id !== 'ledger' && p) setEditing(p.threads.find((t) => t.id === id) ?? null);
  }, [id, p?.threads]);
  if (!p) return null;
  const order = p.scenes.map((s) => s.id);
  const kindLabel: Record<string, string> = { mystery: 'Mystery', arc: 'Arc', 'setup-payoff': 'Setup → payoff', relationship: 'Relationship' };
  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <h1>Threads</h1>
            <p className="sub">Mysteries, arcs, promises and relationships, and where each one is set up and paid off.</p>
          </div>
          <div className="actions">
            <Segmented
              value={tab}
              onChange={(v) => go('threads', v === 'ledger' ? 'ledger' : undefined)}
              options={[
                { value: 'threads', label: `Threads · ${p.threads.length}` },
                { value: 'ledger', label: <span className="row" style={{ gap: 6 }}>Setups and payoffs · {p.obligations.length}{p.obligationIssues.length > 0 && <span className="dot-warn" />}</span> },
              ]}
            />
            {tab === 'threads' && <Button icon={<Plus />} onClick={() => setEditing({ id: '', title: '', kind: 'setup-payoff', description: '', setup_scene: null, payoff_scene: null, setup_chapter: null, payoff_chapter: null, status: 'open', beats: [] })}>
              New thread
            </Button>}
          </div>
        </div>
        {tab === 'ledger' ? (
          <Ledger onOffer={offer} />
        ) : !p.threads.length ? (
          <Empty icon={<Spline />} title="No threads yet">
            Threads come from the structure you pick in Build, or you can add your own.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Thread</th>
                <th>Kind</th>
                <th>Set up</th>
                <th>Paid off</th>
                <th>Status</th>
                <th>Across the book</th>
              </tr>
            </thead>
            <tbody>
              {p.threads.map((t) => {
                const touched = new Set(p.scenes.filter((s) => s.card.threads_touched.includes(t.id)).map((s) => s.id));
                return (
                  <tr key={t.id} onClick={() => go('threads', t.id)}>
                    <td>
                      <Chip id={t.id}>{t.title || t.id}</Chip>
                      <div className="faint" style={{ fontSize: 'var(--fs-label)', marginTop: 4, maxWidth: 360 }}>{t.description}</div>
                    </td>
                    <td className="muted">{kindLabel[t.kind]}</td>
                    <td>{t.setup_scene ? <SceneLink id={t.setup_scene} /> : <span className="faint">—</span>}</td>
                    <td>{t.payoff_scene ? <SceneLink id={t.payoff_scene} /> : <span className="faint">—</span>}</td>
                    <td>
                      <Badge kind={t.status === 'paid-off' ? 'success' : t.status === 'dropped' ? 'danger' : t.status === 'open' ? 'accent' : 'outline'}>{t.status}</Badge>
                    </td>
                    <td>
                      <div className="strip" style={{ '--h': hue(t.id) } as React.CSSProperties} aria-label={`Touches ${touched.size} scenes`}>
                        {order.map((s) => (
                          <span key={s} className={`${touched.has(s) ? 'on' : ''} ${s === t.setup_scene || s === t.payoff_scene ? 'end' : ''}`} title={s} />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {editing && <ThreadDrawer thread={editing} onClose={() => (setEditing(null), id && go('threads'))} />}
    </div>
  );
}

function SceneLink({ id }: { id: string }) {
  const { project: p, go } = useApp();
  const s = p?.scenes.find((x) => x.id === id);
  return (
    <a href={`#/scene/${id}`} onClick={(e) => (e.stopPropagation(), e.preventDefault(), go('scene', id))}>
      <span className="mono faint">{id}</span> {s?.card.title}
    </a>
  );
}

function ThreadDrawer({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const { project: p } = useApp();
  const offer = useRippleOffer();
  const [t, setT] = useState(thread);
  const isNew = !thread.id;
  const save = async () => {
    const id = t.id || t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'thread';
    const r = await put(`/threads/${id}`, { thread: { ...t, id } });
    offer(r, isNew ? 'Thread added' : 'Thread saved');
    onClose();
  };
  const sceneOpts = p!.scenes.map((s) => (
    <option key={s.id} value={s.id}>
      {s.id} {s.card.title}
    </option>
  ));
  return (
    <Drawer
      title={isNew ? 'New thread' : t.title || t.id}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check />} onClick={save} disabled={!t.title.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack lg">
        <Field label="Title">
          <input className="input" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Kind">
            <select className="select" value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as Thread['kind'] })}>
              <option value="mystery">Mystery</option>
              <option value="arc">Arc</option>
              <option value="setup-payoff">Setup → payoff</option>
              <option value="relationship">Relationship</option>
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={t.status} onChange={(e) => setT({ ...t, status: e.target.value as Thread['status'] })}>
              <option value="planned">Planned</option>
              <option value="open">Open</option>
              <option value="paid-off">Paid off</option>
              <option value="dropped">Dropped</option>
            </select>
          </Field>
        </div>
        <Field label="What it is">
          <textarea className="textarea" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Set up in">
            <select className="select" value={t.setup_scene ?? ''} onChange={(e) => setT({ ...t, setup_scene: e.target.value || null })}>
              <option value="">—</option>
              {sceneOpts}
            </select>
          </Field>
          <Field label="Paid off in">
            <select className="select" value={t.payoff_scene ?? ''} onChange={(e) => setT({ ...t, payoff_scene: e.target.value || null })}>
              <option value="">—</option>
              {sceneOpts}
            </select>
          </Field>
        </div>
        {t.beats.length > 0 && (
          <Field label="Beats along the way">
            <div className="list">
              {t.beats.map((b, i) => (
                <div className="list-item" key={i} style={{ cursor: 'default' }}>
                  <span className="mono faint">{b.scene}</span>
                  <span className="grow">{b.note}</span>
                </div>
              ))}
            </div>
          </Field>
        )}
        {!isNew && <p className="faint">Saving checks which scenes depend on this thread and offers a ripple if any do.</p>}
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ characters

export function Characters({ id }: { id?: string }) {
  const { project: p, go } = useApp();
  const [editing, setEditing] = useState<CharacterEntry | null>(null);
  const sel = p?.characters.find((c) => c.id === id) ?? p?.characters[0];
  if (!p) return null;
  if (!p.characters.length)
    return (
      <div className="page">
        <Empty icon={<Users />} title="No characters yet">
          The cast comes with the structure you pick in Build.
        </Empty>
      </div>
    );
  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <h1>Characters</h1>
            <p className="sub">Who they are, how they sound, and what they know when. Click any square in the grid to change what someone knows at that point; the book will be checked for knock-on effects.</p>
          </div>
        </div>
        <div className="char-grid">
          {p.characters.map((c) => (
            <button key={c.id} className="char-card" aria-pressed={sel?.id === c.id} onClick={() => go('characters', c.id)}>
              <Avatar id={c.id} name={c.bio.name} size="lg" />
              <span>
                <div className="n">{c.bio.name}</div>
                <div className="r">{c.bio.role}</div>
                <div className="r">{plural(p.scenes.filter((s) => s.card.characters.includes(c.id)).length, 'scene')}</div>
              </span>
            </button>
          ))}
        </div>
        {sel && <CharacterDetail c={sel} onEdit={() => setEditing(sel)} />}
      </div>
      {editing && <CharacterDrawer c={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CharacterDetail({ c, onEdit }: { c: CharacterEntry; onEdit: () => void }) {
  const { project: p, go } = useApp();
  const offer = useRippleOffer();
  const order = p!.scenes.map((s) => s.id);
  const present = new Set(p!.scenes.filter((s) => s.card.characters.includes(c.id)).map((s) => s.id));

  // Knowledge at the end of each scene: the latest snapshot at or before it.
  const at = useMemo(() => {
    const m = new Map<string, { snap: StateSnapshot; own: boolean } | null>();
    let last: StateSnapshot | null = null;
    for (const s of order) {
      if (c.state[s]) last = c.state[s];
      m.set(s, last ? { snap: last, own: !!c.state[s] } : null);
    }
    return m;
  }, [c, order.join()]);
  const facts = useMemo(() => {
    const ids = new Set<string>();
    for (const snap of Object.values(c.state)) snap.knows.forEach((f) => ids.add(f));
    for (const s of p!.scenes) s.card.mentions.filter((m) => m.character === c.id).forEach((m) => ids.add(m.fact));
    return [...ids];
  }, [c, p]);
  const firstKnown = (f: string) => order.find((s) => at.get(s)?.snap.knows.includes(f));
  facts.sort((a, b) => order.indexOf(firstKnown(a) ?? 'zzz') - order.indexOf(firstKnown(b) ?? 'zzz'));

  const toggle = async (scene: string, fact: string) => {
    const cur = at.get(scene)?.snap ?? { knows: [], wants: '', feels: {}, location: null, alive: true };
    const knows = cur.knows.includes(fact) ? cur.knows.filter((f) => f !== fact) : [...cur.knows, fact];
    const r = await put(`/characters/${c.id}/state/${scene}`, { snapshot: { ...cur, knows } });
    offer(r, `${c.bio.name.split(' ')[0]} ${cur.knows.includes(fact) ? 'no longer knows' : 'now knows'} this at ${scene}`);
  };

  const timeline = order.filter((s) => c.state[s]);
  return (
    <div className="stack lg">
      <div className="two-col">
        <div className="card">
          <div className="row" style={{ marginBottom: 14 }}>
            <Avatar id={c.id} name={c.bio.name} size="xl" />
            <div className="grow">
              <h2 className="serif" style={{ fontSize: 'var(--fs-title-m)' }}>{c.bio.name}</h2>
              <div className="muted">{c.bio.role}</div>
            </div>
            <Button onClick={onEdit}>Edit</Button>
          </div>
          {c.bio.background && <p className="serif" style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 12 }}>{c.bio.background}</p>}
          {c.bio.goals.length > 0 && (
            <div className="row wrap">
              {c.bio.goals.map((g) => (
                <Badge key={g} kind="outline" icon={<Target />}>
                  {g}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Voice</h3>
          </div>
          <div className="stack">
            {c.voice.speech_patterns.length > 0 && <div className="muted">{c.voice.speech_patterns.join(' · ')}</div>}
            {c.voice.sample_lines.map((l, i) => (
              <div key={i} className="quote">“{l}”</div>
            ))}
            {c.voice.avoid.length > 0 && <div className="faint">Never: {c.voice.avoid.join(', ')}</div>}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="card-head">
          <h3>What {c.bio.name.split(' ')[0]} knows, scene by scene</h3>
          <span className="faint" style={{ fontSize: 'var(--fs-label)' }}>Filled = knows by the end of that scene. Outlined = not in the scene.</span>
        </div>
        {facts.length ? (
          <table className="matrix">
            <thead>
              <tr>
                <th />
                {order.map((s) => (
                  <th key={s} className="mono" style={{ color: present.has(s) ? 'var(--text-2)' : undefined }}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f}>
                  <th className="fact" title={factLabel(p!.facts, f)}>
                    {factLabel(p!.facts, f)}
                  </th>
                  {order.map((s, i) => {
                    const knows = at.get(s)?.snap.knows.includes(f);
                    const before = i > 0 && at.get(order[i - 1])?.snap.knows.includes(f);
                    const cls = knows ? (before ? 'k' : 'learn') : present.has(s) ? '' : 'none';
                    return (
                      <td key={s} className={cls}>
                        {present.has(s) && <button aria-label={`${knows ? 'Forget' : 'Learn'} at ${s}`} title={`${s}: ${knows ? 'knows' : 'does not know'} — click to change`} onClick={() => toggle(s, f)} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No knowledge recorded yet. It fills in as scenes are written and read back.</p>
        )}
      </div>

      {timeline.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Where they are, what they want</h3>
          </div>
          <div className="list">
            {timeline.map((s) => {
              const snap = c.state[s];
              const sc = p!.scenes.find((x) => x.id === s);
              return (
                <button key={s} className="list-item" onClick={() => go('scene', s)}>
                  <span className="mono faint" style={{ width: 40 }}>{s}</span>
                  <span className="grow">
                    <div className="primary-text">{sc?.card.title}</div>
                    <div className="secondary-text row" style={{ gap: 12 }}>
                      {snap.location && (
                        <span className="row" style={{ gap: 4 }}>
                          <MapPin size={12} /> {p!.locations.find((l) => l.id === snap.location)?.name ?? snap.location}
                        </span>
                      )}
                      {snap.wants && (
                        <span className="row" style={{ gap: 4 }}>
                          <Target size={12} /> {snap.wants}
                        </span>
                      )}
                    </div>
                  </span>
                  <span className="end">
                    {Object.entries(snap.feels).slice(0, 3).map(([o, v]) => (
                      <span key={o} className="row faint" style={{ gap: 4, fontSize: 'var(--fs-caption)' }}>
                        <Heart size={11} /> {v} → {o}
                      </span>
                    ))}
                    {!snap.alive && <Badge kind="danger" icon={<Skull />}>dead</Badge>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterDrawer({ c, onClose }: { c: CharacterEntry; onClose: () => void }) {
  const offer = useRippleOffer();
  const [bio, setBio] = useState(c.bio);
  const [voice, setVoice] = useState(c.voice);
  const save = async () => {
    const r = await put(`/characters/${c.id}`, { bio, voice });
    offer(r, `${bio.name} saved`);
    onClose();
  };
  return (
    <Drawer
      title={c.bio.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Waves />} onClick={save}>
            Save and check impact
          </Button>
        </>
      }
    >
      <div className="stack lg">
        <div className="grid-2">
          <Field label="Name">
            <input className="input" value={bio.name} onChange={(e) => setBio({ ...bio, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <input className="input" value={bio.role} onChange={(e) => setBio({ ...bio, role: e.target.value })} />
          </Field>
        </div>
        <Field label="Background">
          <textarea className="textarea prose" rows={5} value={bio.background} onChange={(e) => setBio({ ...bio, background: e.target.value })} />
        </Field>
        <Field label="Goals">
          <ListEditor items={bio.goals} onChange={(goals) => setBio({ ...bio, goals })} numbered={false} />
        </Field>
        <div className="section-title">Voice sheet</div>
        <Field label="Speech patterns">
          <ListEditor items={voice.speech_patterns} onChange={(speech_patterns) => setVoice({ ...voice, speech_patterns })} numbered={false} />
        </Field>
        <Field label="Sample lines" hint="Real lines in their voice. The voice checker compares dialogue against these.">
          <ListEditor items={voice.sample_lines} onChange={(sample_lines) => setVoice({ ...voice, sample_lines })} numbered={false} />
        </Field>
        <Field label="Never says or does">
          <ListEditor items={voice.avoid} onChange={(avoid) => setVoice({ ...voice, avoid })} numbered={false} />
        </Field>
      </div>
    </Drawer>
  );
}
