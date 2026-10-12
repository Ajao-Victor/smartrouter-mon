'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

import { queryKeys } from '@/lib/api/keys';
import type { Wallet } from '@/lib/api/types';
import { localKeyAddress } from '@/lib/tempo/spendingKey';

import { useSetupSpendingKey } from '@/hooks/useWallet';

function until(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ` until ${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
}

/**
 * Spending key status (Handover "Spending caps card"): `active` → "Protected on Tempo: up to $X/day
 * until …"; `missing`, `expiring` or `revoked` → a Set up button that runs the one-time setup.
 */
export function SpendingKeyStatus({ wallet, onReady }: { wallet: Wallet; onReady?: () => void }) {
  const setup = useSetupSpendingKey();
  const key = wallet.spendingKey;
  // Ready only when the SERVER says the key is active AND it is the key saved in this browser. A key
  // saved here that the server doesn't know (an old failed setup), or the account's key made in
  // another browser, both mean: show Set up (it adds a working key for this browser).
  const local = useQuery({ queryKey: queryKeys.wallet.localKey(wallet.address), queryFn: () => localKeyAddress(wallet.address), staleTime: Infinity });
  if (!key) return null;
  if (key.status === 'active' && local.isPending) return <p className="text-xs text-text-2">Checking your spending key…</p>;
  const ready = key.status === 'active' && !!local.data && !!key.address && local.data.toLowerCase() === key.address.toLowerCase();
  const otherBrowser = key.status === 'active' && !ready;
  if (ready) {
    return (
      <p className="flex items-start gap-2 text-xs text-text-1">
        <ShieldCheck size={14} className="mt-px shrink-0 text-free" aria-hidden="true" />
        Protected on Tempo: up to ${key.setup?.limitUsd.toFixed(2) ?? '—'}/day{until(key.expiresAt)}.
      </p>
    );
  }
  const limit = key.setup?.limitUsd;
  return (
    <div className="space-y-2 rounded-lg bg-bg-2 p-3">
      <p className="flex items-start gap-2 text-sm text-text-0">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
        {otherBrowser ? 'Set up paid answers in this browser.' : key.status === 'expiring' ? 'Your spending key expires soon.' : key.status === 'revoked' ? 'Your spending key was revoked.' : 'Set up paid answers once.'}
      </p>
      <p className="text-xs text-text-2">
        Allow SmartRouter to spend up to ${limit !== undefined ? limit.toFixed(2) : '—'} a day from your wallet for {String(key.setup?.expiryDays ?? 7)} days, only into Tempo&apos;s payment
        contract. One signature, no fee. You can revoke it any time.
      </p>
      <button
        type="button"
        disabled={setup.isPending || !key.setup}
        onClick={() => {
          setup.mutate(wallet, {
            onSuccess: () => {
              onReady?.();
            },
          });
        }}
        className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
      >
        {setup.isPending ? 'Waiting for your signature…' : 'Set up'}
      </button>
    </div>
  );
}
