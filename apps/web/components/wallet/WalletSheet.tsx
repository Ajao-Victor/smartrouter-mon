'use client';

import { useEffect, useRef, useState } from 'react';

import { ArrowDownToLine, ArrowUpRight, ArrowLeft, RefreshCw } from 'lucide-react';

import type { SettingsPatch, User } from '@/lib/api/types';
import { isTestnet } from '@/lib/env';
import { formatUsd } from '@/lib/money';

import { useReturnLocked, useWallet } from '@/hooks/useWallet';
import { useFaucet } from '@/hooks/useWalletBalance';
import { useUiStore } from '@/stores/uiStore';

import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { ActivityList } from '@/components/wallet/ActivityList';
import { CapBars } from '@/components/wallet/CapBars';
import { CapsEditor } from '@/components/wallet/CapsEditor';
import { CopyAddress } from '@/components/wallet/CopyAddress';
import { DepositPanel } from '@/components/wallet/DepositPanel';
import { SendPanel } from '@/components/wallet/SendPanel';
import { SpendingKeyStatus } from '@/components/wallet/SpendingKeyStatus';

export interface WalletSheetProps {
  user: User;
  onSignOut: () => void;
  onSettings: (patch: SettingsPatch) => void;
  busy?: { settings?: boolean; signOut?: boolean };
}

const DEPOSIT_POLL_MS = 10_000;
/** While the panel is open the balance refreshes on its own; the button is only a backup. */
const OPEN_POLL_MS = 30_000;

/**
 * The Wallet panel (Handover "Wallet"): one balance, spending caps, Deposit and Send, and an
 * activity feed — all from `GET /wallet` (refreshed after every deposit, send and paid answer).
 * Money for answers is locked and returned automatically; there is no second wallet to fund.
 */
