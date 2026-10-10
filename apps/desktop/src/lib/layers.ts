import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

/**
 * Overlay layers (dialogs, drawers, the command palette, menus) share one Escape listener.
 * Only the most recently opened layer closes, so Esc peels layers off one at a time.
 */
type Handler = { current: () => void };
const escapeStack: Handler[] = [];
let escapeInstalled = false;

function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || !escapeStack.length) return;
  e.preventDefault();
  escapeStack[escapeStack.length - 1].current();
}

/** Close this layer on Escape, but only while it is the topmost open layer. */
export function useEscape(fn: () => void, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    if (!escapeInstalled && typeof window !== 'undefined') {
      window.addEventListener('keydown', onEscape);
      escapeInstalled = true;
    }
    escapeStack.push(ref);
    return () => {
      const i = escapeStack.lastIndexOf(ref);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

/** How many Escape layers are open (for tests and guards). */
export const openLayers = () => escapeStack.length;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keyboard-reachable elements inside root, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden], [inert]') && el.tabIndex >= 0);
}

const trapStack: RefObject<HTMLElement | null>[] = [];
let trapInstalled = false;

function onTab(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !trapStack.length) return;
  const root = trapStack[trapStack.length - 1].current;
  if (!root) return;
  const els = focusables(root);
  const active = document.activeElement as HTMLElement | null;
  if (!els.length) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = els[0];
  const last = els[els.length - 1];
  const outside = !active || !root.contains(active);
  if (e.shiftKey && (outside || active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (outside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Modal focus handling: on open, focus the first focusable element (preferring the body over
 * the header's close button), keep Tab inside the layer, and on close give focus back to
 * whatever had it before.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!root.contains(document.activeElement)) {
      const preferred = ['.dialog-body', '.dialog-foot'].map((s) => root.querySelector<HTMLElement>(s)).flatMap((el) => (el ? focusables(el) : []));
      (preferred[0] ?? focusables(root)[0] ?? root).focus();
    }
    if (!trapInstalled) {
      document.addEventListener('keydown', onTab);
      trapInstalled = true;
    }
    trapStack.push(ref);
    return () => {
      const i = trapStack.lastIndexOf(ref);
      if (i >= 0) trapStack.splice(i, 1);
      // Restore focus unless it has already moved somewhere deliberate outside the layer.
      const now = document.activeElement;
      if (previous && previous.isConnected && (!now || now === document.body || root.contains(now) || !now.isConnected)) previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Arrow-key navigation for a role="menu": Up/Down move (wrapping), Home/End jump.
 * Returns an onKeyDown handler for the menu element.
 */
export function menuKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
  else if (e.key === 'ArrowUp') next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next < 0) return;
  e.preventDefault();
  items[next].focus();
}

/**
 * Single-key shortcuts (j/k/a/r) must not fire while the user types, or while a control that
 * owns its keys has focus. List options (role="option") are exempt: they are what j/k move.
 */
export function ignoreShortcut(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), button:not([role="option"]), a[href], [role="menuitem"]');
}
