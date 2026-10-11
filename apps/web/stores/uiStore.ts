import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { idbStateStorage } from '@/lib/idb';

export type DialogId = 'modelPicker' | 'waitlist';
/** Wallet panel views (Handover "Wallet"). */
export type WalletView = 'main' | 'deposit' | 'send' | 'caps' | 'setup';
export type Theme = 'dark' | 'light';

export interface UiState {
  /** Single-depth dialog stack (UI_UX_Brief §6). */
  activeDialog: DialogId | null;
  walletSheetOpen: boolean;
  walletView: WalletView;
  /** Mobile: the chat-history sidebar drawer. */
  sidebarOpen: boolean;
  /** Persisted preferences. */
  theme: Theme;
  forceReducedMotion: boolean;
  /** True while a wallet/passkey prompt is open — overlays stay below it. */
  sdkDialogOpen: boolean;
  /** Set once `persist` has rehydrated from IndexedDB on the client. */
  hydrated: boolean;
  /** Request whose receipt drawer is open. */
  receiptRequestId: string | null;
  /** Title shown in the TopBar (chat title). */
  pageTitle: string | null;
  /** A message kept while the spending key is set up; sent once setup succeeds. */
  afterKeySetup: (() => void) | null;
}

export interface UiActions {
  openDialog: (id: DialogId) => void;
  closeDialog: () => void;
  toggleWallet: (open?: boolean) => void;
  /** Open the Wallet panel on a view (Deposit, Send, caps, spending-key setup). */
  openWallet: (view?: WalletView, afterKeySetup?: (() => void) | null) => void;
  setWalletView: (view: WalletView) => void;
  setSidebarOpen: (open: boolean) => void;
  takeAfterKeySetup: () => (() => void) | null;
  setTheme: (theme: Theme) => void;
  setForceReducedMotion: (on: boolean) => void;
  setSdkDialogOpen: (open: boolean) => void;
  markHydrated: () => void;
  openReceipt: (requestId: string) => void;
  closeReceipt: () => void;
  setPageTitle: (title: string | null) => void;
  /** Open the deposit dialog; `resend` runs after the close-and-reopen succeeds. */
  reset: () => void;
}

const initialState: UiState = {
  activeDialog: null,
  walletSheetOpen: false,
  walletView: 'main',
  sidebarOpen: false,
  theme: 'dark',
  forceReducedMotion: false,
  sdkDialogOpen: false,
  hydrated: false,
  receiptRequestId: null,
  pageTitle: null,
  afterKeySetup: null,
};

/**
 * Global UI state. `theme` and `forceReducedMotion` persist to IndexedDB.
 * SSR strategy: `skipHydration` so the server and first client paint use defaults;
 * `PreferencesProvider` calls `rehydrate()` after mount → no hydration mismatch.
 */
export const useUiStore = create<UiState & UiActions>()(
  persist(
    (set, get) => ({
      ...initialState,
      openDialog: (id) => {
        set({ activeDialog: id });
      },
      closeDialog: () => {
        set({ activeDialog: null });
      },
      toggleWallet: (open) => {
        set((s) => {
          const next = open ?? !s.walletSheetOpen;
          return next ? { walletSheetOpen: true } : { walletSheetOpen: false, walletView: 'main', afterKeySetup: null };
        });
      },
      openWallet: (view = 'main', afterKeySetup = null) => {
        set({ walletSheetOpen: true, walletView: view, afterKeySetup });
      },
      setWalletView: (walletView) => {
        set({ walletView });
      },
      setSidebarOpen: (sidebarOpen) => {
        set({ sidebarOpen });
      },
      takeAfterKeySetup: () => {
        const fn = get().afterKeySetup;
        set({ afterKeySetup: null });
        return fn;
      },
      setTheme: (theme) => {
        set({ theme });
      },
      setForceReducedMotion: (on) => {
        set({ forceReducedMotion: on });
      },
      setSdkDialogOpen: (open) => {
        set({ sdkDialogOpen: open });
      },
      markHydrated: () => {
        set({ hydrated: true });
      },
      openReceipt: (requestId) => {
        set({ receiptRequestId: requestId });
      },
      closeReceipt: () => {
        set({ receiptRequestId: null });
      },
      setPageTitle: (pageTitle) => {
        set({ pageTitle });
      },
      reset: () => {
        // Preferences survive logout; transient UI resets.
        set((s) => ({ ...initialState, theme: s.theme, forceReducedMotion: s.forceReducedMotion, hydrated: s.hydrated }));
      },
    }),
    {
      name: 'sr:ui',
      version: 1,
      storage: createJSONStorage(() => idbStateStorage),
      partialize: (s) => ({ theme: s.theme, forceReducedMotion: s.forceReducedMotion }),
      skipHydration: true,
    },
  ),
);
