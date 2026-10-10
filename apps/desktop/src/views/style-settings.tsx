import { useEffect, useState, type ReactNode } from 'react';
import { Check, Fingerprint as FingerprintIcon, GraduationCap, Plus, ScanText, X } from 'lucide-react';
import { get, post, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { Fingerprint, RuleSuggestion, StyleSheet } from '../lib/types';
import { cx, plural } from '../lib/util';
import { Badge, Button, Field, ListEditor, Segmented } from '../components/ui';
import { useDraft } from '../hooks/use-draft';
import { useUnsavedChanges } from '../lib/unsaved';

/**
 * The style sheet as dials. Enforced rules are checked by code on every word after every
 * write and repaired before the draft reaches you; guided ones are measured and nudged.
 */
export function StyleSettings() {
  const { project: p, toast, refresh, markSaved, fail } = useApp();
  // Drafts follow the server copy only while untouched, so a refresh never wipes edits.
  const sheetDraft = useDraft<StyleSheet>(p!.style.sheet);
  const samplesDraft = useDraft(p!.style.samples);
  const bannedDraft = useDraft(p!.style.banned);
  const { value: sheet, set: setSheet, dirty } = sheetDraft;
  const { value: samples, set: setSamples } = samplesDraft;
  const { value: banned, set: setBanned } = bannedDraft;
  useUnsavedChanges(dirty, 'style dials');
  useUnsavedChanges(samplesDraft.dirty || bannedDraft.dirty, 'voice samples and banned patterns');
  const [fit, setFit] = useState<{ fingerprint: Fingerprint; suggested: StyleSheet } | null>(null);
  const [learned, setLearned] = useState<{ edits: number; suggestions: RuleSuggestion[] } | null>(null);
  useEffect(() => {
    get('/style/suggestions').then(setLearned).catch(() => undefined);
  }, [p?.style.sheet]);

  const set = <K extends keyof StyleSheet>(k: K, v: StyleSheet[K]) => setSheet((cur) => ({ ...cur, [k]: v }));
  const saveSheet = async (next = sheet, msg = 'Style dials saved') => {
    try {
      // Keep the server's normalised copy so the draft is clean once the refresh lands.
      setSheet(await put<StyleSheet>('/style/sheet', { sheet: next }));
    } catch (e) {
      toast({ kind: 'error', message: 'Style dials not saved', detail: (e as Error).message });
      return;
    }
    markSaved();
    toast({ kind: 'success', message: msg, detail: 'Every scene written from now on is checked against them.' });
    refresh();
  };
  const fitSamples = () => post('/style/fingerprint', { text: samples }).then(setFit, fail('Could not measure the samples'));
  const checkAll = async () => {
    try {
      const r = await post<Record<string, { enforced: number; guided: number }>>('/style/check-all');
      const scenes = Object.values(r);
      const bad = scenes.filter((s) => s.enforced).length;
      toast({ kind: bad ? 'warning' : 'success', message: bad ? `${plural(bad, 'scene')} break a rule` : `All ${plural(scenes.length, 'scene')} hold to the sheet`, detail: bad ? 'They are flagged on the dashboard and underlined in the editor.' : undefined });
      refresh();
    } catch (e) {
      fail('Could not check the book')(e);
    }
  };
  const decide = (action: 'dismiss' | 'accept', id: string) =>
    post(`/style/suggestions/${action}`, { id }).then((r) => {
      setLearned((cur) => (cur ? { ...cur, ...r } : cur));
      if (action === 'accept') refresh();
    }, fail(action === 'accept' ? 'Could not add the rule' : 'Could not dismiss the suggestion'));

  return (
    <div className="stack lg">
      <div className="card">
        <div className="card-head">
          <h3>Style dials</h3>
          <span className="muted grow">Saved to style/style.yaml.</span>
          <Button size="sm" variant="ghost" icon={<ScanText />} onClick={checkAll}>
            Check the whole book
          </Button>
        </div>
        <div className="dials">
          <Dial label="Spelling" enforced>
            <Segmented value={sheet.spelling} onChange={(v) => set('spelling', v)} options={[{ value: 'any', label: 'Any' }, { value: 'uk', label: 'British' }, { value: 'us', label: 'American' }]} />
          </Dial>
          <Dial label="Dialogue quotes" enforced>
            <Segmented value={sheet.quotes} onChange={(v) => set('quotes', v)} options={[{ value: 'any', label: 'Any' }, { value: 'single', label: '‘Single’' }, { value: 'double', label: '“Double”' }]} />
          </Dial>
          <Dial label="Dialogue tags" enforced hint="Fancy tags (hissed, exclaimed) are replaced with said.">
            <Segmented value={sheet.dialogue_tags} onChange={(v) => set('dialogue_tags', v)} options={[{ value: 'any', label: 'Any' }, { value: 'simple', label: 'Plain' }, { value: 'said-only', label: 'Said only' }]} />
          </Dial>
          <Dial label="Em dashes" enforced>
            <div className="row">
              <Segmented value={sheet.em_dashes} onChange={(v) => set('em_dashes', v)} options={[{ value: 'allow', label: 'Allow' }, { value: 'limit', label: 'Limit' }, { value: 'ban', label: 'None' }]} />
              {sheet.em_dashes === 'limit' && <Num value={sheet.em_dashes_per_1000} onChange={(v) => set('em_dashes_per_1000', v)} suffix="per 1,000 words" step={0.5} />}
            </div>
          </Dial>
          <Dial label="Semicolons" enforced>
            <Segmented value={sheet.semicolons} onChange={(v) => set('semicolons', v)} options={[{ value: 'allow', label: 'Allow' }, { value: 'dialogue-only', label: 'Dialogue only' }, { value: 'ban', label: 'None' }]} />
          </Dial>
          <Dial label="Exclamation marks" enforced>
            <Segmented value={sheet.exclamations} onChange={(v) => set('exclamations', v)} options={[{ value: 'allow', label: 'Allow' }, { value: 'dialogue-only', label: 'Dialogue only' }, { value: 'ban', label: 'None' }]} />
          </Dial>
          <Dial label="Longest sentence" enforced>
            <Num value={sheet.sentence_words.max} onChange={(v) => set('sentence_words', { ...sheet.sentence_words, max: v })} suffix="words" />
          </Dial>
          <Dial label="Contractions in narration">
            <Segmented value={sheet.contractions} onChange={(v) => set('contractions', v)} options={[{ value: 'any', label: 'Fine' }, { value: 'avoid-in-narration', label: 'Avoid' }]} />
          </Dial>
          <Dial label="Average sentence">
            <div className="row">
              <Num value={sheet.sentence_words.mean_min} onChange={(v) => set('sentence_words', { ...sheet.sentence_words, mean_min: v })} />
              <span className="faint">to</span>
              <Num value={sheet.sentence_words.mean_max} onChange={(v) => set('sentence_words', { ...sheet.sentence_words, mean_max: v })} suffix="words" />
            </div>
          </Dial>
          <Dial label="Dialogue share">
            <div className="row">
              <Num value={Math.round(sheet.dialogue_share.min * 100)} onChange={(v) => set('dialogue_share', { ...sheet.dialogue_share, min: v / 100 })} />
              <span className="faint">to</span>
              <Num value={Math.round(sheet.dialogue_share.max * 100)} onChange={(v) => set('dialogue_share', { ...sheet.dialogue_share, max: v / 100 })} suffix="%" />
            </div>
          </Dial>
          <Dial label="Paragraph length">
            <Num value={sheet.paragraph_sentences_max} onChange={(v) => set('paragraph_sentences_max', v)} suffix="sentences at most" />
          </Dial>
          <Dial label="Adverbs">
            <Num value={sheet.adverbs_per_1000_max} onChange={(v) => set('adverbs_per_1000_max', v)} suffix="per 1,000 words at most" />
          </Dial>
          <Dial label="Filter words" hint="“She saw”, “he felt”, “she noticed”.">
            <Num value={sheet.filter_words_per_1000_max} onChange={(v) => set('filter_words_per_1000_max', v)} suffix="per 1,000 words at most" />
          </Dial>
          <Dial label="Repair rounds" hint="Line-edit rounds after each draft. Each is kept only if it fixes something without breaking anything.">
            <Segmented value={String(sheet.repair_passes) as '0'} onChange={(v) => set('repair_passes', Number(v))} options={['0', '1', '2', '3', '4'].map((n) => ({ value: n as '0', label: n }))} />
          </Dial>
        </div>
        <div className="grid-2" style={{ marginTop: 18 }}>
          <Field label={<span className="row" style={{ gap: 6 }}>Never use <Badge kind="accent">Enforced</Badge></span>} hint="Words and phrases that must not appear anywhere.">
            <ListEditor items={sheet.never} onChange={(v) => set('never', v)} numbered={false} placeholder="Add a word or phrase" />
          </Field>
          <Field label={<span className="row" style={{ gap: 6 }}>Always write <Badge kind="accent">Enforced</Badge></span>} hint="Replaced automatically wherever they appear.">
            <PreferEditor items={sheet.prefer} onChange={(v) => set('prefer', v)} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Guidance" hint="Rules only a reader can judge. The writer and the line editor are told; a judge checks.">
            <ListEditor items={sheet.guidance} onChange={(v) => set('guidance', v)} numbered={false} placeholder="Feeling carried in objects and gestures, never named" />
          </Field>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <Button variant="primary" icon={<Check />} onClick={() => saveSheet()} disabled={!dirty}>
            Save dials
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={sheetDraft.reset}>
              Discard
            </Button>
          )}
        </div>
      </div>

      {learned && (learned.suggestions.length > 0 || learned.edits > 0) && (
        <div className="card">
          <div className="card-head">
            <h3>
              <GraduationCap size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
              Learned from your edits
            </h3>
            <span className="muted">{plural(learned.edits, 'hand edit')} so far</span>
          </div>
          {learned.suggestions.length ? (
            <div className="list">
              {learned.suggestions.map((s) => (
                <div key={s.id} className="list-item" style={{ cursor: 'default' }}>
                  <span className="grow">
                    <div className="primary-text">{s.title}</div>
                    <div className="secondary-text">{s.evidence}</div>
                  </span>
                  <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Not a rule" onClick={() => decide('dismiss', s.id)} />
                  <Button size="sm" variant="success" icon={<Plus />} onClick={() => decide('accept', s.id)}>
                    Add rule
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Nothing repeated yet. When you make the same change a few times, it shows up here as a rule you can keep.</p>
          )}
        </div>
      )}

      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h3>Voice samples</h3>
          <Button size="sm" icon={<FingerprintIcon />} onClick={fitSamples} disabled={!samples.trim()}>
            Set the dials from these
          </Button>
        </div>
        <p className="muted">A few paragraphs written the way the book should sound. Your own writing works best. The writer matches them, and the dials can be measured from them.</p>
        <textarea className="textarea prose" rows={12} value={samples} onChange={(e) => setSamples(e.target.value)} />
        {fit && <FitResult fit={fit} current={sheet} onUse={() => (setSheet(fit.suggested), setFit(null), saveSheet(fit.suggested, 'Dials set from your samples'))} onClose={() => setFit(null)} />}
      </div>
      <div className="card stack">
        <h3>Banned patterns</h3>
        <p className="muted">
          One per list item. Plain phrases match whole words; <span className="mono">/regex/</span> for patterns; add <span className="mono">(max 2 per scene)</span> to allow a few. Checked mechanically after every write, and underlined in the editor.
        </p>
        <textarea className="textarea mono" rows={14} value={banned} onChange={(e) => setBanned(e.target.value)} style={{ fontSize: 12.5 }} />
      </div>
      <div>
        <Button
          variant="primary"
          icon={<Check />}
          onClick={async () => {
            try {
              await put('/style', { samples, banned });
            } catch (e) {
              toast({ kind: 'error', message: 'Samples and patterns not saved', detail: (e as Error).message });
              return;
            }
            markSaved();
            toast({ kind: 'success', message: 'Samples and patterns saved' });
            refresh();
          }}
        >
          Save samples and patterns
        </Button>
      </div>
    </div>
  );
}

function Dial({ label, enforced, hint, children }: { label: string; enforced?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className={cx('dial', enforced && 'enforced')}>
      <div className="dial-label">
        <span>{label}</span>
        <span className={cx('dial-kind', enforced ? 'enforced' : 'guided')} title={enforced ? 'Checked by code on every word; repaired before you see the draft' : 'Measured and nudged; reported, never blocking'}>
          {enforced ? 'Enforced' : 'Guided'}
        </span>
        {hint && <div className="faint dial-hint">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Num({ value, onChange, suffix, step = 1 }: { value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <input className="input num-input" type="number" min={0} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="faint" style={{ fontSize: 'var(--fs-label)' }}>{suffix}</span>}
    </span>
  );
}

function PreferEditor({ items, onChange }: { items: { avoid: string; use: string }[]; onChange: (v: { avoid: string; use: string }[]) => void }) {
  const [avoid, setAvoid] = useState('');
  const [use, setUse] = useState('');
  const add = () => {
    if (!avoid.trim() || !use.trim()) return;
    onChange([...items, { avoid: avoid.trim(), use: use.trim() }]);
    setAvoid('');
    setUse('');
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {items.map((x, i) => (
        <div key={i} className="row prefer-row">
          <span className="mono" style={{ textDecoration: 'line-through', color: 'var(--text-3)' }}>{x.avoid}</span>
          <span className="faint">→</span>
          <span className="mono grow">{x.use}</span>
          <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="row">
        <input className="input" placeholder="gaze" value={avoid} onChange={(e) => setAvoid(e.target.value)} />
        <span className="faint">→</span>
        <input className="input" placeholder="look" value={use} onChange={(e) => setUse(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button size="sm" iconOnly icon={<Plus />} tip="Add" onClick={add} />
      </div>
    </div>
  );
}

function FitResult({ fit, current, onUse, onClose }: { fit: { fingerprint: Fingerprint; suggested: StyleSheet }; current: StyleSheet; onUse: () => void; onClose: () => void }) {
  const f = fit.fingerprint;
  const s = fit.suggested;
  const changes: [string, string, string][] = [];
  const cmp = (label: string, a: unknown, b: unknown, fmt = (x: unknown) => String(x)) => fmt(a) !== fmt(b) && changes.push([label, fmt(a), fmt(b)]);
  cmp('Spelling', current.spelling, s.spelling);
  cmp('Quotes', current.quotes, s.quotes);
  cmp('Em dashes', `${current.em_dashes}${current.em_dashes === 'limit' ? ` ${current.em_dashes_per_1000}` : ''}`, `${s.em_dashes}${s.em_dashes === 'limit' ? ` ${s.em_dashes_per_1000}` : ''}`);
  cmp('Semicolons', current.semicolons, s.semicolons);
  cmp('Exclamations', current.exclamations, s.exclamations);
  cmp('Average sentence', `${current.sentence_words.mean_min}–${current.sentence_words.mean_max}`, `${s.sentence_words.mean_min}–${s.sentence_words.mean_max}`);
  cmp('Longest sentence', current.sentence_words.max, s.sentence_words.max);
  cmp('Adverbs per 1,000', current.adverbs_per_1000_max, s.adverbs_per_1000_max);
  return (
    <div className="fit">
      <div className="row">
        <strong className="grow">Your samples, measured</strong>
        <Button size="sm" variant="ghost" iconOnly icon={<X />} tip="Close" onClick={onClose} />
      </div>
      <div className="fit-stats">
        <Stat v={f.sentence_mean} l="words a sentence" />
        <Stat v={`${Math.round(f.dialogue_share * 100)}%`} l="dialogue" />
        <Stat v={f.adverbs_per_1000} l="adverbs / 1,000" />
        <Stat v={f.em_dashes_per_1000} l="em dashes / 1,000" />
        <Stat v={f.quotes} l="quotes" />
        <Stat v={f.spelling === 'unknown' ? '—' : f.spelling.toUpperCase()} l="spelling" />
      </div>
      {f.words < 300 && <p className="faint" style={{ fontSize: 'var(--fs-label)' }}>Only {f.words} words. A thousand or more gives steadier numbers.</p>}
      {changes.length ? (
        <>
          <table className="table compact">
            <tbody>
              {changes.map(([l, a, b]) => (
                <tr key={l}>
                  <td className="muted">{l}</td>
                  <td className="faint" style={{ textDecoration: 'line-through' }}>{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="primary" icon={<Check />} onClick={onUse} style={{ alignSelf: 'flex-start' }}>
            Use these dials
          </Button>
        </>
      ) : (
        <p className="muted">Your dials already match your samples.</p>
      )}
    </div>
  );
}

function Stat({ v, l }: { v: ReactNode; l: string }) {
  return (
    <div className="stat">
      <div className="stat-v num">{v}</div>
      <div className="stat-l">{l}</div>
    </div>
  );
}
