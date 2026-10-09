import type { RippleItem } from '../lib/types';

/**
 * Where a change lands, at a glance. The book runs clockwise round the outside, first scene
 * at the top; the change sits in the middle; each affected scene sits on its hop ring
 * (inner = directly affected) at its place in the story. A whole-book graph would show
 * everything connected to everything; this shows only what this change touches.
 */
export function BlastRadius({
  items,
  order,
  handled = [],
  selected,
  onSelect,
  colour,
  titles,
}: {
  items: RippleItem[];
  order: string[];
  handled?: string[];
  selected: string | null;
  onSelect: (scene: string) => void;
  colour: (it: RippleItem) => string;
  titles: Record<string, string>;
}) {
  const size = 236;
  const c = size / 2;
  const outer = 104;
  const rings = [0, 44, 68, 90];
  const gap = 0.06; // a small gap at the top between the end and the start of the book
  const angle = (scene: string) => {
    const i = Math.max(0, order.indexOf(scene));
    const f = order.length <= 1 ? 0.5 : i / (order.length - 1);
    return -Math.PI / 2 + (gap / 2 + f * (1 - gap)) * Math.PI * 2;
  };
  const at = (scene: string, r: number) => {
    const a = angle(scene);
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  };
  const origin = items.find((i) => i.kind === 'origin');
  const affected = items.filter((i) => i.kind !== 'origin');
  const inRound = new Set(items.map((i) => i.scene));

  return (
    <svg className="blast" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${affected.length} scenes affected by this change, by distance and place in the book`}>
      {rings.slice(1).map((r, i) => (
        <circle key={r} cx={c} cy={c} r={r} className="blast-ring" strokeDasharray={i === 2 ? '2 3' : undefined} />
      ))}
      {/* the book, clockwise from the top */}
      {order.map((s) => {
        const a = at(s, outer);
        const b = at(s, outer + 6);
        return <line key={s} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`blast-tick ${inRound.has(s) ? 'on' : handled.includes(s) ? 'done' : ''}`} />;
      })}
      <text x={c} y={c - outer - 10} className="blast-label" textAnchor="middle">
        start
      </text>
      {/* edges from the change outwards */}
      {affected.map((it) => {
        const p = at(it.scene, rings[it.hop] || rings[3]);
        const mid = at(it.scene, (rings[it.hop] || rings[3]) * 0.45);
        return <path key={`e-${it.scene}`} d={`M ${c} ${c} Q ${mid.x} ${mid.y} ${p.x} ${p.y}`} className="blast-edge" style={{ stroke: colour(it), opacity: it.hop >= 3 ? 0.25 : it.hop === 2 ? 0.45 : 0.7 }} />;
      })}
      {affected.map((it) => {
        const r = rings[it.hop] || rings[3];
        const p = at(it.scene, r);
        const q = at(it.scene, outer);
        return <line key={`s-${it.scene}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="blast-spoke" />;
      })}
      {affected.map((it) => {
        const p = at(it.scene, rings[it.hop] || rings[3]);
        const sel = it.scene === selected;
        return (
          <g key={it.scene} className="blast-node" transform={`translate(${p.x} ${p.y})`} onClick={() => onSelect(it.scene)} role="button" tabIndex={-1} aria-label={`${it.scene} ${titles[it.scene] ?? ''}`}>
            <title>{`${it.scene} ${titles[it.scene] ?? ''}\nhop ${it.hop}: ${it.reasons[0] ?? ''}`}</title>
            {sel && <circle r={10} className="blast-sel" />}
            <circle r={it.status === 'conflict' ? 6.5 : 5.5} style={{ fill: colour(it) }} />
            <text y={-9} textAnchor="middle" className="blast-id">
              {it.scene}
            </text>
          </g>
        );
      })}
      <g className="blast-node origin" transform={`translate(${c} ${c})`} onClick={() => origin && onSelect(origin.scene)} role="button" tabIndex={-1}>
        {origin && origin.scene === selected && <circle r={13} className="blast-sel" />}
        <title>{origin ? `${origin.scene}: your edit` : 'The change'}</title>
        <circle r={8} className="blast-origin" />
      </g>
    </svg>
  );
}
