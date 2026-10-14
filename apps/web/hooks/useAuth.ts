'use client';

import { useCallback } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { logoutPrivy, openSignIn } from '@/lib/auth/session';
import { signOutEverywhere } from '@/lib/auth/signIn';

import { resetAllStores } from '@/stores';
import { selectIsSignedIn, useAuthStore } from '@/stores/authStore';

/**
 * Sign-in with email or Google through Privy (Handover "Sign-in"). `signIn(then?)` opens the
 * Privy modal; `then` runs once the SmartRouter session exists (used to send a guest's message).
 * The exchange itself (`POST /auth/privy`) lives in `components/auth/AuthProvider`.
 */
export function useAuth() {
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const account = useAuthStore((s) => s.account);
  const isSignedIn = useAuthStore(selectIsSignedIn);

  const signIn = useCallback((then?: () => void) => {
    useAuthStore.getState().setAfterSignIn(then ?? null);
    openSignIn();
  }, []);

  /** `POST /auth/logout`, then Privy's `logout()`, then clear the stored token. */
  const signOut = useMutation({
    mutationFn: async () => {
      await signOutEverywhere(logoutPrivy);
      // The AI balance stays in the vault for the next sign-in; the spending key stays in this browser.
      const { resetPayments } = await import('@/lib/monad/payments');
      resetPayments();
    },
    onSettled: () => {
      qc.clear();
      resetAllStores();
    },
  });

  return { signIn, signOut, status, account, isSignedIn, signingIn: status === 'signing_in' };
}
