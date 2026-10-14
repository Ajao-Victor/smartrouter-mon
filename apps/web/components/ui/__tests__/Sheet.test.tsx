import { useState } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useUiStore } from '@/stores/uiStore';

import { Sheet } from '../Sheet';

function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); }}>
        open
      </button>
      <Sheet open={open} onClose={() => { setOpen(false); }} title="Wallet">
        <button type="button">first</button>
        <button type="button">second</button>
      </Sheet>
    </>
  );
}

beforeEach(() => {
  useUiStore.setState({ sdkDialogOpen: false });
});

describe('Sheet', () => {
  it('renders a labelled dialog in a portal when open', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Wallet' })).toBeInTheDocument();
    expect(dialog.parentElement?.closest('body')).toBe(document.body);
  });

  it('moves focus inside and cycles with Tab', async () => {
    render(<Harness />);
    const first = await screen.findByRole('button', { name: 'first' });
    await waitFor(() => {
      expect(document.activeElement).toBe(first);
    });
    const second = screen.getByRole('button', { name: 'second' });
    second.focus();
    fireEvent.keyDown(second, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('never mounts while a wallet SDK dialog is open', () => {
    useUiStore.setState({ sdkDialogOpen: true });
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
