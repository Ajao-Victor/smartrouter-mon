'use client';

import { Copy, ExternalLink } from 'lucide-react';

import { addressUrl, shortHex } from '@/lib/explorer';

import { toast } from '@/stores/toastStore';

/** Shortened address with copy and explorer buttons. */
export function CopyAddress({ address, explorer = true, full = false }: { address: string; explorer?: boolean; full?: boolean }) {
  const url = explorer ? addressUrl(address) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success('Address copied');
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <span className="num inline-flex min-w-0 items-center gap-1.5 text-sm text-text-0">
      <span className={full ? 'break-all' : 'truncate'}>{full ? address : shortHex(address, 8, 6)}</span>
      <button type="button" aria-label="Copy address" onClick={() => void copy()} className="shrink-0 rounded-md p-1 text-text-2 transition-colors hocus:bg-bg-2 hocus:text-text-0">
        <Copy size={14} />
      </button>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="View on explorer" className="shrink-0 rounded-md p-1 text-text-2 transition-colors hocus:bg-bg-2 hocus:text-text-0">
          <ExternalLink size={14} />
        </a>
      )}
    </span>
  );
}
