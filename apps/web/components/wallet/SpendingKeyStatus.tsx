'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

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
  // The key lives in one browser. Signed in somewhere else, the account's key is "active" but this
  // browser can't use it: offer setup here too (it adds a key for this browser; money is untouched).
  const local = useQuery({ queryKey: ['spending-key-local', wallet.address], queryFn: () => localKeyAddress(wallet.address), staleTime: Infinity });
  if (!key) return null;
  const otherBrowser = key.status === 'active' && local.isSuccess && local.data?.toLowerCase() !== key.address?.toLowerCase();
  if (key.status === 'active' && !otherBrowser) {
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
              void local.refetch();
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
