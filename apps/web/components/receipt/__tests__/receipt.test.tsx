import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { ReceiptView } from '../ReceiptView';
import { TxHashReveal } from '../TxHashReveal';

const HASH = `0x${'ab12'.repeat(16)}`;
const get = vi.fn();
vi.mock('@/lib/api/endpoints', () => ({
  api: { requests: { get: (id: string) => get(id) as Promise<unknown> }, catalog: { list: vi.fn().mockResolvedValue([]) } },
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('TxHashReveal', () => {
  it('exposes the full hash, copies it and links to the explorer', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wrap(<TxHashReveal hash={HASH} />);
    expect(screen.getByLabelText(`Transaction ${HASH}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy transaction hash' }));
    expect(writeText).toHaveBeenCalledWith(HASH);
    expect(screen.getByRole('link', { name: 'View on Monad explorer' })).toHaveAttribute('href', `https://monadscan.com/tx/${HASH}`);
  });

  it('refuses invalid hashes', () => {
    wrap(<TxHashReveal hash="0xnope" />);
    expect(screen.getByText('invalid hash')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('ReceiptView (GET /requests/:id)', () => {
  it('renders the charge, latency, status and refund', async () => {
    get.mockResolvedValue({
      requestId: 'req_1', status: 'succeeded', modelId: 'm', label: 'GLM 5.3 Flash', chatId: 'c', chargedUsd: 900, refundedUsd: null, latencyMs: 1234, text: 'x', files: [], citations: [], error: null, free: false, createdAt: new Date().toISOString(), compareGroup: null, txHash: HASH,
    });
    wrap(<ReceiptView requestId="req_1" />);
    expect(await screen.findByText('$0.0009')).toBeInTheDocument();
    expect(screen.getByText('GLM 5.3 Flash')).toBeInTheDocument();
    expect(screen.getByText('1.2 s')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(screen.getByLabelText(`Transaction ${HASH}`)).toBeInTheDocument();
  });

  it('shows a failed, refunded run as free of charge', async () => {
    get.mockResolvedValue({ requestId: 'req_2', status: 'failed', modelId: 'm', chargedUsd: 0, refundedUsd: 900, latencyMs: null, error: 'Provider failed', free: false });
    wrap(<ReceiptView requestId="req_2" />);
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Provider failed')).toBeInTheDocument();
  });
});
