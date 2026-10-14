/**
 * SmartRouter's Monad contracts (Monad handoff §1, "Mainnet constants"). The handoff treats
 * `GET /health`, `GET /wallet` and `GET /sessions/current` as the runtime source of truth, so these
 * defaults are replaced by `setContracts` as soon as the API reports them. Every typed-data
 * signature is checked against them before the wallet or the spending key signs.
 */
import { env } from '@/lib/env';

export interface Contracts {
  chainId: number;
  /** Circle USDC on Monad. */
  usdc: string;
  vault: string;
  ledger: string | null;
}

const DEFAULTS: Contracts = {
  chainId: env.chainId,
  usdc: '0x754704bc059f8c67012fed69bc8a327a5aafb603',
  vault: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c',
  ledger: '0xdc28d25a044da278ae82cbf91cdf1c5997aa2163',
};

let current: Contracts = { ...DEFAULTS };

const isAddr = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

/** Adopt the addresses the API reports (ignores anything that isn't an address). */
export function setContracts(next: { usdc?: string | null; vault?: string | null; ledger?: string | null }): void {
  current = {
    chainId: current.chainId,
    usdc: isAddr(next.usdc) ? next.usdc : current.usdc,
    vault: isAddr(next.vault) ? next.vault : current.vault,
    ledger: isAddr(next.ledger) ? next.ledger : current.ledger,
  };
}

export function getContracts(): Contracts {
  return current;
}

export function resetContracts(): void {
  current = { ...DEFAULTS };
}

export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();
