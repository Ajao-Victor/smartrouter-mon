import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';

import { micro } from '@/lib/money';

import { useAllocationStore } from '@/stores/allocationStore';
import { useStreamStore } from '@/stores/streamStore';

import { LiveRegion } from '../LiveRegion';

vi.mock('@/lib/api/endpoints', () => ({ api: { catalog: { list: vi.fn().mockResolvedValue([]) } } }));

describe('LiveRegion', () => {
  it('announces streaming, completion and allocation used', () => {
    useStreamStore.getState().clearAll();
    useAllocationStore.getState().reset();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LiveRegion />
      </QueryClientProvider>,
    );
    const region = screen.getByTestId('live-region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    act(() => {
      useStreamStore.getState().start('m1', { modelId: 'x', label: 'Model X' });
    });
    expect(region).toHaveTextContent('Streaming reply…');
    act(() => {
      useStreamStore.getState().done('m1', { chargedUsd: micro(0), latencyMs: 1, requestId: 'r', files: [], citations: [] });
    });
    expect(region).toHaveTextContent(/^Done/);
    act(() => {
      useAllocationStore.getState().hydrate({ suggestedDepositUsd: micro(2_000_000), paidRunsEnabled: true, usage: null, network: { name: 'Monad', chainId: 143, token: null, vault: null, ledger: null, operator: null, explorer: null }, session: { depositUsd: micro(100), spentUsd: micro(100), remainingUsd: micro(0), requests: 1, channelId: 'c', status: 'open', openedAt: null, nextVoucherBaseMicro: '100', setupDone: true, signer: null, signerExpiresAt: null } });
    });
    expect(region).toHaveTextContent('AI balance used — Top up');
  });
});
