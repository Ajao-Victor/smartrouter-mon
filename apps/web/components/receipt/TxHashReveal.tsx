'use client';

import { useState } from 'react';

import { Check, Copy, ExternalLink } from 'lucide-react';

import { isTxHash, shortHex, txUrl } from '@/lib/explorer';

/** Settlement hash with copy + explorer link. Validated before linking (security.md §4). */
export function TxHashReveal({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const valid = isTxHash(hash);
  const url = txUrl(hash);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!valid) return <span className="num text-xs text-signal">invalid hash</span>;

  return (
    <span className="num inline-flex items-center gap-2 text-xs text-accent-2" aria-label={`Transaction ${hash}`}>
      <span className="sr-only">{hash}</span>
      <span aria-hidden="true">{shortHex(hash, 10, 8)}</span>
      <button
        type="button"
        aria-label="Copy transaction hash"
        onClick={() => {
          void copy();
        }}
        className="rounded-md p-1 text-text-2 transition-colors hocus:bg-bg-2 hocus:text-text-0"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="View on Monad explorer" className="rounded-md p-1 text-text-2 transition-colors hocus:bg-bg-2 hocus:text-accent-2">
          <ExternalLink size={14} />
        </a>
      )}
    </span>
  );
}
