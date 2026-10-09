import { useEffect, useRef } from 'react';
import { EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, placeholder as ph, type DecorationSet, type ViewUpdate } from '@codemirror/view';

export interface StyleMark {
  from: number;
  to: number;
  kind: 'enforced' | 'guided';
  message: string;
}

/** Style-sheet marks from the server's checker, mapped through edits until the next check. */
const setMarks = StateEffect.define<StyleMark[]>();
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setMarks)) {
        const len = tr.state.doc.length;
        deco = Decoration.set(
          e.value
            .filter((m) => m.to > m.from && m.to <= len)
            .sort((a, b) => a.from - b.from)
            .map((m) => Decoration.mark({ class: m.kind === 'enforced' ? 'cm-style-enforced' : 'cm-style-guided', attributes: { title: m.message } }).range(m.from, m.to)),
          true,
        );
      }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

/**
 * The prose editor: plain text in the reading font, soft-wrapped in a 66ch column.
 * Banned patterns are underlined as you type; style-sheet violations as soon as the checker answers.
 */
export function ProseEditor({
  value,
  onChange,
  banned,
  placeholder,
  readOnly,
  marks = [],
  jump,
}: {
  value: string;
  onChange: (v: string) => void;
  banned: RegExp[];
  placeholder?: string;
  readOnly?: boolean;
  marks?: StyleMark[];
  /** Select and scroll to a range; change the object to jump again. */
  jump?: { from: number; to: number } | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const decorators = banned.map(
      (re) => new MatchDecorator({ regexp: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), decoration: Decoration.mark({ class: 'cm-banned', attributes: { title: 'Banned pattern' } }) }),
    );
    const bannedPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(v: EditorView) {
          this.decorations = this.build(v);
        }
        build(v: EditorView) {
          const sets = decorators.map((d) => d.createDeco(v));
          const ranges: { from: number; to: number; value: Decoration }[] = [];
          for (const s of sets) s.between(0, v.state.doc.length, (from, to, value) => void ranges.push({ from, to, value }));
          ranges.sort((a, b) => a.from - b.from || a.to - b.to);
          return Decoration.set(ranges.map((r) => r.value.range(r.from, r.to)), true);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    );
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          ph(placeholder ?? 'Write, or generate this scene from its card…'),
          bannedPlugin,
          marksField,
          EditorView.contentAttributes.of({ 'aria-label': 'Scene prose', spellcheck: 'true' }),
          EditorView.updateListener.of((u) => u.docChanged && onChangeRef.current(u.state.doc.toString())),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, banned.map((b) => b.source).join('|')]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setMarks.of(marks) });
  }, [marks, readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump || jump.to > v.state.doc.length) return;
    v.dispatch({ selection: EditorSelection.range(jump.from, jump.to), effects: EditorView.scrollIntoView(jump.from, { y: 'center' }) });
    v.focus();
  }, [jump]);

  return <div ref={host} />;
}

/** Parse banned-patterns.md into regexes the editor can underline (mirrors the core parser). */
export function bannedRegexes(text: string): RegExp[] {
  const out: RegExp[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (!m) continue;
    let item = m[1].replace(/\(max\s+\d+.*\)\s*$/i, '').trim();
    const lab = item.match(/^[\w\s-]+:\s+(\/.*\/[a-z]*|".*")$/);
    if (lab) item = lab[1];
    try {
      const re = item.match(/^\/(.*)\/([a-z]*)$/);
      if (re) out.push(new RegExp(re[1], re[2].replace('g', '')));
      else {
        const phrase = item.replace(/^"(.*)"$/, '$1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        out.push(new RegExp(`${/^\w/.test(item) ? '\\b' : ''}${phrase}${/\w"?$/.test(item) ? '\\b' : ''}`, 'i'));
      }
    } catch {
      // skip bad patterns; validation reports them
    }
  }
  return out.filter((r) => r.source !== '—');
}
