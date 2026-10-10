import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  get: vi.fn(async () => ({ open: null })),
  post: vi.fn(async () => ({})),
  runJob: vi.fn(async () => {
    throw new Error('job exploded');
  }),
  subscribe: vi.fn(() => () => undefined),
}));

const { AppProvider, useApp } = await import('./app');
const { DialogsProvider } = await import('../components/confirm');
const { useUnsavedChanges } = await import('./unsaved');

let app!: ReturnType<typeof useApp>;
function Probe({ dirty }: { dirty: boolean }) {
  app = useApp();
  useUnsavedChanges(dirty, 'scene card edits');
  return (
    <div>
      route:{app.route.view}
      {app.toasts.map((t) => (
        <p key={t.id}>
          {t.message}: {t.detail}
        </p>
      ))}
    </div>
  );
}

function mount(dirty: boolean) {
  return render(
    <DialogsProvider>
      <AppProvider>
        <Probe dirty={dirty} />
      </AppProvider>
    </DialogsProvider>,
  );
}

describe('AppProvider', () => {
  beforeEach(() => {
    history.replaceState(null, '', '#/scene/s01');
  });
  afterEach(cleanup);

  it('navigates straight away when nothing is unsaved', () => {
    mount(false);
    act(() => app.go('outline'));
    expect(location.hash).toBe('#/outline');
  });

  it('asks before leaving unsaved edits, and stays on cancel', async () => {
    mount(true);
    act(() => app.go('outline'));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
    expect(screen.getByText(/unsaved scene card edits/)).toBeTruthy();
    act(() => void fireEvent.click(screen.getByText('Keep editing')));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location.hash).toBe('#/scene/s01');

    act(() => app.go('outline'));
    act(() => void fireEvent.click(screen.getByText('Discard and leave')));
    await waitFor(() => expect(location.hash).toBe('#/outline'));
  });

  it('puts the address back when back/forward or a link changes the hash', async () => {
    mount(true);
    await act(async () => {
      location.hash = '#/dashboard';
      await new Promise((r) => setTimeout(r, 0));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(location.hash).toBe('#/scene/s01');
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
    act(() => void fireEvent.click(screen.getByText('Discard and leave')));
    await waitFor(() => expect(location.hash).toBe('#/dashboard'));
  });

  it('toasts unhandled promise rejections, once', async () => {
    mount(false);
    const reason = new Error('socket hang up');
    const event = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason, promise: Promise.resolve() });
    act(() => void window.dispatchEvent(event));
    expect(screen.getByText(/Something went wrong: socket hang up/)).toBeTruthy();
  });

  it('does not toast a job failure twice', async () => {
    mount(false);
    let caught: unknown;
    await act(async () => {
      await app.job('/x', {}, 'Reader run').catch((e) => (caught = e));
    });
    expect(screen.getAllByText(/Reader run failed: job exploded/)).toHaveLength(1);
    const event = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason: caught, promise: Promise.resolve() });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });
});
