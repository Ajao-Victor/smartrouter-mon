import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { walletSchema } from '@/lib/api/types';

import { SpendingKeyStatus } from '../SpendingKeyStatus';

/**
 * Paid answers are ready only when the SERVER says the spending key is registered in the vault AND
 * it is the key saved in this browser. A key saved here that the vault doesn't know shows Set up.
 */
const localKey = vi.fn<() => Promise<string | null>>();
vi.mock('@/lib/monad/spendingKey', () => ({ localKeyAddress: () => localKey() }));

const onChainCaps = { dailyUsd: 3, weeklyUsd: 10 };
const wallet = (spendingKey: unknown) =>
  walletSchema.parse({ address: '0x5b9da9fa5d210691948de6f9cf6bf97fa4e8cf5b', token: { address: '0x754704bc059f8c67012fed69bc8a327a5aafb603', symbol: 'USDC' }, main: { balanceUsd: 1 }, spendingKey });
const KEY = '0x7ad0bc7a785033af04d8bef209bb503ec4e363a4';

function show(w: ReturnType<typeof wallet>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SpendingKeyStatus wallet={w} />
    </QueryClientProvider>,
  );
}

describe('SpendingKeyStatus', () => {
  it('server active + the same key saved here → Protected', async () => {
    localKey.mockResolvedValue(KEY.toUpperCase().replace('0X', '0x'));
    show(wallet({ status: 'active', address: KEY, expiresAt: '2026-10-20T00:00:00.000Z', onChainCaps }));
    expect(await screen.findByText(/Protected on Monad: up to \$3\.00\/day and \$10\.00\/week/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up' })).toBeNull();
  });

  it('server active but no key saved here → Set up in this browser', async () => {
    localKey.mockResolvedValue(null);
    show(wallet({ status: 'active', address: KEY, onChainCaps }));
    expect(await screen.findByText('Set up paid answers in this browser.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });

  it('a stale key saved here (from a failed setup) is not treated as ready', async () => {
    localKey.mockResolvedValue('0x1111111111111111111111111111111111111111');
    show(wallet({ status: 'active', address: KEY, onChainCaps }));
    expect(await screen.findByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(screen.queryByText(/Protected on Monad/)).toBeNull();
  });

  it('server says missing → Set up, whatever is saved here', async () => {
    localKey.mockResolvedValue(KEY);
    show(wallet({ status: 'missing' }));
    expect(await screen.findByText('Set up paid answers once.')).toBeInTheDocument();
    expect(screen.queryByText(/Protected on Monad/)).toBeNull();
  });
});
