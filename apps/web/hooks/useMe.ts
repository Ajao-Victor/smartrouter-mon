'use client';

import { useEffect } from 'react';

import { useQuery } from '@tanstack/react-query';

import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';

import { selectIsSignedIn, useAuthStore } from '@/stores/authStore';
import { useUsageStore } from '@/stores/usageStore';

/**
 * Current user from `GET /me` (`id, address, email, loginMethod, usage, settings`). Only asked
 * when signed in — guests never call it. Its `usage` seeds the banner when the app loads.
 */
export function useMe() {
  const signedIn = useAuthStore(selectIsSignedIn);
  const query = useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => api.me.get(signal),
    staleTime: 60_000,
    enabled: signedIn,
  });
  const usage = query.data?.usage;
  useEffect(() => {
    // `/me` can't see the wallet balance, so its alert never says "Add funds". It only seeds the
    // banner; `GET /wallet`, `/sessions/current` and the run events (which can) take over.
    if (usage !== undefined && useUsageStore.getState().usage === null) useUsageStore.getState().setUsage(usage);
  }, [usage]);
  // After a reload only the token is known; `/me` fills in who is signed in (sidebar, wallet).
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    const auth = useAuthStore.getState();
    if (auth.status === 'signed_in' && auth.account?.address !== data.address) {
      auth.signedIn({ userId: data.id, address: data.address, email: data.email, loginMethod: data.loginMethod });
    }
  }, [data]);
  const isUnauthenticated = !signedIn || (isApiError(query.error) && query.error.code === 'UNAUTHENTICATED');
  const isOffline = isApiError(query.error) && query.error.code === 'NETWORK';
  return { ...query, isUnauthenticated, isOffline, signedIn };
}
