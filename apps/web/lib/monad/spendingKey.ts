/**
 * The spending key (Monad handoff §5.2–5.3): one app-scoped secp256k1 key generated in this
 * browser with `viem/accounts`, kept in IndexedDB per wallet address. Its private key is never
 * sent to the API and is never the embedded wallet's key. It only signs per-answer vouchers,
 * ratings and Compare votes; the vault lets it spend within the caps registered by Setup.
 *
 * Setup: `GET /wallet/setup?signer=KEY` → the Privy wallet signs the Setup typed data →
 * `POST /wallet/setup { ...message, signature }` (the operator relays `setupFor`; no MON needed).
 * The key is saved only once the vault has accepted it, so a failed attempt never leaves a key the
 * vault doesn't know.
 */
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

import { api } from '@/lib/api/endpoints';
import type { RelayedTx, TypedData } from '@/lib/api/types';
import { idb } from '@/lib/idb';

import { sameAddress } from './contracts';
import { signWithPrivy } from './privyWallet';
import { assertTypedData, toBody, toSignable, TypedDataMismatch } from './typedData';

const keyName = (address: string) => `sr:monad-spending-key:${address.toLowerCase()}`;

/** The stored private key for this wallet, if any. */
async function loadPrivateKey(address: string): Promise<Hex | null> {
  try {
    const v = await idb.get<string>(keyName(address));
    return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

/** The spending-key account for `address`, if this browser has one. */
export async function loadSpendingKey(address: string): Promise<PrivateKeyAccount | null> {
  const pk = await loadPrivateKey(address);
  return pk ? privateKeyToAccount(pk) : null;
}

/** Address of this browser's spending key for `address`, if one exists. */
export async function localKeyAddress(address: string): Promise<string | null> {
  return (await loadSpendingKey(address))?.address ?? null;
}

/** Forget this browser's key for `address`. */
export async function forgetSpendingKey(address: string): Promise<void> {
  await idb.del(keyName(address));
}

export interface SetupOptions {
  /** The `/auth/privy` address: the wallet that signs Setup. */
  address: string;
  /** New caps (after a change in settings); omitted = the account's saved caps. */
  dailyUsd?: number;
  weeklyUsd?: number;
  /** Re-sign Setup for the key this browser already has (cap change) instead of a fresh key. */
  reuseKey?: boolean;
}

/** Register (or re-register) the spending key and caps in SmartRouterVault. */
export async function registerSpendingKey(opts: SetupOptions): Promise<RelayedTx & { signer: string }> {
  const existing = opts.reuseKey ? await loadPrivateKey(opts.address) : null;
  const pk = existing ?? generatePrivateKey();
  const key = privateKeyToAccount(pk);
  const typed = await api.wallet.setupRequest({ signer: key.address, ...(opts.dailyUsd !== undefined ? { dailyUsd: opts.dailyUsd } : {}), ...(opts.weeklyUsd !== undefined ? { weeklyUsd: opts.weeklyUsd } : {}) });
  assertTypedData(typed, { primaryType: 'Setup', contract: 'vault', field: 'user', address: opts.address });
  if (!sameAddress(String(typed.message.signer), key.address)) throw new TypedDataMismatch('the setup is for a different spending key');
  const signature = await signWithPrivy(opts.address, typed);
  const res = await api.wallet.setup(toBody(typed, signature));
  await idb.set(keyName(opts.address), pk);
  return { ...res, signer: key.address };
}

/** Sign typed data with this browser's spending key for `address`; null when there is no key. */
export async function signWithSpendingKey(address: string, typed: TypedData): Promise<Hex | null> {
  const key = await loadSpendingKey(address);
  if (!key) return null;
  return key.signTypedData({
    domain: { ...typed.domain, verifyingContract: typed.domain.verifyingContract as Hex },
    types: typed.types,
    primaryType: typed.primaryType,
    message: toSignable(typed),
  });
}
