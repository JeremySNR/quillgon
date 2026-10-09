import { useEffect, useState } from 'react';
import { BookOpen, Check, Cpu, Download, Palette, RotateCcw, ScrollText, Type, Waves, FolderOpen } from 'lucide-react';
import { get, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Book } from '../lib/types';
import { loadPref, money, savePref } from '../lib/util';
import { Badge, Button, Field, Segmented } from '../components/ui';
import { StyleSettings } from './style-settings';

const TABS = [
  { id: 'book', label: 'Book', icon: BookOpen },
  { id: 'models', label: 'Models and cost', icon: Cpu },
  { id: 'style', label: 'Style', icon: Type },
  { id: 'prompts', label: 'Agent prompts', icon: ScrollText },
  { id: 'appearance', label: 'Appearance', icon: Palette },
] as const;

export function SettingsView({ tab }: { tab?: string }) {
  const { project: p, go } = useApp();
  const current = TABS.some((t) => t.id === tab) ? tab! : 'book';
  if (!p) return null;
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p className="sub">Everything here is a plain file in your book’s folder: book.yaml, style/, prompts/.</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 28, alignItems: 'start' }}>
          <nav className="settings-nav list">
            {TABS.map((t) => (
              <button key={t.id} className="nav-item" aria-current={current === t.id ? 'page' : undefined} onClick={() => go('settings', t.id)}>
                <t.icon /> <span className="label">{t.label}</span>
              </button>
            ))}
          </nav>
          <div>
            {current === 'book' && <BookSettings />}
            {current === 'models' && <ModelSettings />}
            {current === 'style' && <StyleSettings />}
            {current === 'prompts' && <PromptSettings />}
            {current === 'appearance' && <Appearance />}
          </div>
        </div>
      </div>
    </div>
  );
}

function useSaver() {
  const { toast, refresh, markSaved } = useApp();
  return async (fn: () => Promise<unknown>, msg = 'Saved') => {
    try {
      await fn();
      markSaved();
      toast({ kind: 'success', message: msg });
      refresh();
    } catch (e) {
      toast({ kind: 'error', message: 'Not saved', detail: (e as Error).message });
    }
  };
}

