import { create } from 'zustand';

/** Deposit panel tabs: Circle USDC on Monad, other chains through Aurora Intents, card through Privy. */
export type DepositTab = 'monad' | 'aurora' | 'card';

/**
 * Where an Aurora Intents deposit is (mirrors the SDK lifecycle, collapsed for the UI):
 * idle → preparing (identity, planning, create) → signing (Privy `personal_sign`) →
 * awaiting-deposit (the deposit address is shown) → settling (bridge + depositFor on Monad) →
 * success | failed. `expired` is not terminal: a late deposit revives the execution.
 */
export type AuroraPhase = 'idle' | 'preparing' | 'signing' | 'awaiting-deposit' | 'settling' | 'expired' | 'success' | 'failed';

export interface AuroraDepositState {
  phase: AuroraPhase;
  executionId: string | null;
  depositAddress: string | null;
  deadline: string | null;
  error: string | null;
}

export interface DepositState {
  tab: DepositTab;
  /** Source chain picked on the Other chains tab (NEAR Intents chain name, e.g. `base`). */
  auroraChain: string | null;
  auroraAmount: string;
  aurora: AuroraDepositState;
}

export interface DepositActions {
  setTab: (tab: DepositTab) => void;
  setAuroraChain: (chain: string | null) => void;
  setAuroraAmount: (amount: string) => void;
  patchAurora: (patch: Partial<AuroraDepositState>) => void;
  resetAurora: () => void;
  reset: () => void;
}

const idleAurora: AuroraDepositState = { phase: 'idle', executionId: null, depositAddress: null, deadline: null, error: null };

const initialState: DepositState = { tab: 'monad', auroraChain: null, auroraAmount: '20', aurora: idleAurora };

export const useDepositStore = create<DepositState & DepositActions>()((set) => ({
  ...initialState,
  setTab: (tab) => {
    set({ tab });
  },
  setAuroraChain: (auroraChain) => {
    set({ auroraChain });
  },
  setAuroraAmount: (auroraAmount) => {
    set({ auroraAmount });
  },
  patchAurora: (patch) => {
    set((s) => ({ aurora: { ...s.aurora, ...patch } }));
  },
  resetAurora: () => {
    set({ aurora: idleAurora });
  },
  reset: () => {
    set(initialState);
  },
}));
