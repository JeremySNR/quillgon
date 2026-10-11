import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Notebook } from '../lib/types';
import { Button, ListEditor } from '../components/ui';

const SECTIONS: { key: keyof Notebook; title: string; hint: string; placeholder: string }[] = [
  { key: 'voice', title: 'How you talk', hint: 'Learned from your sessions and your edits. Every draft follows it.', placeholder: 'Add how you talk' },
  { key: 'off_limits', title: 'Off limits', hint: 'The ghostwriter never raises these, in questions or in the book.', placeholder: 'Add a topic' },
  { key: 'promises', title: 'Promised to come back to', hint: 'Put on future session agendas.', placeholder: 'Add a promise' },
  { key: 'decisions', title: 'Settled', hint: 'Arguments you have had with the ghostwriter, and won. It will not reopen them.', placeholder: 'Add a decision' },
];

/**
 * What the ghostwriter knows about you, out in the open: a human ghostwriter keeps these notes
 * between sessions. Anything crossed out here, it stops doing.
 */
export function NotebookView() {
  const { project: p, refresh, toast, fail } = useApp();
  const saved = p?.life?.notebook;
  const [nb, setNb] = useState<Notebook | null>(saved ?? null);
  // The snapshot is a new object on every refresh; only a real change replaces what is being edited.
  const savedKey = JSON.stringify(saved ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setNb(saved ?? null), [savedKey]);
  if (!p?.life || !nb) return null;
  const others = p.life.questions.filter((q) => q.ask && q.status === 'queued');
  const name = (id: string) => p.characters.find((c) => c.id === id)?.bio.name ?? id;
  const dirty = JSON.stringify(nb) !== JSON.stringify(saved);
  const save = () =>
    put('/notebook', { notebook: { ...nb, ...Object.fromEntries(SECTIONS.map((s) => [s.key, nb[s.key].map((x) => x.trim()).filter(Boolean)])) } }).then(
      () => (refresh(), toast({ kind: 'success', message: 'Notebook saved' })),
      fail('Not saved'),
    );
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Ghostwriter’s notebook</h1>
            <p className="sub">What your ghostwriter has learned about you and your book. Nothing about you is hidden in a prompt: edit anything here and it follows what you write.</p>
          </div>
          <div className="actions">
            <Button variant="primary" icon={<Check />} disabled={!dirty} onClick={save}>
              Save
            </Button>
          </div>
        </div>
        <div className="notebook-grid">
          {SECTIONS.map((s) => (
            <div key={s.key} className="card stack">
              <h3>{s.title}</h3>
              <p className="muted small">{s.hint}</p>
              <ListEditor items={nb[s.key].length ? nb[s.key] : ['']} onChange={(v) => setNb({ ...nb, [s.key]: v })} placeholder={s.placeholder} numbered={false} />
            </div>
          ))}
          <div className="card stack">
            <h3>To ask someone else</h3>
            <p className="muted small">Questions only another person can answer. Their answers are kept as their version, never merged into yours.</p>
            {others.length ? (
              <ul className="question-list">
                {others.map((q) => (
                  <li key={q.id}>
                    <div className="grow">
                      <strong>{name(q.ask)}:</strong> {q.text}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="faint small">None yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
