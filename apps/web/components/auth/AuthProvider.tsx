'use client';

import { useCallback, useEffect, useRef } from 'react';

import { getIdentityToken, PrivyProvider, useFundWallet, useIdentityToken, useLinkAccount, useLogin, useLogout, usePrivy, useUser, useWallets, type PrivyClientConfig } from '@privy-io/react-auth';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { base } from 'viem/chains';

import { isApiError, isOfflineError } from '@/lib/api/client';
import { apiUnreachableHint } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/keys';
import type { PrivySignIn } from '@/lib/api/types';
import { clearSessionToken, getSessionToken, registerAuthBridge, subscribeSessionToken } from '@/lib/auth/session';
import { exchangeIdentityToken, isWrongAccount } from '@/lib/auth/signIn';
import { env } from '@/lib/env';
import { chain } from '@/lib/tempo/chain';
import { registerPrivyWallets } from '@/lib/tempo/privyWallet';

import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

/** Sign-in done: mark signed in, refetch everything as the user, then send any kept message. */
function onSignedIn(res: PrivySignIn, qc: QueryClient): void {
  useAuthStore.getState().signedIn({ userId: res.userId, address: res.address, email: res.email, loginMethod: res.loginMethod });
  void qc.invalidateQueries();
  useAuthStore.getState().takeAfterSignIn()?.();
}

function onSignInFailed(err: unknown): void {
  clearSessionToken();
  useAuthStore.getState().signedOut();
  console.error('[SmartRouter] sign-in failed', err);
  if (isOfflineError(err)) toast.error('Could not reach SmartRouter', apiUnreachableHint());
  else toast.error('Sign-in failed', err instanceof Error ? err.message : undefined);
}

/** Mirrors the stored session token into the auth store (signed in = we hold a token). */
function useTokenStatus(): void {
  useEffect(() => {
    const sync = (token: string | null) => {
      const auth = useAuthStore.getState();
      if (token && auth.status !== 'signed_in') auth.setStatus('signed_in');
      if (!token && auth.status !== 'signing_in') auth.signedOut();
    };
    sync(getSessionToken());
    return subscribeSessionToken(sync);
  }, []);
}

/**
 * Inside `PrivyProvider`: turns Privy's authenticated state into a SmartRouter session
 * (Handover "Sign-in flow") and exposes the modal, logout and the embedded wallet to the rest of
 * the app, which never imports Privy directly.
 */
function PrivyBridge() {
  const qc = useQueryClient();
  const { ready, authenticated } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();
  const { wallets } = useWallets();
  const { logout } = useLogout();
  // Card deposits (Handover "Deposit → Card"): Privy's checkout, Base USDC to the deposit address.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const { fundWallet } = useFundWallet();
  useTokenStatus();

  const identityRef = useRef(identityToken);
  identityRef.current = identityToken;
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const busy = useRef(false);

  /** Steps 2–5: identity token → `POST /auth/privy` → keep the session token. */
  const exchange = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    useAuthStore.getState().setStatus('signing_in');
    let attempt = 0;
    try {
      const res = await exchangeIdentityToken(async () => {
        attempt += 1;
        if (attempt > 1) {
          // Wallet still being created: refresh the user so the next identity token carries it.
          await refreshUser().catch(() => undefined);
        }
        return (await getIdentityToken()) ?? identityRef.current;
      });
      onSignedIn(res, qc);
    } catch (err) {
      if (isWrongAccount(err)) {
        // 403 "This wallet belongs to another account": show the message and sign out of Privy.
        toast.error(isApiError(err) ? err.message : 'This wallet belongs to another account');
        clearSessionToken();
        useAuthStore.getState().signedOut();
        await logout().catch(() => undefined);
      } else {
        onSignInFailed(err);
      }
    } finally {
      busy.current = false;
    }
  }, [logout, qc, refreshUser]);

  // EMAIL_REQUIRED on a send: link an email in Privy, then re-exchange so the backend has it.
  const { linkEmail } = useLinkAccount({
    onSuccess: () => {
      void exchange().then(() => qc.invalidateQueries({ queryKey: queryKeys.wallet.all() }));
    },
  });

  const { login } = useLogin({
    onComplete: ({ wasAlreadyAuthenticated }) => {
      if (!wasAlreadyAuthenticated || !getSessionToken()) void exchange();
    },
    onError: (code) => {
      useAuthStore.getState().setAfterSignIn(null);
      if (!getSessionToken()) useAuthStore.getState().signedOut();
      // The user closing the modal is not an error.
      const reason: string = code;
      if (reason !== 'exited_auth_flow') toast.error('Sign-in failed', reason);
    },
  });

  // Privy says signed in but we hold no SmartRouter token (first load after login, or a 401
  // dropped it): exchange silently.
  useEffect(() => {
    if (ready && authenticated && !getSessionToken()) void exchange();
  }, [ready, authenticated, exchange]);

  useEffect(() => {
    registerAuthBridge({
      openSignIn: () => {
        if (authenticatedRef.current) void exchange();
        else login();
      },
      logoutPrivy: () => logout(),
      fundWallet: async ({ address, amountUsd }) => {
        await fundWallet({ address, options: { chain: base, asset: 'USDC', amount: amountUsd.toFixed(2) } as never });
      },
      linkEmail,
    });
    registerPrivyWallets(() => walletsRef.current);
    return () => {
      registerAuthBridge(null);
      registerPrivyWallets(null);
    };
  }, [exchange, login, logout, fundWallet, linkEmail]);

  return null;
}

/** `NEXT_PUBLIC_MOCK=1`: the same flow against MSW, no Privy. */
function MockBridge() {
  const qc = useQueryClient();
  useTokenStatus();
  useEffect(() => {
    registerAuthBridge({
      openSignIn: () => {
        useAuthStore.getState().setStatus('signing_in');
        exchangeIdentityToken(() => Promise.resolve('mock-identity-token'))
          .then((res) => {
            onSignedIn(res, qc);
          })
          .catch(onSignInFailed);
      },
      logoutPrivy: () => Promise.resolve(),
    });
    return () => {
      registerAuthBridge(null);
    };
  }, [qc]);
  return null;
}

/** The Tempo chain for this environment, in Privy's chain shape (viem chains are compatible at runtime). */
const privyChain = chain as unknown as NonNullable<PrivyClientConfig['defaultChain']>;

/**
 * Handover "Sign-in flow", step 1: `PrivyProvider` with email and Google, the Tempo chain for this
 * environment, and an embedded wallet created on login with the wallet UIs hidden (silent
 * vouchers). Apple sign-in is not set up in Privy yet — add `'apple'` to `loginMethods` once it is.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (env.mock) {
    return (
      <>
        <MockBridge />
        {children}
      </>
    );
  }
  return (
    <PrivyProvider
      appId={env.privyAppId}
      config={{
        loginMethods: ['email', 'google'],
        defaultChain: privyChain,
        supportedChains: [privyChain],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
        appearance: { theme: 'dark', landingHeader: 'Sign in to SmartRouter' },
      }}
    >
      <PrivyBridge />
      {children}
    </PrivyProvider>
  );
}
