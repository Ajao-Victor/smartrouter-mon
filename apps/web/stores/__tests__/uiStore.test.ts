import { useUiStore } from '../uiStore';

beforeEach(() => {
  useUiStore.setState({
    activeDialog: null,
    walletSheetOpen: false,
    walletView: 'main',
    theme: 'dark',
    forceReducedMotion: false,
    sdkDialogOpen: false,
    hydrated: false,
  });
});

describe('uiStore', () => {
  it('keeps a single-depth dialog', () => {
    useUiStore.getState().openDialog('modelPicker');
    useUiStore.getState().openDialog('waitlist');
    expect(useUiStore.getState().activeDialog).toBe('waitlist');
    useUiStore.getState().closeDialog();
    expect(useUiStore.getState().activeDialog).toBeNull();
  });

  it('persists only preferences', () => {
    const partialize = useUiStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    useUiStore.getState().setTheme('light');
    useUiStore.getState().setForceReducedMotion(true);
    useUiStore.getState().toggleWallet(true);
    expect(partialize?.(useUiStore.getState())).toEqual({ theme: 'light', forceReducedMotion: true });
  });

  it('reset clears transient UI but keeps preferences', () => {
    useUiStore.getState().setTheme('light');
    useUiStore.getState().setForceReducedMotion(true);
    useUiStore.getState().toggleWallet(true);
    useUiStore.getState().openWallet('deposit');
    useUiStore.getState().reset();
    const s = useUiStore.getState();
    expect(s.walletSheetOpen).toBe(false);
    expect(s.walletView).toBe('main');
    expect(s.theme).toBe('light');
    expect(s.forceReducedMotion).toBe(true);
  });

  it('skips automatic hydration (SSR-safe) and flips hydrated manually', () => {
    expect(useUiStore.persist.getOptions().skipHydration).toBe(true);
    expect(useUiStore.getState().hydrated).toBe(false);
    useUiStore.getState().markHydrated();
    expect(useUiStore.getState().hydrated).toBe(true);
  });
});
