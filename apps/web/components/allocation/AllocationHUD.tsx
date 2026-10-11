'use client';

import { clsx } from 'clsx';
import { Wallet } from 'lucide-react';

import { formatUsd } from '@/lib/money';

import { useWallet } from '@/hooks/useWallet';
import { useUiStore } from '@/stores/uiStore';
import { useUsageStore } from '@/stores/usageStore';

/**
 * Top-bar wallet pill: the one balance from `GET /wallet` (Handover "Wallet"); opens the Wallet
 * panel. Turns red when the wallet can't fund the next answer.
 */
export function AllocationHUD() {
  const wallet = useWallet();
  const toggleWallet = useUiStore((s) => s.toggleWallet);
  const alert = useUsageStore((s) => s.usage?.alert ?? null);
  const balance = wallet.data?.main.balanceUsd;
  const low = alert?.meter === 'balance';
  const label = balance !== undefined ? `Wallet: ${formatUsd(balance)}` : 'Wallet';

  return (
    <button
      type="button"
      data-hud="wallet"
      aria-label={label}
      onClick={() => {
        toggleWallet();
      }}
      className={clsx('num inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors hocus:bg-bg-2', low ? 'text-signal' : 'text-text-1 hocus:text-text-0')}
    >
      <Wallet size={16} aria-hidden="true" />
      {balance !== undefined ? formatUsd(balance) : <span className="hidden sm:inline">Wallet</span>}
    </button>
  );
}
