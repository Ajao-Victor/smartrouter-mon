/**
 * The user's Privy embedded wallet, exposed to non-React code. The Privy bridge
 * (`components/auth/AuthProvider`) registers a getter over `useWallets()`.
 *
 * Monad handoff §3 and §5.1: after login, use the embedded wallet **whose address equals the
 * `address` returned by `/auth/privy`** — never `wallets[0]`, never MetaMask — switch it to Monad
 * (chain 143), and only then sign typed data. It signs the one-time Setup and the USDC
 * authorizations (deposits, sends); answers are signed by the spending key instead.
 */
import type { Hex } from 'viem';

import { ApiError } from '@/lib/api/client';
import type { TypedData } from '@/lib/api/types';
import { env } from '@/lib/env';

import { sameAddress } from './contracts';
import { toSignable } from './typedData';

export interface EmbeddedWallet {
  address: string;
  walletClientType: string;
  getEthereumProvider: () => Promise<unknown>;
  switchChain?: (chainId: number) => Promise<void>;
}

let getter: (() => readonly EmbeddedWallet[]) | null = null;

export function registerPrivyWallets(fn: (() => readonly EmbeddedWallet[]) | null): void {
  getter = fn;
}

/** The Privy embedded wallet for `address` (the `/auth/privy` address), or null. */
export function getPrivyWallet(address: string): EmbeddedWallet | null {
  return getter?.().find((w) => w.walletClientType === 'privy' && sameAddress(w.address, address)) ?? null;
}

/** A recognisable stand-in signature for `NEXT_PUBLIC_MOCK=1` (MSW never verifies it). */
export const MOCK_SIGNATURE = `0x${'11'.repeat(65)}` as Hex;

/** Sign EIP-712 typed data with the embedded wallet for `address`, on Monad. */
export async function signWithPrivy(address: string, typed: TypedData): Promise<Hex> {
  if (env.mock) return MOCK_SIGNATURE;
  const wallet = getPrivyWallet(address);
  if (!wallet) {
    throw new ApiError({ status: 0, code: 'FORBIDDEN', message: 'Your SmartRouter wallet is not connected in this browser. Sign out and back in.' });
  }
  const [{ createWalletClient, custom }, { chain }] = await Promise.all([import('viem'), import('./chain')]);
  await wallet.switchChain?.(chain.id);
  const provider = (await wallet.getEthereumProvider()) as Parameters<typeof custom>[0];
  const client = createWalletClient({ account: wallet.address as Hex, chain, transport: custom(provider) });
  return client.signTypedData({
    domain: { ...typed.domain, verifyingContract: typed.domain.verifyingContract as Hex },
    types: typed.types,
    primaryType: typed.primaryType,
    message: toSignable(typed),
  } as never);
}
