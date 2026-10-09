import { useState } from 'react';

export interface ChartPoint {
  id: string;
  label: string;
  value: number;
  act?: string;
}

/** Engagement by scene: a calm line with boredom runs shaded and early guesses marked. */
export function EngagementChart({
  points,
  boredom = [],
  predictions = [],
  acts = [],
  onSelect,
  selected,
  height = 260,
}: {
  points: ChartPoint[];
  boredom?: { from: string; to: string }[];
  predictions?: { from: string; to: string; label: string }[];
  acts?: { id: string; title: string }[];
  onSelect?: (id: string) => void;
  selected?: string | null;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 960;
  const H = height;
  const pad = { l: 36, r: 16, t: 28, b: 34 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - 1) / 4) * ih;
  const idx = (id: string) => points.findIndex((p) => p.id === id);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = points.length ? `${path} L${x(points.length - 1)},${pad.t + ih} L${x(0)},${pad.t + ih} Z` : '';
  const actStarts = acts.map((a) => ({ ...a, i: points.findIndex((p) => p.act === a.id) })).filter((a) => a.i >= 0);
  const step = points.length > 1 ? iw / (points.length - 1) : iw;
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reader engagement by scene">
        <defs>
          <linearGradient id="area-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--warning)" />
          </marker>
        </defs>
        {boredom.map((b) => {
          const a = idx(b.from);
          const z = idx(b.to);
          return <rect key={b.from} className="bored" x={x(a) - step / 2} y={pad.t} width={x(z) - x(a) + step} height={ih} rx="6" />;
        })}
        <g className="grid">
          {[1, 2, 3, 4, 5].map((v) => (
            <line key={v} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
          ))}
        </g>
        <g className="axis">
          {[1, 3, 5].map((v) => (
            <text key={v} x={pad.l - 12} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          ))}
          {points.map((p, i) => (points.length <= 24 || i % Math.ceil(points.length / 24) === 0 ? <text key={p.id} x={x(i)} y={H - 10} textAnchor="middle">{p.id}</text> : null))}
        </g>
        {actStarts.map((a, k) => (
          <g key={a.id}>
            {k > 0 && <line className="act-sep" x1={x(a.i) - step / 2} x2={x(a.i) - step / 2} y1={pad.t - 14} y2={pad.t + ih} />}
            <text className="act-label" x={x(a.i) - (k > 0 ? step / 2 - 6 : 0)} y={pad.t - 14}>
              {a.title}
            </text>
          </g>
        ))}
        <path className="area" d={area} />
        <path className="line" d={path} />
        {predictions.map((p, k) => {
          const a = idx(p.from);
          const b = idx(p.to);
          if (a < 0 || b < 0) return null;
          const yy = pad.t + 8 + k * 6;
          return <path key={k} className="pred" d={`M${x(a)},${yy} C${x(a)},${yy - 18} ${x(b)},${yy - 18} ${x(b)},${yy}`} />;
        })}
        {points.map((p, i) => (
          <circle
            key={p.id}
            className={`pt ${hover === i || selected === p.id ? 'on' : ''}`}
            cx={x(i)}
            cy={y(p.value)}
            r={4}
            tabIndex={0}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect?.(p.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect?.(p.id)}
          >
            <title>{`${p.id} ${p.label}: ${p.value}/5`}</title>
          </circle>
        ))}
      </svg>
      {hover !== null && points[hover] && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover].value) / H) * 100}%` }}>
          <strong>
            <span className="mono faint">{points[hover].id}</span> {points[hover].label}
          </strong>
          <div className="muted">Engagement {points[hover].value} / 5</div>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 160, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (!values.length) return null;
  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width);
  const y = (v: number) => height - 3 - ((v - 1) / 4) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
