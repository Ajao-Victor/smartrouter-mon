'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/keys';
import type { AuroraRecipe } from '@/lib/api/types';
import type { AuroraHandle } from '@/lib/monad/aurora';

import { useDepositStore } from '@/stores/depositStore';
import { toast } from '@/stores/toastStore';

const rejected = (err: unknown) => err instanceof Error && /reject|denied|cancel/i.test(err.message);

/**
 * Drives one Aurora Intents deposit (Other chains tab) and mirrors it into `depositStore`. On
 * success the wallet and session are refetched: the bridged USDC lands in the AI balance through
 * `vault.depositFor`, no second transaction.
 */
export function useAuroraDeposit() {
  const qc = useQueryClient();
  const patch = useDepositStore((s) => s.patchAurora);
  const handle = useRef<AuroraHandle | null>(null);

  useEffect(
    () => () => {
      handle.current?.cancel();
      handle.current = null;
    },
    [],
  );

  const start = useCallback(
    async ({ recipe, address, chain, amountUsd }: { recipe: AuroraRecipe; address: string; chain: string; amountUsd: number }) => {
      handle.current?.cancel();
      patch({ phase: 'preparing', executionId: null, depositAddress: null, deadline: null, error: null });
      const { startAuroraDeposit } = await import('@/lib/monad/aurora');
      const h = startAuroraDeposit({ recipe, address, chain, amountUsd, onUpdate: patch });
      handle.current = h;
      try {
        await h.done;
        if (handle.current !== h) return;
        void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
        void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
        toast.success('Added to your AI balance', `$${amountUsd.toFixed(2)} bridged to Monad`);
      } catch (err) {
        if (handle.current !== h) return;
        const message = rejected(err) ? 'Cancelled. Nothing was sent.' : err instanceof Error ? err.message : 'The cross-chain deposit failed.';
        patch({ phase: 'failed', error: message });
        if (!rejected(err)) console.error('[SmartRouter] Aurora deposit failed', err);
      }
    },
    [patch, qc],
  );

  const cancel = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
    useDepositStore.getState().resetAurora();
  }, []);

  return { start, cancel };
}
