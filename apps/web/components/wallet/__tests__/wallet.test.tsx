import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { walletSchema } from '@/lib/api/types';
import { micro } from '@/lib/money';

import { useAuthStore } from '@/stores/authStore';
import { useDepositStore } from '@/stores/depositStore';
import { useUiStore } from '@/stores/uiStore';

import { ReducedMotionProvider } from '@/components/layout/ReducedMotionProvider';

import { CapsEditor } from '../CapsEditor';
import { WaitlistForm } from '../WaitlistForm';
import { WalletSheet } from '../WalletSheet';

/** Monad `GET /wallet` shape (backend `apps/api/src/routes/wallet.ts`). */
const liveWallet = {
  address: '0x5b9da9fa5d210691948de6f9cf6bf97fa4e8cf5b',
  network: { chainId: 143, name: 'Monad', explorer: 'https://monadscan.com' },
  token: { address: '0x754704bc059f8c67012fed69bc8a327a5aafb603', symbol: 'USDC', decimals: 6 },
  main: { balanceUsd: 12.4 },
  ai: { channelId: '0xcd', depositUsd: 1, spentUsd: 0.6, remainingUsd: 0.4 },
  locked: { channelId: '0xcd', depositUsd: 1, spentUsd: 0.6, remainingUsd: 0.4 },
  vault: { address: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c', ledger: '0xdc28d25a044da278ae82cbf91cdf1c5997aa2163' },
  caps: {
    daily: { spentUsd: 1.6, limitUsd: 2, usedPct: 80, remainingUsd: 0.4, resetsAt: '2026-10-12T00:00:00.000Z' },
    weekly: { spentUsd: 4.1, limitUsd: 10, usedPct: 41, remainingUsd: 5.9 },
    deposit: null,
    nextDepositUsd: 0.4,
    alert: { level: 'warning', meter: 'daily', usedPct: 80, message: "You've used 80% of today's spending cap", action: 'raise_limit' },
  },
  spendingKey: { status: 'missing', address: null, expiresAt: null, onChainCaps: { dailyUsd: 0, weeklyUsd: 0 } },
  incomingUsd: 2,
  networkFees: { paidBy: 'smartrouter', sponsoredPerDay: 20, usedToday: 0 },
  features: { crossChain: false, card: { via: 'privy', chain: 'monad', token: 'USDC' }, cashOut: false },
};

const join = vi.fn();
const getWallet = vi.fn();
const activity = vi.fn();
const options = vi.fn();
vi.mock('@/lib/api/endpoints', () => ({
  api: {
    waitlist: { join: (i: unknown) => join(i) as Promise<void> },
    wallet: { get: () => getWallet() as Promise<unknown>, activity: () => activity() as Promise<unknown>, options: () => options() as Promise<unknown> },
  },
}));

const baseOptions = { deposit: [], send: [], card: { chain: 'monad', token: 'USDC', note: 'Buy USDC on Monad with a card.' } };
const auroraRecipe = {
  available: true,
  baseUrl: 'https://intents-connect.aurora.dev',
  apiKeyProxyPath: '/aurora/',
  flow: 'bridge-in',
  type: 'evm',
  destination: { chain: 'monad', chainId: 143, assetId: 'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx', tokenAddress: liveWallet.token.address },
  steps: [
    { to: liveWallet.token.address, functionSignature: 'approve(address,uint256)', parameters: [liveWallet.vault.address, '{MIN_AMOUNT_OUT}'], value: '0' },
    { to: liveWallet.vault.address, functionSignature: 'depositFor(address,uint256)', parameters: [liveWallet.address, '{MIN_AMOUNT_OUT}'], value: '0' },
  ],
  chains: [
    { chain: 'base', name: 'Base' },
    { chain: 'arb', name: 'Arbitrum' },
    { chain: 'sol', name: 'Solana' },
  ],
  metadata: { title: 'Top up SmartRouter AI balance', intent: 'smartrouter_deposit' },
  note: '',
};

beforeEach(() => {
  options.mockResolvedValue(baseOptions);
  useDepositStore.getState().reset();
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReducedMotionProvider forceReduced>{ui}</ReducedMotionProvider>
    </QueryClientProvider>,
  );
}

const user = { address: liveWallet.address, slider: 'balanced' as const, dailyLimitUsd: micro(2_000_000), weeklyLimitUsd: micro(10_000_000), autoFreeFallback: true, freeRemaining: null, id: 'user_1', email: 'a@b.co', loginMethod: 'email', usage: null, country: null, vaultSetupNeeded: false, network: { chainId: 143, name: 'Monad' }, spendingKey: null };

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
    activity.mockResolvedValue({ items: [{ id: 'a1', type: 'deposit', status: 'completed', amountUsd: 5, chain: 'monad', token: 'USDC', counterparty: null, txHash: null, at: '2026-10-11T10:00:00.000Z' }, { id: 'a2', type: 'to_ai_balance', status: 'completed', amountUsd: 1, chain: 'monad', token: 'USDC', counterparty: null, txHash: null, at: '2026-10-11T09:00:00.000Z' }], nextBefore: null });
  });

  it('shows the wallet balance, the AI balance, both cap bars, the paid-answer setup and activity', async () => {
    wrap(<WalletSheet user={user} onSignOut={vi.fn()} onSettings={vi.fn()} />);
    expect(await screen.findByText('$12.40')).toBeInTheDocument();
    expect(screen.getByText(/USDC in your wallet · Monad/)).toBeInTheDocument();
    expect(screen.getByText('$2.00 arriving')).toBeInTheDocument();
    expect(screen.getByText(/AI balance:/)).toHaveTextContent('$0.40');
    expect(screen.getByRole('button', { name: 'Return to wallet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Get test funds' })).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Today' })).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByRole('progressbar', { name: 'This week' })).toHaveAttribute('aria-valuenow', '41');
    expect(screen.getByText('Set up paid answers once.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(await screen.findByText('Received $5.00')).toBeInTheDocument();
    expect(screen.getByText('Moved $1.00 to AI balance')).toBeInTheDocument();
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

  it('Deposit opens the Monad tab with the address and offers moving USDC into the AI balance', async () => {
    wrap(<WalletSheet user={user} onSignOut={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));
    expect(useUiStore.getState().walletView).toBe('deposit');
    expect(await screen.findByRole('tab', { name: 'Monad' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('tab', { name: 'Card' })).toBeInTheDocument();
    expect(screen.getByText(liveWallet.address)).toBeInTheDocument();
    expect(screen.getByText(liveWallet.token.address)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Move \$\d+\.\d{2} to AI balance/ })).toBeEnabled();
    expect(screen.getByRole('note')).toHaveTextContent('This QR/address is explicitly for Circle USDC on Monad only. Do NOT send Base, Arbitrum, or other-chain USDC expecting an automatic bridge.');
  });

  it('Other chains shows a coming-soon card when the backend has no Aurora recipe', async () => {
    wrap(<WalletSheet user={user} onSignOut={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Other chains' }));
    expect(await screen.findByText('Other chains: coming soon')).toBeInTheDocument();
  });

  it('Other chains offers the EVM source chains from the Aurora recipe', async () => {
    options.mockResolvedValue({ ...baseOptions, aurora: auroraRecipe });
    wrap(<WalletSheet user={user} onSignOut={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Other chains' }));
    expect(await screen.findByRole('radio', { name: 'Base' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Arbitrum' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Solana' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get Base deposit address' })).toBeEnabled();
  });
});
