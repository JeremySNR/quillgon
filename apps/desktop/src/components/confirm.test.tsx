import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogsProvider, useConfirm, usePrompt } from './confirm';

afterEach(cleanup);

function Harness({ onApi }: { onApi: (api: { confirm: ReturnType<typeof useConfirm>; prompt: ReturnType<typeof usePrompt> }) => void }) {
  onApi({ confirm: useConfirm(), prompt: usePrompt() });
  return <button>page</button>;
}

function setup() {
  let api!: { confirm: ReturnType<typeof useConfirm>; prompt: ReturnType<typeof usePrompt> };
  render(
    <DialogsProvider>
      <Harness onApi={(a) => (api = a)} />
    </DialogsProvider>,
  );
  return api;
}

describe('confirm and prompt dialogs', () => {
  it('confirm resolves true on the confirm button', async () => {
    const { confirm } = setup();
    let answer: Promise<boolean>;
    act(() => {
      answer = confirm({ title: 'Delete s04?', message: 'Gone for good.', confirmLabel: 'Delete scene', danger: true });
    });
    expect(screen.getByRole('dialog', { name: 'Delete s04?' })).toBeTruthy();
    // The safe choice has focus first.
    expect(document.activeElement?.textContent).toBe('Cancel');
    act(() => void fireEvent.click(screen.getByText('Delete scene')));
    await expect(answer!).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirm resolves false on Escape or Cancel', async () => {
    const { confirm } = setup();
    let first: Promise<boolean>;
    act(() => {
      first = confirm({ title: 'Revert?' });
    });
    act(() => void fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    await expect(first!).resolves.toBe(false);
    let second: Promise<boolean>;
    act(() => {
      second = confirm({ title: 'Revert?' });
    });
    act(() => void fireEvent.click(screen.getByText('Cancel')));
    await expect(second!).resolves.toBe(false);
  });

  it('prompt returns the trimmed value, validates, and returns null on cancel', async () => {
    const { prompt } = setup();
    let name: Promise<string | null>;
    act(() => {
      name = prompt({ title: 'New what-if', label: 'Name', initial: 'what-if-', validate: (v) => (v === 'main' ? 'Taken' : null) });
    });
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('what-if-');
    fireEvent.change(input, { target: { value: 'main' } });
    act(() => void fireEvent.submit(input.closest('form')!));
    expect(screen.getByText('Taken')).toBeTruthy();
    fireEvent.change(input, { target: { value: '  storm  ' } });
    act(() => void fireEvent.submit(input.closest('form')!));
    await expect(name!).resolves.toBe('storm');

    let cancelled: Promise<string | null>;
    act(() => {
      cancelled = prompt({ title: 'Again', label: 'Name' });
    });
    act(() => void fireEvent.click(screen.getByText('Cancel')));
    await expect(cancelled!).resolves.toBeNull();
  });
});