function BookSettings() {
  const { project: p } = useApp();
  const save = useSaver();
  const [b, setB] = useState<Book>(p!.book);
  useEffect(() => setB(p!.book), [p!.book]);
  return (
    <div className="stack lg">
      <div className="card stack lg">
        <Field label="Title">
          <input className="input" value={b.title} onChange={(e) => setB({ ...b, title: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Genre">
            <input className="input" value={b.genre} onChange={(e) => setB({ ...b, genre: e.target.value })} />
          </Field>
          <Field label="Target length (words)">
            <input className="input num" type="number" step={1000} value={b.target_words} onChange={(e) => setB({ ...b, target_words: Number(e.target.value) })} />
          </Field>
          <Field label="Point of view">
            <select className="select" value={b.pov_mode} onChange={(e) => setB({ ...b, pov_mode: e.target.value as Book['pov_mode'] })}>
              <option value="first">First person</option>
              <option value="third-limited">Third person limited</option>
              <option value="third-omniscient">Third person omniscient</option>
              <option value="multiple">Multiple</option>
            </select>
          </Field>
          <Field label="Tense">
            <select className="select" value={b.tense} onChange={(e) => setB({ ...b, tense: e.target.value as Book['tense'] })}>
              <option value="past">Past</option>
              <option value="present">Present</option>
            </select>
          </Field>
        </div>
        <div>
          <Button variant="primary" icon={<Check />} onClick={() => save(() => put('/book', { book: b }))}>
            Save
          </Button>
        </div>
      </div>
      <div className="card stack">
        <div className="card-head">
          <Waves size={16} />
          <h3>Ripples</h3>
        </div>
        <div className="grid-3">
          <Field label="Hop limit" hint="1 = direct references only; 2 adds threads and character state.">
            <select className="select" value={b.ripple.hop_limit} onChange={(e) => setB({ ...b, ripple: { ...b.ripple, hop_limit: Number(e.target.value) } })}>
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field label="Cascade cap" hint="Rounds before a ripple stops and reports.">
            <input className="input num" type="number" min={1} max={10} value={b.ripple.round_cap} onChange={(e) => setB({ ...b, ripple: { ...b.ripple, round_cap: Number(e.target.value) } })} />
          </Field>
          <Field label="Similarity threshold" hint="For listing related scenes (hop 3).">
            <input className="input num" type="number" step={0.02} min={0} max={1} value={b.ripple.similarity_threshold} onChange={(e) => setB({ ...b, ripple: { ...b.ripple, similarity_threshold: Number(e.target.value) } })} />
          </Field>
        </div>
        <div>
          <Button icon={<Check />} onClick={() => save(() => put('/book', { book: b }))}>
            Save
          </Button>
        </div>
      </div>
      <div className="card stack">
        <div className="card-head">
          <FolderOpen size={16} />
          <h3>Files</h3>
        </div>
        <p className="mono muted">{p!.dir}</p>
        <div className="btn-row">
          <Button icon={<Download />} onClick={() => save(() => get('/export?format=md'), 'Exported to export/')}>
            Export Markdown
          </Button>
          <Button icon={<Download />} onClick={() => save(() => get('/export?format=docx'), 'Exported .docx')}>
            Export .docx
          </Button>
          <Button icon={<Download />} onClick={() => save(() => get('/export?format=epub'), 'Exported .epub')}>
            Export .epub
          </Button>
        </div>
        <span className="faint">.docx and .epub need Pandoc installed.</span>
      </div>
    </div>
  );
}

const TIERS = ['frontier', 'mid', 'small', 'reader'] as const;
const DEFAULTS: Record<string, { model: string; price_in: number; price_out: number; effort: string }> = {
  frontier: { model: 'claude-opus-5-5', price_in: 4, price_out: 20, effort: 'high' },
  mid: { model: 'claude-sonnet-5-5', price_in: 2, price_out: 10, effort: 'medium' },
  small: { model: 'claude-haiku-5-5', price_in: 0.1, price_out: 0.5, effort: 'low' },
  reader: { model: 'claude-sonnet-5-5', price_in: 2, price_out: 10, effort: 'medium' },
};
const AGENTS = ['interviewer', 'planner', 'writer', 'reviser', 'extractor', 'voice', 'humaniser', 'reader', 'continuity'] as const;
const AGENT_DEFAULT: Record<string, string> = { interviewer: 'frontier', planner: 'frontier', writer: 'frontier', reviser: 'frontier', extractor: 'mid', voice: 'mid', humaniser: 'mid', reader: 'reader', continuity: 'small' };

function ModelSettings() {
  const { project: p } = useApp();
  const save = useSaver();
  const [b, setB] = useState<Book>(p!.book);
  useEffect(() => setB(p!.book), [p!.book]);
  const tier = (t: (typeof TIERS)[number]) => ({ provider: 'anthropic', ...DEFAULTS[t], ...(b.models[t] ?? {}) }) as Required<Book['models']>['frontier'];
  const setTier = (t: (typeof TIERS)[number], patch: object) => setB({ ...b, models: { ...b.models, [t]: { ...tier(t), ...patch } } });
  const offline = tier('frontier').provider === 'offline';
  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="row">
          <h3 className="grow">Models by tier</h3>
          <Segmented
            value={offline ? 'offline' : 'live'}
            options={[
              { value: 'live', label: 'Claude' },
              { value: 'offline', label: 'Offline' },
            ]}
            onChange={(v) => {
              const models = Object.fromEntries(TIERS.map((t) => [t, v === 'offline' ? { provider: 'offline', model: 'offline', price_in: 0, price_out: 0 } : { provider: 'anthropic', ...DEFAULTS[t] }]));
              setB({ ...b, models });
            }}
          />
        </div>
        <p className="muted">Each agent uses a tier. Swap providers here; an OpenAI-compatible endpoint works too (set its base URL and the environment variable holding its key). Run the reader on a different vendor than the writer if you can.</p>
        {offline && <div className="banner warning" style={{ marginBottom: 0 }}><Cpu /><div className="banner-body"><span className="banner-title">Offline models</span><span>Placeholder output for trying the app. No API calls, no cost.</span></div></div>}
        {!offline &&
          TIERS.map((t) => {
            const m = tier(t);
            return (
              <div key={t} className="grid-3" style={{ gridTemplateColumns: '100px 1.4fr 1fr 1fr 1fr', alignItems: 'end' }}>
                <div style={{ paddingBottom: 8 }}>
                  <Badge kind="outline">{t}</Badge>
                </div>
                <Field label="Model">
                  <input className="input mono" value={m.model} onChange={(e) => setTier(t, { model: e.target.value })} />
                </Field>
                <Field label="Provider">
                  <select className="select" value={m.provider} onChange={(e) => setTier(t, { provider: e.target.value })}>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </select>
                </Field>
                <Field label="Effort">
                  <select className="select" value={m.effort ?? 'medium'} onChange={(e) => setTier(t, { effort: e.target.value })}>
                    {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="$ / M tokens in · out">
                  <div className="row">
                    <input className="input num" type="number" step={0.1} value={m.price_in ?? 0} onChange={(e) => setTier(t, { price_in: Number(e.target.value) })} />
                    <input className="input num" type="number" step={0.1} value={m.price_out ?? 0} onChange={(e) => setTier(t, { price_out: Number(e.target.value) })} />
                  </div>
                </Field>
                {m.provider === 'openai-compatible' && (
                  <>
                    <div />
                    <Field label="Base URL">
                      <input className="input mono" value={m.base_url ?? ''} onChange={(e) => setTier(t, { base_url: e.target.value })} placeholder="https://api.example.com/v1" />
                    </Field>
                    <Field label="Key variable">
                      <input className="input mono" value={m.api_key_env ?? ''} onChange={(e) => setTier(t, { api_key_env: e.target.value })} placeholder="OPENAI_API_KEY" />
                    </Field>
                  </>
                )}
              </div>
            );
          })}
        {!offline && (
          <>
            <div className="section-title">Which tier each agent uses</div>
            <div className="grid-3">
              {AGENTS.map((a) => (
                <Field key={a} label={a}>
                  <select className="select" value={b.agents[a] ?? AGENT_DEFAULT[a]} onChange={(e) => setB({ ...b, agents: { ...b.agents, [a]: e.target.value as never } })}>
                    {TIERS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </>
        )}
        <div>
          <Button variant="primary" icon={<Check />} onClick={() => save(() => put('/book', { book: b }))}>
            Save models
          </Button>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Cost</h3>
          <Badge kind="accent">{money(p!.costs.total_usd)} spent</Badge>
        </div>
        <table className="table" style={{ boxShadow: 'none' }}>
          <thead>
            <tr>
              <th>Pending work</th>
              <th>Model</th>
              <th style={{ textAlign: 'right' }}>Calls</th>
              <th style={{ textAlign: 'right' }}>Estimate</th>
            </tr>
          </thead>
          <tbody>
            {p!.estimate.lines.map((l) => (
              <tr key={l.stage} style={{ cursor: 'default' }}>
                <td>{l.stage}</td>
                <td className="mono muted">{l.model}</td>
                <td className="num" style={{ textAlign: 'right' }}>{l.calls}</td>
                <td className="num" style={{ textAlign: 'right' }}>{money(l.cost_usd)}</td>
              </tr>
            ))}
            <tr style={{ cursor: 'default' }}>
              <td colSpan={3}>
                <strong>Total to finish</strong>
              </td>
              <td className="num" style={{ textAlign: 'right' }}>
                <strong>{money(p!.estimate.total_usd)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PromptSettings() {
  const save = useSaver();
  const [prompts, setPrompts] = useState<{ name: string; text: string; builtin: string; overridden: boolean }[]>([]);
  const [sel, setSel] = useState('writer');
  const [text, setText] = useState('');
  const load = () =>
    get('/prompts').then((ps) => {
      setPrompts(ps);
      setText(ps.find((x: { name: string }) => x.name === sel)?.text ?? '');
    });
  useEffect(() => {
    load();
  }, []);
  useEffect(() => setText(prompts.find((x) => x.name === sel)?.text ?? ''), [sel]);
  const cur = prompts.find((x) => x.name === sel);
  return (
    <div className="card stack">
      <div className="row">
        <h3 className="grow">Agent prompts</h3>
        <select className="select" style={{ width: 180 }} value={sel} onChange={(e) => setSel(e.target.value)}>
          {prompts.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
              {x.overridden ? ' (edited)' : ''}
            </option>
          ))}
        </select>
      </div>
      <p className="muted">Plain Markdown. Edits are saved to prompts/{sel}.md in your book and used instead of the built-in prompt. The intent and its hard rules are always added on top.</p>
      <textarea className="textarea prompt-editor" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="btn-row">
        <Button variant="primary" icon={<Check />} onClick={() => save(() => put(`/prompts/${sel}`, { text }).then(load), 'Prompt saved')}>
          Save prompt
        </Button>
        {cur?.overridden && (
          <Button variant="ghost" icon={<RotateCcw />} onClick={() => save(() => put(`/prompts/${sel}`, { reset: true }).then(load), 'Reset to built-in')}>
            Reset to built-in
          </Button>
        )}
      </div>
    </div>
  );
}

function Appearance() {
  const [theme, setTheme] = useState<string>(() => loadPref('theme', 'system'));
  const [size, setSize] = useState<number>(() => loadPref('proseSize', 19));
  const [measure, setMeasure] = useState<number>(() => loadPref('measure', 66));
  const apply = (t: string) => {
    setTheme(t);
    savePref('theme', t);
    try {
      localStorage.setItem('ne.theme', t);
    } catch {
      // ignore
    }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  useEffect(() => {
    document.documentElement.style.setProperty('--prose-size', `${size}px`);
    savePref('proseSize', size);
  }, [size]);
  useEffect(() => {
    document.documentElement.style.setProperty('--prose-measure', `${measure}ch`);
    savePref('measure', measure);
  }, [measure]);
  return (
    <div className="card stack lg">
      <Field label="Theme">
        <Segmented
          value={theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={apply}
        />
      </Field>
      <Field label={`Prose size · ${size}px`}>
        <input type="range" min={16} max={23} value={size} onChange={(e) => setSize(Number(e.target.value))} />
      </Field>
      <Field label={`Line length · ${measure} characters`} hint="50–75 characters reads best.">
        <input type="range" min={50} max={80} value={measure} onChange={(e) => setMeasure(Number(e.target.value))} />
      </Field>
      <div className="prose-readonly" style={{ maxWidth: `${measure}ch` }}>
        <p>The water below them made small sounds against the wall, nothing more. She found she was crying, and that she did not mind.</p>
      </div>
    </div>
  );
}