export function WalletSheet({ user, onSignOut, onSettings, busy = {} }: WalletSheetProps) {
  const open = useUiStore((s) => s.walletSheetOpen);
  const view = useUiStore((s) => s.walletView);
  const setView = useUiStore((s) => s.setWalletView);
  const toggleWallet = useUiStore((s) => s.toggleWallet);
  const openDialog = useUiStore((s) => s.openDialog);
  const wallet = useWallet({ enabled: open, pollMs: !open ? false : view === 'deposit' ? DEPOSIT_POLL_MS : OPEN_POLL_MS });
  const returnLocked = useReturnLocked();
  const faucet = useFaucet(user.address);

  // "Funds arrived" when the balance goes up while the Deposit panel is open.
  const startBalance = useRef<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const balance = wallet.data?.main.balanceUsd ?? null;
  useEffect(() => {
    if (view !== 'deposit') {
      startBalance.current = null;
      setArrived(false);
      return;
    }
    if (balance === null) return;
    if (startBalance.current === null) startBalance.current = balance;
    else if (balance > startBalance.current) setArrived(true);
  }, [view, balance]);

  const close = () => {
    toggleWallet(false);
  };
  const w = wallet.data;

  return (
    <Sheet open={open} onClose={close} title="Wallet">
      {!w ? (
        wallet.isError ? (
          <p role="alert" className="text-sm text-signal">
            Could not load your wallet.{' '}
            <button type="button" className="underline" onClick={() => void wallet.refetch()}>
              Try again
            </button>
          </p>
        ) : (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        )
      ) : view === 'deposit' ? (
        <DepositPanel
          wallet={w}
          arrived={arrived}
          onBack={() => {
            setView('main');
          }}
        />
      ) : view === 'send' ? (
        <SendPanel
          wallet={w}
          onBack={() => {
            setView('main');
          }}
          onDone={() => {
            setView('main');
          }}
        />
      ) : view === 'caps' ? (
        <div className="space-y-5 pb-4">
          <button type="button" onClick={() => { setView('main'); }} className="inline-flex items-center gap-1 text-sm text-text-1 hocus:text-text-0">
            <ArrowLeft size={14} /> Wallet
          </button>
          <h3 className="font-display text-lg text-text-0">Spending caps</h3>
          <CapsEditor
            dailyLimitUsd={user.dailyLimitUsd}
            weeklyLimitUsd={user.weeklyLimitUsd}
            autoFreeFallback={user.autoFreeFallback}
            saving={busy.settings ?? false}
            onSave={onSettings}
          />
        </div>
      ) : (
        <div className="space-y-5 pb-4">
          {/* 1. Balance card */}
          <section className="group space-y-3 rounded-xl bg-bg-1 p-4 shadow-hairline" aria-label="Balance">
            <div>
              <div className="flex items-center gap-2">
                <p className="num font-display text-3xl text-text-0">{formatUsd(w.main.balanceUsd)}</p>
                {/* Hidden until the card is hovered (always shown, faint, on touch screens). */}
                <button
                  type="button"
                  aria-label="Refresh balance"
                  title="Refresh balance"
                  aria-busy={wallet.isFetching}
                  onClick={() => {
                    if (!wallet.isFetching) void wallet.refetch();
                  }}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-2 text-text-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hocus:text-text-0 focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
                >
                  <RefreshCw size={14} aria-hidden="true" className={wallet.isFetching ? 'animate-spin' : undefined} />
                </button>
              </div>
              <p className="text-xs text-text-2">
                {w.token.symbol} · {w.network?.name ?? 'Tempo'}
              </p>
            </div>
            {user.email && <p className="text-sm text-text-1">{user.email}</p>}
            <CopyAddress address={w.address} />
            {w.incomingUsd > 0 && <p className="text-sm text-accent-2">{formatUsd(w.incomingUsd)} arriving</p>}
            {w.locked && w.locked.remainingUsd > 0 && (
              <p className="text-sm text-text-1">
                Locked for current chats: <span className="num">{formatUsd(w.locked.remainingUsd)}</span>{' '}
                <button type="button" disabled={returnLocked.isPending} onClick={() => { returnLocked.mutate(); }} className="text-xs text-accent-2 underline-offset-2 hocus:underline disabled:opacity-60">
                  {returnLocked.isPending ? 'Returning…' : 'Return now'}
                </button>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setView('deposit'); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi">
                <ArrowDownToLine size={16} /> Deposit
              </button>
              <button type="button" onClick={() => { setView('send'); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-bg-2 px-4 text-sm font-medium text-text-0 transition-colors hocus:bg-bg-3">
                <ArrowUpRight size={16} /> Send
              </button>
              {isTestnet && (
                <button type="button" disabled={faucet.isPending} onClick={() => { faucet.mutate(undefined, { onSuccess: () => void wallet.refetch() }); }} className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-text-1 transition-colors hocus:bg-bg-2 hocus:text-text-0 disabled:opacity-60">
                  {faucet.isPending ? 'Requesting…' : 'Get test funds'}
                </button>
              )}
            </div>
            {!w.features.cashOut && <p className="text-2xs text-text-2">Cash out to a bank: coming soon.</p>}
          </section>

          {/* 2. Spending caps card */}
          <section className="space-y-3 rounded-xl bg-bg-1 p-4 shadow-hairline" aria-label="Spending caps">
            <div className="flex items-center justify-between">
              <p className="num text-2xs tracking-wider-ui text-text-2 uppercase">Spending caps</p>
              <button type="button" onClick={() => { setView('caps'); }} className="text-sm text-accent-2 hocus:underline">
                Edit caps
              </button>
            </div>
            <CapBars daily={w.caps?.daily ?? null} weekly={w.caps?.weekly ?? null} />
            <SpendingKeyStatus
              wallet={w}
              onReady={() => {
                useUiStore.getState().takeAfterKeySetup()?.();
              }}
            />
          </section>

          {/* 3. Activity */}
          <section className="space-y-2" aria-label="Activity">
            <p className="num text-2xs tracking-wider-ui text-text-2 uppercase">Activity</p>
            <ActivityList />
          </section>

          <section className="space-y-2" aria-label="Coming soon">
            <button type="button" onClick={() => { openDialog('waitlist'); }} className="w-full rounded-lg border border-dashed border-line-strong p-3 text-left transition-colors hocus:bg-bg-1">
              <p className="text-sm text-text-0">Naira via Paystack · MPP Credits</p>
              <p className="mt-0.5 text-xs text-text-2">Coming soon — join the waitlist →</p>
            </button>
          </section>

          <section className="space-y-2" aria-label="Session">
            <button type="button" onClick={onSignOut} disabled={busy.signOut} className="rounded-lg border border-signal/40 px-3 py-1.5 text-sm text-signal transition-colors hocus:bg-signal/10 disabled:opacity-60">
              {busy.signOut ? 'Signing out…' : 'Sign out'}
            </button>
            <p className="text-xs text-text-2">Money locked for chats returns to your wallet automatically about two hours after the last answer. Sign in with the same email on any device to get your chats back.</p>
          </section>
        </div>
      )}
    </Sheet>
  );
}
