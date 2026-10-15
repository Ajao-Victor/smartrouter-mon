'use client';

import { useCallback, useEffect, useRef } from 'react';

import { getIdentityToken, PrivyProvider, useFundWallet, useIdentityToken, useLinkAccount, useLogin, useLogout, usePrivy, useUser, useWallets, type PrivyClientConfig } from '@privy-io/react-auth';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { isApiError, isOfflineError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { apiUnreachableHint } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/keys';
import type { PrivySignIn } from '@/lib/api/types';
import { clearSessionToken, getSessionToken, registerAuthBridge, subscribeSessionToken } from '@/lib/auth/session';
import { exchangeIdentityToken, isWalletSettingUp, isWrongAccount } from '@/lib/auth/signIn';
import { env } from '@/lib/env';
import { chain } from '@/lib/monad/chain';
import { sameAddress } from '@/lib/monad/contracts';
import { registerPrivyWallets } from '@/lib/monad/privyWallet';

import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

/**
 * Monad handoff §4, "Successful login": `GET /me` answers with the new token and reports Monad
 * (chain 143). A mismatch means the API and this build disagree about the network.
 */
async function verifySession(): Promise<void> {
  const me = await api.me.get();
  if (me.network && me.network.chainId !== env.chainId) {
    console.error('[SmartRouter] API network mismatch', me.network);
    toast.warn(`SmartRouter is on chain ${String(me.network.chainId)}, this app expects ${String(env.chainId)}`, 'Payments are paused until they match.');
  }
}

/** Sign-in done: mark signed in, refetch everything as the user, then send any kept message. */
function onSignedIn(res: PrivySignIn, qc: QueryClient): void {
  useAuthStore.getState().signedIn({ userId: res.userId, address: res.address, email: res.email, loginMethod: res.loginMethod });
  void qc.invalidateQueries();
  useAuthStore.getState().takeAfterSignIn()?.();
}

const WALLET_SETUP_TITLE = 'Setting up your wallet…';

function onSignInFailed(err: unknown): void {
  if (isWalletSettingUp(err)) {
    // Privy signed in but the embedded wallet is still provisioning: not a failure. Keep the
    // pending callback so the next attempt still sends the kept message / redirects.
    console.warn('[SmartRouter] embedded wallet still provisioning', err);
    useAuthStore.getState().setStatus('signed_out');
    toast.info(WALLET_SETUP_TITLE, err instanceof Error ? err.message : undefined);
    return;
  }
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
 * Inside `PrivyProvider`: turns Privy's authenticated state into a SmartRouter session (Monad
 * handoff §3–4) and exposes the modal, logout and the embedded wallet to the rest of the app,
 * which never imports Privy directly. Nothing is exchanged until Privy is authenticated, holds an
 * identity token **and** has a Privy embedded Ethereum wallet (on a first sign-in the wallet is
 * still being created after `onComplete`); the identity token (not the access token) goes to
 * `POST /auth/privy`, with an in-flight guard against React Strict Mode double effects.
 */
function PrivyBridge() {
  const qc = useQueryClient();
  const { ready, authenticated } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { refreshUser } = useUser();
  const { ready: walletsReady, wallets } = useWallets();
  const { logout } = useLogout();
  // Card deposits: Privy's funding flow buys USDC on Monad straight into the user's wallet.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const { fundWallet } = useFundWallet();
  useTokenStatus();

  const identityRef = useRef(identityToken);
  identityRef.current = identityToken;
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const hasEmbeddedWallet = walletsReady && wallets.some((w) => w.walletClientType === 'privy');
  const canExchange = ready && authenticated && Boolean(identityToken) && hasEmbeddedWallet;
  const canExchangeRef = useRef(canExchange);
  canExchangeRef.current = canExchange;
  const busy = useRef(false);
  /** Login finished before the identity token or embedded wallet existed: exchange once they do. */
  const pending = useRef(false);
  /** "Setting up your wallet…" shown for this sign-in (once). */
  const notified = useRef(false);

  const waitForWallet = useCallback(() => {
    pending.current = true;
    useAuthStore.getState().setStatus('signing_in');
    if (!notified.current) {
      notified.current = true;
      toast.info(WALLET_SETUP_TITLE);
    }
  }, []);

  /** Steps 2–5: identity token → `POST /auth/privy` → keep the session token. */
  const exchange = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    useAuthStore.getState().setStatus('signing_in');
    try {
      const res = await exchangeIdentityToken(
        async () => {
          // The wallet may have just been created: refresh the user so the identity token carries it.
          await refreshUser().catch(() => undefined);
          return (await getIdentityToken()) ?? identityRef.current;
        },
        () => {
          if (!notified.current) {
            notified.current = true;
            toast.info(WALLET_SETUP_TITLE);
          }
        },
      );
      // §3: signatures must come from the embedded wallet whose address the backend returned.
      if (!walletsRef.current.some((w) => w.walletClientType === 'privy' && sameAddress(w.address, res.address))) {
        console.warn('[SmartRouter] no Privy embedded wallet matches the SmartRouter address yet', res.address);
      }
      onSignedIn(res, qc);
      await verifySession().catch((err: unknown) => {
        console.error('[SmartRouter] /me after sign-in failed', err);
      });
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
      notified.current = false;
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
      if (wasAlreadyAuthenticated && getSessionToken()) return;
      if (canExchangeRef.current) void exchange();
      else waitForWallet();
    },
    onError: (code) => {
      useAuthStore.getState().setAfterSignIn(null);
      if (!getSessionToken()) useAuthStore.getState().signedOut();
      // The user closing the modal is not an error.
      const reason: string = code;
      if (reason !== 'exited_auth_flow') toast.error('Sign-in failed', reason);
    },
  });

  // Privy says signed in but we hold no SmartRouter token (first load after login, a login that
  // finished before the embedded wallet existed, or a 401 that dropped it): exchange silently.
  useEffect(() => {
    if (!canExchange) return;
    if (pending.current || !getSessionToken()) {
      pending.current = false;
      void exchange();
    }
  }, [canExchange, exchange]);

  useEffect(() => {
    registerAuthBridge({
      openSignIn: () => {
        if (!authenticatedRef.current) login();
        else if (canExchangeRef.current) void exchange();
        else waitForWallet();
      },
      logoutPrivy: () => logout(),
      fundWallet: async ({ address, amountUsd }) => {
        await fundWallet({ address, options: { chain, asset: 'USDC', amount: amountUsd.toFixed(2) } as never });
      },
      linkEmail,
    });
    registerPrivyWallets(() => walletsRef.current);
    return () => {
      registerAuthBridge(null);
      registerPrivyWallets(null);
    };
  }, [exchange, login, logout, fundWallet, linkEmail, waitForWallet]);

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

/** Monad (chain 143) in Privy's chain shape (viem chains are compatible at runtime). */
const privyChain = chain as unknown as NonNullable<PrivyClientConfig['defaultChain']>;

/**
 * Monad handoff §3: `PrivyProvider` with email and Google, Monad as the default and only supported
 * chain, and an embedded Ethereum wallet created on login for users without one (wallet UIs hidden:
 * setup and USDC authorizations are typed-data signatures). Apple sign-in is not set up in Privy —
 * add `'apple'` to `loginMethods` once it is.
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
