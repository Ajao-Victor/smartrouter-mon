'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import type { Settings, SettingsPatch, User, Wallet } from '@/lib/api/types';

import { toast } from '@/stores/toastStore';

/**
 * `PATCH /me/settings { slider?, dailyLimitUsd?, weeklyLimitUsd?, autoFreeFallback?, country? }`.
 * The reply is the settings object; it is merged into the cached user. When the daily cap changed,
 * the reply carries `spendingKeyLimitUsd`: the spending key's on-chain limit is moved to it with
 * one more Privy signature (Handover "One-time setup: the spending key", step 4).
 */
export function useSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const settings = await api.me.updateSettings(patch);
      const wallet = qc.getQueryData<Wallet>(queryKeys.wallet.get());
      if (patch.dailyLimitUsd !== undefined && settings.spendingKeyLimitUsd !== null && wallet?.spendingKey?.status === 'active' && wallet.spendingKey.setup) {
        try {
          const { updateSpendingKeyLimit } = await import('@/lib/tempo/spendingKey');
          await updateSpendingKeyLimit({ address: wallet.address, token: wallet.spendingKey.setup.token, limitUsd: settings.spendingKeyLimitUsd, chainId: wallet.network?.chainId ?? null });
        } catch (err) {
          console.error('[SmartRouter] spending key limit update failed', err);
          toast.warn('Cap saved, but the spending key still has the old limit', 'Set it up again from the Wallet panel.');
        }
      }
      return settings;
    },
    onSuccess: (settings: Settings) => {
      qc.setQueryData<User>(queryKeys.me(), (prev) => (prev ? { ...prev, ...settings } : prev));
      void qc.invalidateQueries({ queryKey: queryKeys.me() });
      void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
    },
  });
}
