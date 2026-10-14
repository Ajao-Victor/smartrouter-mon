import { create } from 'zustand';

/**
 * Sign-in state (Handover "Sign-in"). Signed in = we hold a SmartRouter session token from
 * `POST /auth/privy`. `unknown` until the client has read the stored token after mount (keeps SSR
 * and the first paint identical).
 */
export type AuthStatus = 'unknown' | 'signed_out' | 'signing_in' | 'signed_in';

export interface AuthAccount {
  userId: string | null;
  /** The Privy embedded wallet on Monad returned by `/auth/privy` (the one that signs). */
  address: string;
  email: string | null;
  loginMethod: string | null;
}

export interface AuthState {
  status: AuthStatus;
  account: AuthAccount | null;
  /**
   * Handover "Guest mode": when a guest presses Send we keep the typed message, open the Privy
   * modal and run this once sign-in completes. Cleared if sign-in is cancelled or fails.
   */
  afterSignIn: (() => void) | null;
}

export interface AuthActions {
  setStatus: (status: AuthStatus) => void;
  signedIn: (account: AuthAccount) => void;
  signedOut: () => void;
  setAfterSignIn: (fn: (() => void) | null) => void;
  /** Take (and clear) the pending action. */
  takeAfterSignIn: () => (() => void) | null;
  reset: () => void;
}

const initialState: AuthState = { status: 'unknown', account: null, afterSignIn: null };

export const useAuthStore = create<AuthState & AuthActions>()((set, get) => ({
  ...initialState,
  setStatus: (status) => {
    set({ status });
  },
  signedIn: (account) => {
    set({ status: 'signed_in', account });
  },
  signedOut: () => {
    set({ status: 'signed_out', account: null, afterSignIn: null });
  },
  setAfterSignIn: (afterSignIn) => {
    set({ afterSignIn });
  },
  takeAfterSignIn: () => {
    const fn = get().afterSignIn;
    set({ afterSignIn: null });
    return fn;
  },
  reset: () => {
    set({ ...initialState, status: 'signed_out' });
  },
}));

export const selectIsSignedIn = (s: AuthState): boolean => s.status === 'signed_in';
