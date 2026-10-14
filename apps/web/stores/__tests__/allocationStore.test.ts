import type { SessionsCurrent } from '@/lib/api/types';
import { micro } from '@/lib/money';

import { selectCanAfford, selectIsLow, selectIsUsed, selectRemainingPct, useAllocationStore } from '../allocationStore';

const current = (over: Partial<NonNullable<SessionsCurrent['session']>> | null = {}): SessionsCurrent => ({
  suggestedDepositUsd: micro(2_000_000),
  paidRunsEnabled: true, usage: null, network: { name: 'Monad', chainId: 143, token: '0x754704bc059f8c67012fed69bc8a327a5aafb603', vault: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c', ledger: null, operator: null, explorer: null },
  session:
    over === null
      ? null
      : { depositUsd: micro(2_000_000), spentUsd: micro(0), remainingUsd: micro(2_000_000), requests: 0, channelId: 'ch_1', status: 'open', openedAt: null, nextVoucherBaseMicro: '0', setupDone: true, signer: null, signerExpiresAt: null, ...over },
});

beforeEach(() => {
  useAllocationStore.getState().reset();
});

describe('allocationStore (the Monad AI balance, from GET /sessions/current)', () => {
  it('hydrates from a $2 session (PDF default)', () => {
    useAllocationStore.getState().hydrate(current());
    const s = useAllocationStore.getState();
    expect(s.status).toBe('open');
    expect(s.depositUsd).toBe(2_000_000);
    expect(s.remainingUsd).toBe(2_000_000);
    expect(selectRemainingPct(s)).toBe(1);
  });

  it('has no AI balance before the first top-up and can afford nothing paid (no automatic deposit on Monad)', () => {
    useAllocationStore.getState().hydrate(current(null));
    const s = useAllocationStore.getState();
    expect(s.status).toBe('none');
    expect(s.setupDone).toBe(false);
    expect(selectCanAfford(micro(1_000))(s)).toBe(false);
  });

  it('keeps the vault, setup state and the next voucher base', () => {
    useAllocationStore.getState().hydrate(current({ nextVoucherBaseMicro: '12000' }));
    const s = useAllocationStore.getState();
    expect(s.chainId).toBe(143);
    expect(s.vault).toBe('0x88191be828c5ce6bda1c7796fb32450a10c3e54c');
    expect(s.setupDone).toBe(true);
    expect(s.nextVoucherBaseMicro).toBe('12000');
  });

  it('applies charges from done events, flags low below 10%, then used', () => {
    useAllocationStore.getState().hydrate(current());
    useAllocationStore.getState().applyCharge(micro(1_850_000));
    let s = useAllocationStore.getState();
    expect(s.remainingUsd).toBe(150_000);
    expect(s.requests).toBe(1);
    expect(selectIsLow(s)).toBe(true);
    expect(selectIsUsed(s)).toBe(false);

    useAllocationStore.getState().applyCharge(micro(150_000));
    s = useAllocationStore.getState();
    expect(s.remainingUsd).toBe(0);
    expect(s.status).toBe('used');
    expect(selectIsUsed(s)).toBe(true);
  });

  it('takes meta.remainingUsd as the freshest number', () => {
    useAllocationStore.getState().hydrate(current());
    useAllocationStore.getState().setRemaining(micro(500_000));
    expect(useAllocationStore.getState().remainingUsd).toBe(500_000);
  });

  it('canAfford follows the PDF rule price ≤ remaining', () => {
    useAllocationStore.getState().hydrate(current({ spentUsd: micro(1_999_000), remainingUsd: micro(1_000) }));
    const s = useAllocationStore.getState();
    expect(selectCanAfford(micro(1_000))(s)).toBe(true);
    expect(selectCanAfford(micro(1_100))(s)).toBe(false);
  });

  it('a top-up reopens a used balance', () => {
    useAllocationStore.getState().hydrate(current({ spentUsd: micro(2_000_000), remainingUsd: micro(0) }));
    expect(useAllocationStore.getState().status).toBe('used');
    useAllocationStore.getState().hydrate(current({ depositUsd: micro(4_000_000), spentUsd: micro(2_000_000), remainingUsd: micro(2_000_000) }));
    expect(useAllocationStore.getState().status).toBe('open');
    useAllocationStore.getState().reset();
    expect(useAllocationStore.getState().status).toBe('none');
  });
});
