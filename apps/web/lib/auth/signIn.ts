/**
 * Shared sign-in steps (Handover "Sign-in flow", steps 3–5 and "Edge cases"), used by the Privy
 * bridge and the offline mock bridge.
 */
import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { PrivySignIn } from '@/lib/api/types';

import { clearSessionToken, setSessionToken } from './session';

/** 400 "No Privy embedded wallet yet": Privy hasn't finished creating the wallet. */
export function isWalletNotReady(err: unknown): boolean {
  return isApiError(err) && err.status === 400 && /no privy embedded wallet/i.test(err.message);
}

/** 403 "This wallet belongs to another account". */
export function isWrongAccount(err: unknown): boolean {
  return isApiError(err) && err.code === 'FORBIDDEN';
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const WALLET_RETRY_MS = 1_000;
/** Privy can take a while to create the embedded wallet on a first sign-in: keep trying for ~45 s. */
export const WALLET_RETRY_ATTEMPTS = 45;

/** The embedded wallet was still being created when the retries ran out. Not a sign-in failure. */
export class WalletSetupError extends Error {
  constructor() {
    super('Your wallet is still being set up. Try signing in again in a moment.');
    this.name = 'WalletSetupError';
  }
}

/** The wallet is still provisioning (backend 400, or our retries ran out waiting for it). */
export function isWalletSettingUp(err: unknown): boolean {
  return err instanceof WalletSetupError || isWalletNotReady(err);
}

/**
 * `POST /auth/privy { identityToken }` → keep `token` (memory + localStorage). On "No Privy
 * embedded wallet yet" (or no identity token yet), wait a second and call again with a fresh
 * identity token; `onWaiting` fires once, the first time we have to wait for the wallet.
 */
export async function exchangeIdentityToken(freshIdentityToken: () => Promise<string | null>, onWaiting?: () => void): Promise<PrivySignIn> {
  let waiting = false;
  for (let attempt = 0; attempt < WALLET_RETRY_ATTEMPTS; attempt++) {
    const identityToken = await freshIdentityToken();
    if (identityToken) {
      try {
        const res = await api.auth.privy({ identityToken });
        setSessionToken(res.token, res.expiresAt);
        return res;
      } catch (err) {
        if (!isWalletNotReady(err)) throw err;
      }
    }
    if (!waiting) {
      waiting = true;
      onWaiting?.();
    }
    await sleep(WALLET_RETRY_MS);
  }
  throw new WalletSetupError();
}

/** Sign out (Handover): `POST /auth/logout`, then Privy's `logout()`, then clear the stored token. */
export async function signOutEverywhere(logoutPrivy: () => Promise<void>): Promise<void> {
  try {
    await api.auth.logout();
  } catch {
    /* the server session may already be gone */
  }
  try {
    await logoutPrivy();
  } finally {
    clearSessionToken();
  }
}
