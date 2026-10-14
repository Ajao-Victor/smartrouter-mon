'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import type { Settings, SettingsPatch, User, Wallet } from '@/lib/api/types';

import { toast } from '@/stores/toastStore';

/**
 * `PATCH /me/settings { slider?, dailyLimitUsd?, weeklyLimitUsd?, autoFreeFallback?, country? }`.
 * The reply is the settings object; it is merged into the cached user. The vault enforces the caps
 * on-chain, so when they changed (`vaultSetupNeeded`) the Setup is re-signed for this browser's
 * spending key with the new caps — one more Privy signature, relayed, no MON needed.
 */
export function useSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const settings = await api.me.updateSettings(patch);
      const wallet = qc.getQueryData<Wallet>(queryKeys.wallet.get());
      const registered = wallet?.spendingKey?.status === 'active' || wallet?.spendingKey?.status === 'expiring';
      if (settings.vaultSetupNeeded && wallet && registered) {
        try {
          const { localKeyAddress, registerSpendingKey } = await import('@/lib/monad/spendingKey');
          if (await localKeyAddress(wallet.address)) {
            await registerSpendingKey({ address: wallet.address, dailyUsd: settings.dailyLimitUsd / 1e6, weeklyUsd: settings.weeklyLimitUsd / 1e6, reuseKey: true });
          }
        } catch (err) {
          console.error('[SmartRouter] vault cap update failed', err);
          toast.warn('Caps saved, but Monad still has the old caps', 'Set up paid answers again from the Wallet panel.');
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
