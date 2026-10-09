import { diffArrays, diffWords } from 'diff';
import type { ReactNode } from 'react';
import type { SceneCard } from '../lib/types';
import { factLabel } from '../lib/util';
import { Chip } from './ui';

type Seg = { text: string; kind: 'same' | 'ins' | 'del' };

/**
 * Prose diff in the reading font. Paragraphs are aligned first, so a removed paragraph
 * shows as removed; paragraphs that were edited get a word-level diff. Unchanged
 * paragraphs collapse.
 */
export function ProseDiff({ before, after, context = 1 }: { before: string; after: string; context?: number }) {
  const paras = alignParagraphs(before, after);
  const changed = paras.map((p) => p.some((s) => s.kind !== 'same'));
  const show = paras.map((_, i) => changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean));
  const out: ReactNode[] = [];
  let hidden = 0;
  const flush = (key: string) => {
    if (hidden) out.push(<div key={key} className="collapsed">{hidden} unchanged paragraph{hidden === 1 ? '' : 's'}</div>);
    hidden = 0;
  };
  paras.forEach((p, i) => {
    if (!show[i]) return void hidden++;
    flush(`c${i}`);
    out.push(
      <p key={i}>
        {p.map((s, j) => (s.kind === 'ins' ? <ins key={j}>{s.text}</ins> : s.kind === 'del' ? <del key={j}>{s.text}</del> : <span key={j}>{s.text}</span>))}
      </p>,
    );
  });
  flush('end');
  if (!changed.some(Boolean)) return <div className="prose-diff muted">No changes to the prose.</div>;
  return <div className="prose-diff">{out}</div>;
}

const splitParas = (t: string) => t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

/** Paragraph alignment, then word diffs for paragraphs that were edited in place. */
export function alignParagraphs(before: string, after: string): Seg[][] {
  const parts = diffArrays(splitParas(before), splitParas(after));
  const out: Seg[][] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      // Edited in place: pair removed and added paragraphs and diff their words.
      const n = Math.max(p.value.length, next.value.length);
      for (let k = 0; k < n; k++) {
        const a = p.value[k];
        const b = next.value[k];
        if (a !== undefined && b !== undefined) out.push(diffWords(a, b).map((w) => ({ text: w.value, kind: w.added ? 'ins' : w.removed ? 'del' : 'same' })));
        else if (a !== undefined) out.push([{ text: a, kind: 'del' }]);
        else out.push([{ text: b!, kind: 'ins' }]);
      }
      i++;
      continue;
    }
    for (const v of p.value) out.push([{ text: v, kind: p.added ? 'ins' : p.removed ? 'del' : 'same' }]);
  }
  return out;
}

export function ProseSideBySide({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <div className="side-by-side prose-diff">
      <div>
        {split(parts.filter((p) => !p.added), 'del')}
      </div>
      <div>
        {split(parts.filter((p) => !p.removed), 'ins')}
      </div>
    </div>
  );
}

function split(parts: { value: string; added?: boolean; removed?: boolean }[], mark: 'ins' | 'del') {
  const paras: ReactNode[][] = [[]];
  parts.forEach((p, k) => {
    p.value.split(/\n\s*\n/).forEach((c, i) => {
      if (i > 0) paras.push([]);
      const changed = p.added || p.removed;
      paras[paras.length - 1].push(changed ? (mark === 'ins' ? <ins key={`${k}-${i}`}>{c}</ins> : <del key={`${k}-${i}`}>{c}</del>) : <span key={`${k}-${i}`}>{c}</span>);
    });
  });
  return paras.map((p, i) => <p key={i}>{p}</p>);
}

function WordDiff({ a, b }: { a: string; b: string }) {
  return (
    <>
      {diffWords(a, b).map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
    </>
  );
}

function ListDiff({ a, b, render = (x) => x }: { a: string[]; b: string[]; render?: (x: string) => ReactNode }) {
  const parts = diffArrays(a, b);
  return (
    <ul>
      {parts.flatMap((p, i) =>
        p.value.map((v, j) => (
          <li key={`${i}-${j}`}>{p.added ? <ins>{render(v)}</ins> : p.removed ? <del>{render(v)}</del> : <span className="muted">{render(v)}</span>}</li>
        )),
      )}
    </ul>
  );
}

const LABELS: Partial<Record<keyof SceneCard, string>> = {
  title: 'Title',
  pov: 'Point of view',
  location: 'Location',
  time: 'Time',
  purpose: 'Purpose',
  beats: 'Beats',
  characters: 'Characters',
  threads_touched: 'Threads',
  plot_points: 'Plot points',
  reveals: 'Reveals',
  mentions: 'Who speaks of what',
  deltas: 'State changes',
  sets_up: 'Sets up',
  pays_off: 'Pays off',
  outcome: 'Outcome',
};

/** Structural diff of two cards, field by field, only where they differ. */
export function CardDiff({ before, after, facts, names }: { before: SceneCard; after: SceneCard; facts: { id: string; statement: string }[]; names: (id: string) => string }) {
  const rows: ReactNode[] = [];
  for (const k of Object.keys(LABELS) as (keyof SceneCard)[]) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    let v: ReactNode;
    if (typeof a === 'string' || typeof b === 'string') v = <WordDiff a={String(a ?? '')} b={String(b ?? '')} />;
    else if (k === 'mentions') {
      const fmt = (m: { character: string; fact: string }) => `${names(m.character)} → ${factLabel(facts, m.fact)}`;
      v = <ListDiff a={(a as SceneCard['mentions']).map(fmt)} b={(b as SceneCard['mentions']).map(fmt)} />;
    } else if (k === 'deltas') {
      const fmt = (d: SceneCard['deltas'][number]) => `${names(d.character)}${d.learns.length ? ` learns ${d.learns.map((f) => factLabel(facts, f)).join('; ')}` : ''}${d.forgets.length ? ` forgets ${d.forgets.join(', ')}` : ''}${d.location ? ` → ${d.location}` : ''}`;
      v = <ListDiff a={(a as SceneCard['deltas']).map(fmt)} b={(b as SceneCard['deltas']).map(fmt)} />;
    } else if (k === 'reveals') {
      v = <ListDiff a={a as string[]} b={b as string[]} render={(x) => factLabel(facts, x)} />;
    } else if (k === 'beats') {
      v = <ListDiff a={a as string[]} b={b as string[]} />;
    } else {
      v = <ListDiff a={a as string[]} b={b as string[]} render={(x) => <Chip id={x}>{x}</Chip>} />;
    }
    rows.push(
      <div className="field-diff" key={k}>
        <div className="k">{LABELS[k]}</div>
        <div className="v">{v}</div>
      </div>,
    );
  }
  if (!rows.length) return <p className="muted">The card is unchanged.</p>;
  return <div>{rows}</div>;
}
