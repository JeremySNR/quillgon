import { useEffect, useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, GripVertical, Lock, Plus, ListTree, Hammer, FileText } from 'lucide-react';
import { post, put } from '../lib/api';
import { useApp } from '../lib/app';
import type { SceneSummary, Snapshot, Structure } from '../lib/types';
import { cx, firstName, plural } from '../lib/util';
import { Avatar, Badge, Button, Chip, Empty, Kbd, SyncBadge } from '../components/ui';

type Row = { key: string; kind: 'act' | 'chapter' | 'scene'; id: string };

function flatten(st: Structure): Row[] {
  const rows: Row[] = [];
  for (const a of st.acts) {
    rows.push({ key: `act:${a.id}`, kind: 'act', id: a.id });
    for (const c of a.chapters) {
      rows.push({ key: `ch:${c.id}`, kind: 'chapter', id: c.id });
      for (const s of c.scenes) rows.push({ key: s, kind: 'scene', id: s });
    }
  }
  return rows;
}

function rebuild(st: Structure, rows: Row[]): Structure {
  const next: Structure = structuredClone(st);
  const chapters = new Map(next.acts.flatMap((a) => a.chapters).map((c) => [c.id, c]));
  for (const c of chapters.values()) c.scenes = [];
  let current: Structure['acts'][number]['chapters'][number] | undefined = next.acts[0]?.chapters[0];
  for (const r of rows) {
    if (r.kind === 'chapter') current = chapters.get(r.id);
    else if (r.kind === 'scene' && current) current.scenes.push(r.id);
  }
  return next;
}

