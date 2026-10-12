import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';

import { micro } from '@/lib/money';

import { useAttachmentStore } from '@/stores/attachmentStore';
import { useAuthStore } from '@/stores/authStore';
import { useComposerStore } from '@/stores/composerStore';
import { useUiStore } from '@/stores/uiStore';
import { server } from '@/tests/mocks/server';
import { mockUploads, resetMockState } from '@/tests/mocks/state';

import { Composer } from '../Composer';

const render = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
};

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

describe('Composer: attach files (POST /uploads → PUT to storage → complete)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' });
  });
  afterEach(() => {
    server.resetHandlers();
    resetMockState();
    useAttachmentStore.getState().clear();
  });
  afterAll(() => {
    server.close();
  });
  beforeEach(() => {
    useAuthStore.getState().signedIn({ userId: 'u', address: '0xabc', email: 'a@b.co', loginMethod: 'email' });
  });

  const pick = (files: File[]) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  };

  it('uploads a picked file, shows it as a chip, and Send waits until it is read', async () => {
    const onSend = vi.fn();
    render(<Composer quote={null} currentModel={null} onSend={onSend} allowAttach />);
    expect(await screen.findByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Summarise this' } });
    pick([new File(['Quarterly numbers: revenue up 12%.'], 'report.txt', { type: 'text/plain' })]);
    expect(screen.getByText('report.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await waitFor(() => {
      expect(useAttachmentStore.getState().items[0]?.status).toBe('ready');
    });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    const id = useAttachmentStore.getState().items[0]?.uploadId ?? '';
    // (jsdom's XHR doesn't send File bytes, so only check the upload reached storage and is ready.)
    expect(mockUploads.get(id)?.status).toBe('ready');
  });

  it('refuses unsupported types and removing a file deletes the upload', async () => {
    render(<Composer quote={null} currentModel={null} onSend={vi.fn()} allowAttach />);
    await screen.findByRole('button', { name: 'Attach files' });
    pick([new File(['x'], 'photo.png', { type: 'image/png' }), new File(['notes'], 'notes.md', { type: 'text/markdown' })]);
    expect(screen.queryByText('photo.png')).toBeNull();
    await waitFor(() => {
      expect(useAttachmentStore.getState().items[0]?.status).toBe('ready');
    });
    const id = useAttachmentStore.getState().items[0]?.uploadId ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.md' }));
    expect(screen.queryByText('notes.md')).toBeNull();
    await waitFor(() => {
      expect(mockUploads.get(id)?.status).toBe('deleted');
    });
  });

  it('signed out, the attach button asks to sign in', async () => {
    const onAttachSignedOut = vi.fn();
    render(<Composer quote={null} currentModel={null} onSend={vi.fn()} allowAttach signedIn={false} onAttachSignedOut={onAttachSignedOut} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Attach files' }));
    expect(onAttachSignedOut).toHaveBeenCalled();
  });
});
