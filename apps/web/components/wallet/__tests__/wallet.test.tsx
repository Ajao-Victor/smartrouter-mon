import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { walletSchema } from '@/lib/api/types';
import { micro } from '@/lib/money';

import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

import { ReducedMotionProvider } from '@/components/layout/ReducedMotionProvider';

import { CapsEditor } from '../CapsEditor';
import { WaitlistForm } from '../WaitlistForm';
import { WalletSheet } from '../WalletSheet';

vi.mock('@/lib/tempo/walletActions', () => ({ TOKEN_SYMBOL: 'pathUSD', getTokenBalance: vi.fn(), requestFaucet: vi.fn(), sendTokens: vi.fn(), mockDebit: vi.fn() }));

/** Live testnet `GET /wallet` shape (Handover "Wallet panel layout"). */
const liveWallet = {
  address: '0x5b9da9fa5d210691948de6f9cf6bf97fa4e8cf5b',
  network: { chainId: 42431, name: 'Tempo Testnet (Moderato)' },
  token: { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD', decimals: 6 },
  main: { balanceUsd: 12.4 },
  ai: null,
  locked: { depositUsd: 1, spentUsd: 0.6, remainingUsd: 0.4 },
  caps: {
    daily: { spentUsd: 1.6, limitUsd: 2, usedPct: 80, remainingUsd: 0.4, resetsAt: '2026-10-12T00:00:00.000Z' },
    weekly: { spentUsd: 4.1, limitUsd: 10, usedPct: 41, remainingUsd: 5.9 },
    deposit: null,
    nextDepositUsd: 0.4,
    alert: { level: 'warning', meter: 'daily', usedPct: 80, message: "You've used 80% of today's spending cap", action: 'raise_limit' },
  },
  spendingKey: { status: 'missing', setup: { token: '0x20c0000000000000000000000000000000000000', limitUsd: 3, periodSeconds: 86400, expiryDays: 7, scopes: [{ address: '0x4d50500000000000000000000000000000000000' }] } },
  incomingUsd: 2,
  networkFees: { paidBy: 'smartrouter', sponsoredPerDay: 20, usedToday: 0, relayUrl: '/relay' },
  features: { crossChain: false, card: false, cashOut: false },
};

const join = vi.fn();
const getWallet = vi.fn();
const activity = vi.fn();
vi.mock('@/lib/api/endpoints', () => ({
  api: {
    waitlist: { join: (i: unknown) => join(i) as Promise<void> },
    wallet: { get: () => getWallet() as Promise<unknown>, activity: () => activity() as Promise<unknown>, options: () => Promise.resolve({ deposit: [], send: [], card: null }) },
  },
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReducedMotionProvider forceReduced>{ui}</ReducedMotionProvider>
    </QueryClientProvider>,
  );
}

const user = { address: liveWallet.address, slider: 'balanced' as const, dailyLimitUsd: micro(2_000_000), weeklyLimitUsd: micro(10_000_000), autoFreeFallback: true, freeRemaining: null, id: 'user_1', email: 'a@b.co', loginMethod: 'email', usage: null, country: null, spendingKeyLimitUsd: null };

describe('WaitlistForm', () => {
  it('validates the email and posts email, country and interest', async () => {
    join.mockResolvedValue(undefined);
    wrap(<WaitlistForm interest="naira" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.submit(screen.getByRole('button', { name: /Join the naira waitlist/ }).closest('form') as HTMLFormElement);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /Join the naira waitlist/ }).closest('form') as HTMLFormElement);
    await waitFor(() => {
      expect(join).toHaveBeenCalledWith({ email: 'ada@example.com', country: 'NG', interest: 'naira' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/on the waitlist/);
  });
});

describe('CapsEditor (PATCH /me/settings { dailyLimitUsd, weeklyLimitUsd })', () => {
  it('saves both caps and refuses a daily cap above the weekly one', () => {
    const onSave = vi.fn();
    wrap(<CapsEditor dailyLimitUsd={micro(2_000_000)} weeklyLimitUsd={micro(10_000_000)} autoFreeFallback onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '12' } });
    expect(screen.getByText("The daily cap can't be more than the weekly cap.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save caps' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save caps' }));
    expect(onSave).toHaveBeenCalledWith({ dailyLimitUsd: 3, weeklyLimitUsd: 10 });
    fireEvent.click(screen.getByRole('switch', { name: 'Auto free fallback' }));
    expect(onSave).toHaveBeenCalledWith({ autoFreeFallback: false });
  });
});

describe('WalletSheet (GET /wallet)', () => {
  beforeEach(() => {
    useAuthStore.getState().signedIn({ userId: 'u', address: liveWallet.address, email: 'a@b.co', loginMethod: 'email' });
    useUiStore.setState({ walletSheetOpen: true, walletView: 'main', sdkDialogOpen: false });
    getWallet.mockResolvedValue(walletSchema.parse(liveWallet));
    activity.mockResolvedValue({ items: [{ id: 'a1', type: 'deposit', status: 'completed', amountUsd: 5, chain: 'tempo', token: 'pathUSD', counterparty: null, txHash: null, at: '2026-10-11T10:00:00.000Z' }], nextBefore: null });
  });

  it('shows the balance card, locked money, both cap bars, the spending-key setup and activity', async () => {
    wrap(<WalletSheet user={user} onSignOut={vi.fn()} onSettings={vi.fn()} />);
    expect(await screen.findByText('$12.40')).toBeInTheDocument();
    expect(screen.getByText('$2.00 arriving')).toBeInTheDocument();
    expect(screen.getByText(/Locked for current chats/)).toHaveTextContent('$0.40');
    expect(screen.getByRole('button', { name: 'Return now' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Today' })).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByRole('progressbar', { name: 'This week' })).toHaveAttribute('aria-valuenow', '41');
    expect(screen.getByText('Set up paid answers once.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(await screen.findByText('Received $5.00')).toBeInTheDocument();
  });

  it('the refresh button next to the balance re-fetches GET /wallet', async () => {
    wrap(<WalletSheet user={user} onSignOut={vi.fn()} onSettings={vi.fn()} />);
    await screen.findByText('$12.40');
    const calls = getWallet.mock.calls.length;
    getWallet.mockResolvedValue(walletSchema.parse({ ...liveWallet, main: { balanceUsd: 15 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh balance' }));
    expect(await screen.findByText('$15.00')).toBeInTheDocument();
    expect(getWallet.mock.calls.length).toBe(calls + 1);
  });

  it('Deposit opens the Tempo tab with the address (testnet: no other chains)', async () => {
    wrap(<WalletSheet user={user} onSignOut={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));
    expect(useUiStore.getState().walletView).toBe('deposit');
    expect(await screen.findByRole('tab', { name: 'Tempo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Other chain' })).toBeNull();
    expect(screen.getByText(liveWallet.address)).toBeInTheDocument();
  });
});
