/**
 * SmartRouter session token (Handover "Sign-in flow", step 5): kept in memory plus localStorage
 * so a reload stays signed in, and sent on every call as `X-Session-Token`. The header matters:
 * Brave and Safari block the `sr_session` cookie because Vercel and Heroku are different sites.
 *
 * Also the one place the app asks for the sign-in modal (`openSignIn`): the Privy bridge
 * registers the real opener; anything that hits a 401 just calls `openSignIn()`.
 */
const STORAGE_KEY = 'sr:session-token';

export interface StoredSession {
  token: string;
  /** ISO timestamp from `POST /auth/privy` (7 days). */
  expiresAt: string | null;
}

let memory: StoredSession | null = null;
let loaded = false;
const listeners = new Set<(token: string | null) => void>();

function storage(): Storage | null {
  try {
    // Handover: "Keep token (in memory, plus localStorage so a reload stays signed in)".
    // eslint-disable-next-line no-restricted-properties
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || !parsed.token) return;
    const expiresAt = typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      storage()?.removeItem(STORAGE_KEY);
      return;
    }
    memory = { token: parsed.token, expiresAt };
  } catch {
    storage()?.removeItem(STORAGE_KEY);
  }
}

function emit(): void {
  const token = memory?.token ?? null;
  for (const l of listeners) l(token);
}

export function getSessionToken(): string | null {
  load();
  return memory?.token ?? null;
}

export function setSessionToken(token: string, expiresAt: string | null = null): void {
  loaded = true;
  memory = { token, expiresAt };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* private mode: memory only */
  }
  emit();
}

export function clearSessionToken(): void {
  loaded = true;
  const had = memory !== null;
  memory = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (had) emit();
}

export function subscribeSessionToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* --------------------------- sign-in modal / Privy --------------------------- */

export interface AuthBridge {
  /** Open the Privy sign-in modal (or silently re-exchange when Privy is still signed in). */
  openSignIn: () => void;
  /** Privy's `logout()`. */
  logoutPrivy: () => Promise<void>;
  /** Privy's card purchase (`useFundWallet`), sent to a deposit address. Absent on mocks. */
  fundWallet?: (args: { address: string; amountUsd: number }) => Promise<void>;
}

let bridge: AuthBridge | null = null;

/** The Privy bridge (or the mock bridge) registers itself once mounted. */
export function registerAuthBridge(next: AuthBridge | null): void {
  bridge = next;
}

/** Open the sign-in modal. No-op until the bridge has mounted. */
export function openSignIn(): void {
  bridge?.openSignIn();
}

export async function logoutPrivy(): Promise<void> {
  await bridge?.logoutPrivy();
}

/** Card deposit: open Privy's checkout with the Base deposit address as the destination. */
export async function fundWithCard(args: { address: string; amountUsd: number }): Promise<void> {
  if (!bridge?.fundWallet) throw new Error('Card purchases are not available here.');
  await bridge.fundWallet(args);
}
