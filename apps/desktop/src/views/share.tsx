import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BookOpenCheck, Check, CircleCheck, Download, FileQuestion, ShieldAlert, Users } from 'lucide-react';
import { get, put } from '../lib/api';
import { useApp } from '../lib/app';
import { plural } from '../lib/util';
import { Badge, Button, Working } from '../components/ui';

interface Review {
  unsourced: { scene: string; title: string; text: string; reason: 'no-source' | 'quote-changed' }[];
  gaps: { scene: string; title: string; marker: string }[];
  open_notes: { scene: string; title: string; count: number }[];
  people: { id: string; name: string; relationship: string; living: boolean | null; consent: string; naming: string; scenes: number; flag: 'high' | 'note' | null; why: string }[];
  sensitive: { story: string; title: string; scenes: string[] }[];
  unapproved: { id: string; title: string; stage: string }[];
  authors_note: string;
  saved_note: string | null;
}

const CONSENT: Record<string, string> = { 'not-asked': 'Not asked', asked: 'Asked', approved: 'Agreed', objected: 'Objected', 'not-needed': 'Not needed' };

/**
 * Before the book goes to anyone: claims nothing you said supports, gaps still open, real people
 * who have not agreed, sensitive stories in the text, and an author's note written from your
 * choices. Information, not legal advice.
 */
