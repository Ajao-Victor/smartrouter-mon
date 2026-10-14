'use client';

import { ExternalLink } from 'lucide-react';

import type { WalletActivityItem } from '@/lib/api/types';
import { shortHex, txUrl } from '@/lib/explorer';

import { useWalletActivity } from '@/hooks/useWallet';

import { Skeleton } from '@/components/ui/Skeleton';

const usd = (n: number) => `$${n.toFixed(2)}`;

/** How each activity `type` reads (Monad backend `GET /wallet/activity`). */
function describe(i: WalletActivityItem): string {
  switch (i.type) {
    case 'deposit':
      return `Received ${usd(i.amountUsd)}${i.chain && i.chain !== 'monad' ? ` via ${i.chain === 'aurora' ? 'another chain' : i.chain}` : ''}${i.counterparty ? ` · ${shortHex(i.counterparty)}` : ''}`;
    case 'send':
      return `Sent ${usd(i.amountUsd)} to ${i.counterparty ? shortHex(i.counterparty) : '…'}${i.chain && i.chain !== 'monad' ? ` on ${i.chain}` : ''}${i.deliveredUsd != null && i.deliveredUsd !== i.amountUsd ? ` (${usd(i.deliveredUsd)} arrived)` : ''}`;
    case 'to_ai_balance':
      return `Moved ${usd(i.amountUsd)} to AI balance`;
    case 'from_ai_balance':
      return `${usd(i.amountUsd)} returned to wallet${i.spentUsd != null ? ` (${usd(i.spentUsd)} spent on answers)` : ''}`;
    case 'answers_settled':
      return `${usd(i.amountUsd)} paid for answers`;
    default:
      return `${i.type} ${usd(i.amountUsd)}`;
  }
}

const STATUS: Record<string, string> = { pending: 'Pending', completed: '', failed: 'Failed', refunding: 'Refunding', refunded: 'Refunded' };

/** The activity feed below both cards (`GET /wallet/activity`, newest first). */
export function ActivityList() {
  const activity = useWalletActivity();
  if (activity.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const items = activity.data?.items ?? [];
  if (items.length === 0) return <p className="text-sm text-text-2">No wallet activity yet.</p>;
  return (
    <ul className="divide-y divide-line" aria-label="Wallet activity">
      {items.map((i) => {
        const minor = i.type === 'to_ai_balance' || i.type === 'answers_settled';
        const link = i.txHash ? txUrl(i.txHash) : null;
        return (
          <li key={i.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${minor ? 'text-text-2' : 'text-text-0'}`}>{describe(i)}</span>
              <span className="block text-2xs text-text-2">
                {new Date(i.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {STATUS[i.status] ? <span className={i.status === 'failed' ? 'text-signal' : 'text-warn'}> · {STATUS[i.status]}</span> : null}
              </span>
            </span>
            {link && (
              <a href={link} target="_blank" rel="noopener noreferrer" aria-label="View transaction" className="shrink-0 rounded-md p-1 text-text-2 hocus:text-text-0">
                <ExternalLink size={14} />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
