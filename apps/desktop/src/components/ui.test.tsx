import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Drawer, Field, ListEditor } from './ui';
import { ignoreShortcut, openLayers } from '../lib/layers';

afterEach(cleanup);

const esc = () => act(() => void fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' }));
const tab = (shift = false) => act(() => void fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift }));

describe('Field', () => {
  it('links its label to a single native control', () => {
    render(
      <Field label="When" hint="Day and hour">
        <input className="input" />
      </Field>,
    );
    const input = screen.getByLabelText('When');
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Day and hour').id);
  });

  it('keeps an id the control already has', () => {
    render(
      <Field label="Point of view">
        <select id="pov">
          <option>Mara</option>
        </select>
      </Field>,
    );
    expect(screen.getByLabelText('Point of view').id).toBe('pov');
  });

  it('names composite controls as a group', () => {
    render(
      <Field label="Beats">
        <ListEditor items={['arrive']} onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByRole('group', { name: 'Beats' })).toBeTruthy();
  });
});

function Opener({ onClose, drawer }: { onClose?: () => void; drawer?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => (setOpen(false), onClose?.());
  const Layer = drawer ? Drawer : Dialog;
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Layer title="Edit" onClose={close} footer={<button>Save</button>}>
          <input aria-label="Name" />
        </Layer>
      )}
    </>
  );
}

describe('Dialog and Drawer', () => {
  it('are labelled by their title', () => {
    render(<Opener />);
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog', { name: 'Edit' })).toBeTruthy();
  });

  it.each([false, true])('focus the first field, trap Tab and restore focus on close (drawer: %s)', (drawer) => {
    render(<Opener drawer={drawer} />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    const name = screen.getByLabelText('Name');
    expect(document.activeElement).toBe(name);

    // Tab order inside: close button, Name, Save. Tab past the last wraps to the first.
    screen.getByText('Save').focus();
    tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    tab(true);
    expect(document.activeElement).toBe(screen.getByText('Save'));

    esc();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Escape closes only the topmost layer', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Stack() {
      const [showInner, setShowInner] = useState(true);
      return (
        <>
          <Dialog title="Outer" onClose={outer}>
            outer
          </Dialog>
          {showInner && (
            <Dialog title="Inner" onClose={() => (inner(), setShowInner(false))}>
              inner
            </Dialog>
          )}
        </>
      );
    }
    render(<Stack />);
    expect(openLayers()).toBe(2);
    esc();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    esc();
    expect(outer).toHaveBeenCalledTimes(1);
    cleanup();
    expect(openLayers()).toBe(0);
  });
});

describe('ignoreShortcut', () => {
  it('ignores typing targets and real buttons, but not list options', () => {
    document.body.innerHTML = `
      <input id="i"><textarea id="t"></textarea><div contenteditable="true"><p id="ce">x</p></div>
      <button id="b">Accept</button><button id="o" role="option">s06</button><div id="d"></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(ignoreShortcut(el('i'))).toBe(true);
    expect(ignoreShortcut(el('t'))).toBe(true);
    expect(ignoreShortcut(el('ce'))).toBe(true);
    expect(ignoreShortcut(el('b'))).toBe(true);
    expect(ignoreShortcut(el('o'))).toBe(false);
    expect(ignoreShortcut(el('d'))).toBe(false);
    expect(ignoreShortcut(document.body)).toBe(false);
    document.body.innerHTML = '';
  });
});
