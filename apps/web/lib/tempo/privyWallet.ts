/**
 * The user's Privy embedded wallet, exposed to non-React code. The Privy bridge
 * (`components/auth/AuthProvider`) registers a getter over `useWallets()`; wallet actions read it
 * with `getPrivyWallet()` (Handover: `wallets.find((w) => w.walletClientType === 'privy')`).
 *
 * `getPrivyAccount()` turns it into a Tempo account that viem signs itself (Privy signs hashes
 * only), used for authorizing the spending key and wallet sends. Answers are never signed by
 * Privy — the spending key signs those.
 */
import type { Hex } from 'viem';

import { ApiError } from '@/lib/api/client';
import { idb } from '@/lib/idb';

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

export function getPrivyWallet(): EmbeddedWallet | null {
  return getter?.().find((w) => w.walletClientType === 'privy') ?? null;
}

const PUBKEY_CACHE = 'sr:pubkey:';

// Storage can fail (private mode, blocked site data): never let it break signing.
const safeGet = async (k: string): Promise<string | null> => {
  try {
    return (await idb.get<string>(k)) ?? null;
  } catch {
    return null;
  }
};
const safeSet = async (k: string, v: string): Promise<void> => {
  try {
    await idb.set(k, v);
  } catch {
    /* ignore */
  }
};
const safeRemove = async (k: string): Promise<void> => {
  try {
    await idb.del(k);
  } catch {
    /* ignore */
  }
};

interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/**
 * The embedded wallet as a Tempo account that viem signs itself, with Privy only signing hashes
 * (`secp256k1_sign`). Tempo transactions (spending-key setup, updates, revokes, sends) need this:
 * only then can `/relay` attach SmartRouter's fee payment. Privy's `toViemAccount`, `custom(provider)`
 * or the Privy provider as a transport sign ordinary Ethereum transactions, so the user would pay
 * the fee and Tempo refuses it ("insufficient funds … have 0").
 *
 * The public key isn't secret: it's recovered once from a signature and cached per wallet, so the
 * extra signature happens only the first time on each device.
 */
export async function getPrivyAccount() {
  const wallet = getPrivyWallet();
  if (!wallet) throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sign in again to use your wallet.' });
  const [{ keccak256, recoverPublicKey, toHex }, { Account }] = await Promise.all([import('viem'), import('viem/tempo')]);

  const provider = (await wallet.getEthereumProvider()) as Eip1193;
  const sign = async ({ hash }: { hash: Hex }): Promise<Hex> => (await provider.request({ method: 'secp256k1_sign', params: [hash] })) as Hex;

  const cacheKey = PUBKEY_CACHE + wallet.address.toLowerCase();
  let pk = (await safeGet(cacheKey)) as Hex | null;
  if (!pk) {
    const probe = keccak256(toHex('smartrouter:public-key'));
    pk = await recoverPublicKey({ hash: probe, signature: await sign({ hash: probe }) });
    await safeSet(cacheKey, pk);
  }
  const publicKey = { prefix: 4, x: BigInt('0x' + pk.slice(4, 68)), y: BigInt('0x' + pk.slice(68, 132)) } as const;

  const account = Account.from({ publicKey, sign });
  if (account.address.toLowerCase() !== wallet.address.toLowerCase()) {
    await safeRemove(cacheKey);
    throw new Error('Wallet signer mismatch, please try again');
  }
  return account;
}
