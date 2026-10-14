import { DEFAULT_EXPLORER_URL } from '@/lib/env';

/**
 * Monad explorer links (Monadscan). The API's `network.explorer` (from `GET /wallet` or
 * `GET /sessions/current`) wins once known — see `setExplorerBase`. Every hash/address is
 * regex-validated before it is rendered or linked (security.md §4).
 */
let base = DEFAULT_EXPLORER_URL;

/** Use the explorer the backend reports (only https URLs are accepted). */
export function setExplorerBase(url: string | null | undefined): void {
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') base = u.origin;
  } catch {
    /* keep the default */
  }
}

export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isTxHash(v: string): boolean {
  return TX_HASH_RE.test(v);
}
export function isAddress(v: string): boolean {
  return ADDRESS_RE.test(v);
}

export function txUrl(hash: string): string | null {
  return isTxHash(hash) ? `${base}/tx/${hash}` : null;
}
export function addressUrl(address: string): string | null {
  return isAddress(address) ? `${base}/address/${address}` : null;
}

export function shortHex(v: string, head = 6, tail = 4): string {
  return v.length > head + tail + 2 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}
