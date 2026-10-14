import { create } from 'zustand';

import type { SessionSummary, SessionsCurrent } from '@/lib/api/types';
import { clampMicro, micro, type MicroUsd } from '@/lib/money';

/**
 * The AI balance: the user's account in SmartRouterVault on Monad (`GET /sessions/current` →
 * `session`). Answers are paid from it with spending-key vouchers; the user tops it up from the
 * USDC in their wallet. `none` = no vault account yet (or nothing ever deposited).
 */
export type AllocationStatus = 'none' | 'open' | 'used';

/** Low-balance alert: below ~10% of what was deposited. */
export const LOW_ALLOCATION_PCT = 0.1;

export interface AllocationState {
  channelId: string | null;
  /** USDC held for the user in the vault. */
  depositUsd: MicroUsd;
  /** Answered but not yet settled. */
  spentUsd: MicroUsd;
  /** Spendable now. */
  remainingUsd: MicroUsd;
  requests: number;
  /** The backend's suggested top-up (capped by what's left of today's and this week's caps). */
  suggestedDepositUsd: MicroUsd;
  status: AllocationStatus;
  /** Last charge applied — drives the header drain animation. */
  lastChargeUsd: MicroUsd;
  /** `paidRunsEnabled: false` → hide paid models. */
  paidRunsEnabled: boolean;
  /** `network.chainId` (Monad, 143). */
  chainId: number | null;
  /** `network.token` — Circle USDC on Monad. */
  token: string | null;
  /** `network.vault` — SmartRouterVault. */
  vault: string | null;
  /** Whether the spending key and caps are registered in the vault. */
  setupDone: boolean;
  /** The next voucher signs this + the quoted price (micro-USD, decimal string). */
  nextVoucherBaseMicro: string | null;
}

export interface AllocationActions {
  /** Mirror `GET /sessions/current` (refreshed after each `done` event and top-up). */
  hydrate: (current: SessionsCurrent | null) => void;
  /** `meta.remainingUsd` on a paid run — the freshest number the server has. */
  setRemaining: (remainingUsd: MicroUsd) => void;
  /** Apply a `done.chargedUsd` optimistically until the session refetches. */
  applyCharge: (chargedUsd: MicroUsd) => void;
  reset: () => void;
}

const zero = micro(0);

const initialState: AllocationState = {
  channelId: null,
  depositUsd: zero,
  spentUsd: zero,
  remainingUsd: zero,
  requests: 0,
  suggestedDepositUsd: micro(1_000_000),
  status: 'none',
  lastChargeUsd: zero,
  paidRunsEnabled: true,
  chainId: null,
  token: null,
  vault: null,
  setupDone: false,
  nextVoucherBaseMicro: null,
};

function statusFor(session: SessionSummary): AllocationStatus {
  if (session.depositUsd <= 0 && session.remainingUsd <= 0) return 'none';
  return session.remainingUsd <= 0 ? 'used' : 'open';
}

export const useAllocationStore = create<AllocationState & AllocationActions>()((set) => ({
  ...initialState,
  hydrate: (current) => {
    if (!current) {
      set({ ...initialState });
      return;
    }
    const s = current.session;
    set((prev) => ({
      suggestedDepositUsd: current.suggestedDepositUsd,
      channelId: s?.channelId ?? null,
      depositUsd: s?.depositUsd ?? zero,
      spentUsd: s?.spentUsd ?? zero,
      remainingUsd: s?.remainingUsd ?? zero,
      requests: s?.requests ?? 0,
      status: s ? statusFor(s) : 'none',
      lastChargeUsd: prev.lastChargeUsd,
      paidRunsEnabled: current.paidRunsEnabled,
      chainId: current.network?.chainId ?? prev.chainId,
      token: current.network?.token ?? prev.token,
      vault: current.network?.vault ?? prev.vault,
      setupDone: s?.setupDone ?? false,
      nextVoucherBaseMicro: s?.nextVoucherBaseMicro ?? null,
    }));
  },
  setRemaining: (remainingUsd) => {
    set({ remainingUsd, status: remainingUsd <= 0 ? 'used' : 'open' });
  },
  applyCharge: (chargedUsd) => {
    set((s) => {
      const remaining = clampMicro(micro(s.remainingUsd - chargedUsd), s.depositUsd);
      return {
        remainingUsd: remaining,
        spentUsd: micro(s.spentUsd + chargedUsd),
        requests: s.requests + 1,
        lastChargeUsd: chargedUsd,
        status: remaining <= 0 ? 'used' : 'open',
      };
    });
  },
  reset: () => {
    set({ ...initialState });
  },
}));

/* ------------------------------- selectors -------------------------------- */

export const selectRemainingPct = (s: AllocationState): number => (s.depositUsd > 0 ? s.remainingUsd / s.depositUsd : 0);

export const selectIsLow = (s: AllocationState): boolean => s.status === 'open' && selectRemainingPct(s) < LOW_ALLOCATION_PCT;

export const selectIsUsed = (s: AllocationState): boolean => s.status === 'used';

/** The AI balance covers this price (nothing is deposited automatically on Monad). */
export const selectCanAfford =
  (priceUsd: MicroUsd) =>
  (s: AllocationState): boolean =>
    priceUsd <= s.remainingUsd;