export function ShareView() {
  const { project: p, go, refresh, fail, toast } = useApp();
  const [r, setR] = useState<Review | null>(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => get<Review>('/life/share').then((x) => (setR(x), setNote(x.saved_note?.trim() || x.authors_note)), fail('Could not run the check')), [fail]);
  useEffect(() => void load(), [load, p?.scenes]);
  if (!p?.life) return null;
  if (!r) return <div className="page"><div className="page-inner"><Working fallback="Checking the book" /></div></div>;
  const flagged = r.people.filter((x) => x.flag);
  const issues = r.unsourced.length + r.gaps.length + r.open_notes.length + flagged.filter((x) => x.flag === 'high').length + r.sensitive.length + r.unapproved.length;
  const setConsent = (id: string, consent: string) => put(`/characters/${id}`, { bio: { consent } }).then(() => (load(), refresh()), fail('Not saved'));
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Before you share</h1>
            <p className="sub">What to settle before anyone reads it. {p.book.life.audience === 'public' ? 'You are publishing this book, so the people in it matter most.' : 'Family books are often shared further than planned.'}</p>
          </div>
          <div className="actions">
            <Button icon={<Download />} onClick={() => get('/export?format=md').then((x) => toast({ kind: 'success', message: 'Exported', detail: x.file }), fail('Export failed'))}>
              Export
            </Button>
          </div>
        </div>
        {issues === 0 ? (
          <div className="banner success">
            <CircleCheck />
            <div className="banner-body">
              <span className="banner-title">Nothing left to settle</span>
              <span>Every claim has a source, every person in the book has a decision, and every chapter is signed off.</span>
            </div>
          </div>
        ) : (
          <p className="muted">{plural(issues, 'thing')} to look at.</p>
        )}

        <Section icon={<FileQuestion />} title="Claims with no source" count={r.unsourced.length} empty="Every sentence comes from something you said.">
          {r.unsourced.map((u, i) => (
            <button key={i} className="list-item" onClick={() => go('scene', u.scene)}>
              <span className="grow">
                <div className="primary-text serif">{u.text}</div>
                <div className="secondary-text">
                  {u.title} · {u.reason === 'quote-changed' ? 'not word for word what was said' : 'nothing you said covers it'}
                </div>
              </span>
            </button>
          ))}
        </Section>

        <Section icon={<AlertTriangle />} title="Gaps and open questions" count={r.gaps.length + r.open_notes.length} empty="No gaps left and no notes waiting.">
          {r.gaps.map((g, i) => (
            <button key={`g${i}`} className="list-item" onClick={() => go('scene', g.scene)}>
              <span className="grow">
                <div className="primary-text">{g.marker}</div>
                <div className="secondary-text">{g.title}</div>
              </span>
            </button>
          ))}
          {r.open_notes.map((n) => (
            <button key={n.scene} className="list-item" onClick={() => go('scene', n.scene)}>
              <span className="grow">
                <div className="primary-text">{plural(n.count, 'note')} waiting</div>
                <div className="secondary-text">{n.title}</div>
              </span>
            </button>
          ))}
        </Section>

        <Section icon={<Users />} title="The people in the book" count={flagged.filter((x) => x.flag === 'high').length} empty="Nobody else appears in the drafted chapters yet.">
          <table className="people-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Scenes</th>
                <th>Named</th>
                <th>Agreed?</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.people.filter((x) => x.scenes > 0 || x.flag).map((x) => (
                <tr key={x.id}>
                  <td>
                    <button className="link" onClick={() => go('characters', x.id)}>
                      {x.name}
                    </button>
                    <div className="faint small">{[x.relationship, x.living === false ? 'deceased' : x.living ? 'living' : ''].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="num">{x.scenes}</td>
                  <td>{x.naming === 'real' ? 'Real name' : x.naming === 'pseudonym' ? 'Pseudonym' : 'Composite'}</td>
                  <td>
                    <select className="select" value={x.consent} aria-label={`Has ${x.name} agreed?`} onChange={(e) => setConsent(x.id, e.target.value)}>
                      {Object.entries(CONSENT).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{x.flag && <Badge kind={x.flag === 'high' ? 'danger' : 'warning'}>{x.why}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint small">Writing about living people can raise privacy and defamation questions, and the law differs between countries. This is information, not legal advice.</p>
        </Section>

        <Section icon={<ShieldAlert />} title="Sensitive stories in the text" count={r.sensitive.length} empty="No story marked sensitive is in a drafted chapter.">
          {r.sensitive.map((s) => (
            <button key={s.story} className="list-item" onClick={() => go('scene', s.scenes[0])}>
              <span className="grow">
                <div className="primary-text">{s.title}</div>
                <div className="secondary-text">In {plural(s.scenes.length, 'scene')}</div>
              </span>
            </button>
          ))}
        </Section>

        <Section icon={<BookOpenCheck />} title="Chapters not signed off" count={r.unapproved.length} empty="Every drafted chapter is signed off.">
          {r.unapproved.map((c) => (
            <button key={c.id} className="list-item" onClick={() => go('build')}>
              <span className="grow">
                <div className="primary-text">{c.title}</div>
                <div className="secondary-text">{c.stage === 'notes' ? 'Waiting on your notes' : c.stage}</div>
              </span>
            </button>
          ))}
        </Section>

        <h3 className="section-title">A note from the author</h3>
        <div className="card stack">
          <p className="muted small">Written from the choices you made: changed names, reconstructed conversations, other people’s versions. It opens the exported book. Edit it freely.</p>
          <textarea className="textarea serif" rows={5} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Author's note" />
          <div className="btn-row">
            <Button variant="primary" icon={<Check />} onClick={() => put('/life/authors-note', { text: note }).then(() => (load(), toast({ kind: 'success', message: 'Saved; it opens the exported book' })), fail('Not saved'))}>
              Save the note
            </Button>
            <Button variant="ghost" onClick={() => setNote(r.authors_note)}>
              Write it again from my choices
            </Button>
            <Button variant="ghost" onClick={() => go('reader')}>
              Read it as a first reader
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, count, empty, children }: { icon: React.ReactNode; title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="share-section">
      <h3 className="section-title">
        {icon} {title} {count > 0 ? <Badge kind="warning">{count}</Badge> : <Badge kind="success">Done</Badge>}
      </h3>
      {count > 0 || title.startsWith('The people') ? <div className="list">{children}</div> : <p className="faint small">{empty}</p>}
    </section>
  );
}
