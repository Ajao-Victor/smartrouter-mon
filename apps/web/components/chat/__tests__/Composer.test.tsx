import { fireEvent, render, screen } from '@testing-library/react';

import { micro } from '@/lib/money';

import { useComposerStore } from '@/stores/composerStore';
import { useUiStore } from '@/stores/uiStore';

import { Composer } from '../Composer';

beforeEach(() => {
  useComposerStore.getState().reset();
  useUiStore.setState({ activeDialog: null });
});

describe('Composer', () => {
  it('puts the quoted price on Send and sends on Enter', () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer quote={null} currentModel={null} onSend={onSend} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Write a poem' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();

    rerender(<Composer quote={{ priceUsd: micro(900), free: false }} currentModel={{ label: 'GLM 5.3 Flash', isFree: false }} onSend={onSend} />);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveTextContent(/^Send$/);
    expect(screen.getByText('$0.0009')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Write a poem');

    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter', shiftKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('labels free quotes and shows Stop while running', () => {
    const onStop = vi.fn();
    const { rerender } = render(<Composer quote={{ priceUsd: micro(0), free: true }} currentModel={{ label: 'Free · Llama 3.1 8B', isFree: true }} onSend={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveTextContent(/^Send$/);
    expect(screen.getByText('Free')).toBeInTheDocument();
    rerender(<Composer quote={null} running currentModel={null} onSend={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('opens the model picker from the pill; there is no Compare button', () => {
    render(<Composer quote={null} currentModel={{ label: 'Free · Llama 3.1 8B', isFree: true }} onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Model: Free · Llama 3.1 8B/ }));
    expect(useUiStore.getState().activeDialog).toBe('modelPicker');
    expect(screen.queryByRole('button', { name: /Compare/ })).toBeNull();
  });
});
