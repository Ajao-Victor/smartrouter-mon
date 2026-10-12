import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Message } from '@/lib/api/types';
import { micro } from '@/lib/money';

import { useStreamStore } from '@/stores/streamStore';
import { useUiStore } from '@/stores/uiStore';

import { MessageBubble } from '../MessageBubble';

const rate = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api/endpoints', () => ({
  api: { catalog: { list: vi.fn().mockResolvedValue([{ modelId: 'openrouter:z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', provider: 'OpenRouter', taskTypes: [], priceUsd: 800, quality: null, speed: null, free: false }]) }, feedback: { rate: (i: unknown) => rate(i) as Promise<void> } },
}));

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'a1',
  role: 'assistant',
  text: 'Hello there',
  modelId: 'openrouter:z-ai/glm-5.3-flash',
  requestId: 'req_1',
  createdAt: '2026-10-08T00:00:00Z',
  chargedUsd: micro(900),
  seq: null,
  files: [],
  attachments: [],
  citations: [],
  status: 'done',
  ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useStreamStore.getState().clearAll();
  useUiStore.setState({ receiptRequestId: null });
  rate.mockClear();
});

describe('MessageBubble', () => {
  it('shows the model, the charge, the receipt link and rating on a done reply', async () => {
    wrap(<MessageBubble message={msg()} />);
    expect(await screen.findByText('GLM 5.3 Flash')).toBeInTheDocument();
    expect(screen.getByText('$0.0009')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Receipt' }));
    expect(useUiStore.getState().receiptRequestId).toBe('req_1');
    fireEvent.click(screen.getByRole('button', { name: 'Good answer' }));
    await waitFor(() => {
      expect(rate).toHaveBeenCalledWith({ requestId: 'req_1', rating: 1 });
    });
  });

  it('renders user turns as a plain bubble', () => {
    wrap(<MessageBubble message={msg({ id: 'u1', role: 'user', text: 'Hi', modelId: null, requestId: null, chargedUsd: null })} />);
    expect(screen.getByText('Hi')).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('shows the fallback notice with no extra charge', () => {
    useStreamStore.getState().start('a1');
    useStreamStore.getState().fallback('a1', { fromModelId: 'x', toModelId: 'openrouter:meta-llama/llama-3.3-70b', label: 'Llama 3.3 70B', reason: 'timeout' });
    wrap(<MessageBubble message={msg()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Llama 3.3 70B is answering instead — no extra charge/);
  });

  it('offers rerun on the free model after an error and says nothing was charged', () => {
    useStreamStore.getState().start('a1');
    useStreamStore.getState().fail('a1', { code: 'PROVIDER_UNAVAILABLE', message: 'Provider failed', refunded: true, refundedUsd: micro(900), canRerunFree: true });
    const onRerunFree = vi.fn();
    wrap(<MessageBubble message={msg()} onRerunFree={onRerunFree} />);
    expect(screen.getByText(/You were not charged/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rerun on the free model' }));
    expect(onRerunFree).toHaveBeenCalledWith('a1');
  });

  it('shows the pending card while a slow job runs', () => {
    useStreamStore.getState().start('a1', { label: 'Suno v4' });
    useStreamStore.getState().pending('a1', { requestId: 'req_9', pollUrl: '/requests/req_9' });
    wrap(<MessageBubble message={msg()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Still working/);
  });
});