export function Outline() {
  const { project: p, go, toast, refresh, markSaved } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (p) setRows(flatten(p.structure));
  }, [p?.structure]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const byId = useMemo(() => new Map((p?.scenes ?? []).map((s) => [s.id, s])), [p?.scenes]);

  if (!p) return null;
  if (!p.structure.acts.length)
    return (
      <div className="page">
        <Empty icon={<ListTree />} title="No outline yet" actions={<Button variant="primary" icon={<Hammer />} onClick={() => go('build', 'structure')}>Choose a structure</Button>}>
          The outline appears once you pick an act and chapter structure. Start with your intent and plot points in Build.
        </Empty>
      </div>
    );

  const commit = async (next: Row[], prev: Row[]) => {
    setRows(next);
    try {
      const r = await put<{ change: any; impact: any }>('/structure', { structure: rebuild(p.structure, next) });
      markSaved();
      if (r.change) {
        const n = r.impact.impacts.filter((i: any) => i.hop <= 2).length;
        toast({
          kind: n ? 'warning' : 'success',
          message: n ? `Reordering affects ${plural(n, 'scene')}` : 'Scenes reordered',
          detail: n ? 'Some characters now talk about things before they learn them.' : undefined,
          action: n
            ? { label: 'Review ripple', run: () => post('/ripple/start', { change: r.change }).then(() => go('ripple')) }
            : { label: 'Undo', run: () => put('/structure', { structure: rebuild(p.structure, prev) }).then(refresh) },
        });
      }
      refresh();
    } catch (e) {
      setRows(prev);
      toast({ kind: 'error', message: 'Could not reorder', detail: (e as Error).message });
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = rows.findIndex((r) => r.key === e.active.id);
    let to = rows.findIndex((r) => r.key === e.over!.id);
    if (to === 0) to = 1;
    const next = arrayMove(rows, from, to);
    if (next[1]?.kind !== 'chapter' && next.findIndex((r) => r.kind === 'scene') < next.findIndex((r) => r.kind === 'chapter')) return;
    commit(next, rows);
  };

  const move = (id: string, dir: -1 | 1) => {
    const from = rows.findIndex((r) => r.key === id);
    let to = from + dir;
    while (to > 0 && to < rows.length && rows[to].kind === 'act') to += dir;
    if (to <= 1 || to >= rows.length) return;
    commit(arrayMove(rows, from, to), rows);
  };

  const addScene = async (chapter: string) => {
    const r = await post<{ id: string }>('/scenes', { chapter, title: 'New scene' });
    await refresh();
    go('scene', r.id);
  };

  const chapterOf = new Map(p.structure.acts.flatMap((a) => a.chapters.map((c) => [c.id, c])));
  const actOf = new Map(p.structure.acts.map((a) => [a.id, a]));
  const words = (ids: string[]) => ids.reduce((n, id) => n + (byId.get(id)?.words ?? 0), 0);

  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <span className="eyebrow">THE BIG PICTURE</span><h1>Manuscript</h1>
            <p className="sub">
              Your story, scene by scene. Drag to reorder, or use <Kbd>⌥</Kbd>
              <Kbd>↑</Kbd>/<Kbd>↓</Kbd>. Open a scene to keep writing.
            </p>
          </div>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
            {rows.map((r, i) => {
              if (r.kind === 'act') {
                const a = actOf.get(r.id)!;
                const ids = a.chapters.flatMap((c) => c.scenes);
                return (
                  <HeaderRow key={r.key} id={r.key}>
                    <div className="outline-act-head" style={{ marginTop: i ? 28 : 0 }}>
                      <h2>{a.title || a.id}</h2>
                      <span className="faint">
                        {plural(ids.length, 'scene')} · {words(ids).toLocaleString('en')} words
                      </span>
                    </div>
                  </HeaderRow>
                );
              }
              if (r.kind === 'chapter') {
                const c = chapterOf.get(r.id)!;
                const next = rows[i + 1];
                const empty = !next || next.kind !== 'scene';
                return (
                  <HeaderRow key={r.key} id={r.key}>
                    <div className="outline-chapter" style={{ borderBottomLeftRadius: empty ? undefined : 0, borderBottomRightRadius: empty ? undefined : 0, marginBottom: empty ? 12 : 0, boxShadow: 'none', border: '1px solid var(--border)', borderBottom: empty ? undefined : 0 }}>
                      <div className="outline-chapter-head" style={{ borderBottom: empty ? 0 : undefined }}>
                        <h3>{c.title || c.id}</h3>
                        <span className="summary grow">{c.summary}</span>
                        <span className="faint num">{words(c.scenes).toLocaleString('en')} w</span>
                        <Button size="sm" variant="ghost" iconOnly icon={<Plus />} tip="Add a scene to this chapter" onClick={() => addScene(c.id)} />
                      </div>
                      {empty && <div className="faint" style={{ padding: '12px 16px' }}>No scenes yet. Plan cards in Build, or add one.</div>}
                    </div>
                  </HeaderRow>
                );
              }
              const s = byId.get(r.id);
              if (!s) return null;
              const last = !rows[i + 1] || rows[i + 1].kind !== 'scene';
              return (
                <SceneRow
                  key={r.key}
                  s={s}
                  p={p}
                  last={last}
                  selected={selected === s.id}
                  onSelect={() => setSelected(s.id)}
                  onOpen={() => go('scene', s.id)}
                  onMove={(d) => move(s.id, d)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
        {p.unplaced.length > 0 && (
          <div className="banner warning" style={{ marginTop: 16 }}>
            <AlertTriangle />
            <div className="banner-body">
              <span className="banner-title">Scenes not placed in the outline</span>
              <span>{p.unplaced.join(', ')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, transform, transition } = useSortable({ id, disabled: true });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {children}
    </div>
  );
}

function SceneRow({ s, p, last, selected, onSelect, onOpen, onMove }: { s: SceneSummary; p: Snapshot; last: boolean; selected: boolean; onSelect: () => void; onOpen: () => void; onMove: (d: -1 | 1) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const c = s.card;
  const pov = p.characters.find((x) => x.id === c.pov);
  return (
    <div
      ref={setNodeRef}
      className={cx('scene-row', selected && 'selected', isDragging && 'dragging')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        borderLeft: '1px solid var(--border)',
        borderRight: '1px solid var(--border)',
        borderBottom: last ? '1px solid var(--border)' : undefined,
        borderRadius: last ? '0 0 var(--r-l) var(--r-l)' : undefined,
        marginBottom: last ? 12 : 0,
      }}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.altKey && e.key === 'ArrowUp') (e.preventDefault(), onMove(-1));
        else if (e.altKey && e.key === 'ArrowDown') (e.preventDefault(), onMove(1));
        else if (e.key === 'Enter') onOpen();
      }}
      tabIndex={0}
      role="button"
      aria-label={`${s.id} ${c.title}`}
    >
      <button className="handle" {...attributes} {...listeners} aria-label={`Drag ${c.title}`} onClick={(e) => e.stopPropagation()}>
        <GripVertical />
      </button>
      <span className="sid mono">{s.id}</span>
      <span className="stitle">
        {pov && <Avatar id={pov.id} name={pov.bio.name} />}
        <button className="scene-title-link" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{c.title || 'Untitled'}</button>
      </span>
      <span className="purpose" title={c.purpose}>
        {s.excerpt ? <span className="serif" style={{ fontSize: 13 }}>{s.excerpt}</span> : c.purpose || <span className="faint">No purpose yet</span>}
      </span>
      <span className="threads">
        {c.threads_touched.map((t) => (
          <Chip key={t} id={t} title={p.threads.find((x) => x.id === t)?.description}>
            {p.threads.find((x) => x.id === t)?.title || t}
          </Chip>
        ))}
      </span>
      <span className="end">
        {(s.issues.length > 0 || s.contradictions.length > 0) && (
          <Badge kind="danger" icon={<AlertTriangle />}>
            {s.issues.length + s.contradictions.length}
          </Badge>
        )}
        {c.lock !== 'none' && <Lock size={13} className="faint" aria-label={`${c.lock} locked`} />}
        <span className="faint num" style={{ fontSize: 'var(--fs-caption)', minWidth: 40, textAlign: 'right' }}>
          {s.words ? `${s.words} w` : ''}
        </span>
        <SyncBadge state={s.sync} compact />
        <Button size="sm" variant="ghost" iconOnly icon={<FileText />} tip={`Open ${firstName(p.characters, c.pov)}’s scene`} onClick={(e) => (e.stopPropagation(), onOpen())} />
      </span>
    </div>
  );
}
