/** Stable hue for an id: threads and characters get consistent colours everywhere. */
export function hue(id: string): number {
  const palette = [62, 150, 235, 300, 28, 190, 95, 330, 265, 120];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export const plural = (n: number, s: string, p = `${s}s`) => `${n.toLocaleString('en')} ${n === 1 ? s : p}`;

export function ago(iso: string | number | null | undefined): string {
  if (!iso) return 'never';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 10) return 'just now';
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const money = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl';

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}

export function factLabel(facts: { id: string; statement: string }[], id: string) {
  return facts.find((f) => f.id === id)?.statement ?? id.replace(/-/g, ' ');
}

export function firstName(chars: { id: string; bio: { name: string } }[], id: string) {
  return chars.find((c) => c.id === id)?.bio.name.split(' ')[0] ?? id;
}

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`ne.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`ne.${key}`, JSON.stringify(value));
  } catch {
    // storage unavailable: preferences just don't persist
  }
}

/** A shortcut label for this platform: ⌘K on macOS, Ctrl K elsewhere. */
export const keys = (k: string) => (isMac ? `⌘${k}` : `Ctrl ${k}`);
