'use client';

import { useEffect } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import { setExplorerBase } from '@/lib/explorer';
import { setContracts } from '@/lib/monad/contracts';

import { useAllocationStore } from '@/stores/allocationStore';
import { useUsageStore } from '@/stores/usageStore';

/**
 * Payment setup and the AI balance (`GET /sessions/current`): `paidRunsEnabled`, `network` (Monad,
 * USDC, vault, ledger, explorer), `suggestedDepositUsd`, `usage`, `session`. Asked on sign-in and
 * refreshed after each `done` event and top-up — no polling. The contract addresses it reports
 * replace the built-in ones (Monad handoff §1: runtime source of truth).
 */
export function useSession(enabled = true) {
  const hydrate = useAllocationStore((s) => s.hydrate);
  const query = useQuery({
    queryKey: queryKeys.session.current(),
    queryFn: ({ signal }) => api.sessions.current(signal),
    enabled,
  });
  useEffect(() => {
    if (query.data === undefined) return;
    hydrate(query.data);
    const n = query.data.network;
    if (n) {
      setContracts({ usdc: n.token, vault: n.vault, ledger: n.ledger });
      setExplorerBase(n.explorer);
    }
    if (query.data.usage) useUsageStore.getState().setUsage(query.data.usage);
  }, [query.data, hydrate]);
  return query;
}

/** Imperative refresh for run completion, top-up and close. */
export function useRefreshSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.session.current() });
}
