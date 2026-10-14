'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

import { queryKeys } from '@/lib/api/keys';
import type { Wallet } from '@/lib/api/types';
import { formatUsd } from '@/lib/money';
import { localKeyAddress } from '@/lib/monad/spendingKey';

import { useSetupSpendingKey } from '@/hooks/useWallet';

function until(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ` until ${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
}

/**
 * Paid-answer setup (Monad handoff §5.2–5.3): a spending key in this browser, registered in the
 * SmartRouter vault on Monad with the daily/weekly caps. `active` and saved here → "Protected on
 * Monad: up to $X/day"; anything else → Set up (one Privy signature, relayed, no MON needed).
 */
export function SpendingKeyStatus({ wallet, onReady }: { wallet: Wallet; onReady?: () => void }) {
  const setup = useSetupSpendingKey();
  const key = wallet.spendingKey;
  // Ready only when the SERVER says the key is registered AND it is the key saved in this browser. A
  // key saved here that the vault doesn't know, or the account's key made in another browser, both
  // mean: show Set up (it registers a working key for this browser).
  const local = useQuery({ queryKey: queryKeys.wallet.localKey(wallet.address), queryFn: () => localKeyAddress(wallet.address), staleTime: Infinity });
  if (!key) return null;
  const registered = key.status === 'active' || key.status === 'expiring';
  if (registered && local.isPending) return <p className="text-xs text-text-2">Checking your spending key…</p>;
  const ours = !!local.data && !!key.address && local.data.toLowerCase() === key.address.toLowerCase();
  const caps = key.onChainCaps;
  if (registered && ours && key.status === 'active') {
    return (
      <p className="flex items-start gap-2 text-xs text-text-1">
        <ShieldCheck size={14} className="mt-px shrink-0 text-free" aria-hidden="true" />
        Protected on Monad: up to {caps ? formatUsd(caps.dailyUsd) : '—'}/day and {caps ? formatUsd(caps.weeklyUsd) : '—'}/week{until(key.expiresAt)}.
      </p>
    );
  }
  const daily = wallet.caps?.daily?.limitUsd;
  return (
    <div className="space-y-2 rounded-lg bg-bg-2 p-3">
      <p className="flex items-start gap-2 text-sm text-text-0">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
        {registered && !ours ? 'Set up paid answers in this browser.' : key.status === 'expiring' ? 'Your spending key expires soon.' : 'Set up paid answers once.'}
      </p>
      <p className="text-xs text-text-2">
        Creates a spending key in this browser and registers it in the SmartRouter vault on Monad, limited to your caps
        {daily !== undefined ? ` (${formatUsd(daily)} a day)` : ''}. It can only pay for answers from your AI balance. One signature, no gas.
      </p>
      <button
        type="button"
        disabled={setup.isPending}
        onClick={() => {
          setup.mutate(
            { wallet },
            {
              onSuccess: () => {
                void local.refetch();
                onReady?.();
              },
            },
          );
        }}
        className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
      >
        {setup.isPending ? 'Waiting for your signature…' : 'Set up'}
      </button>
    </div>
  );
}
