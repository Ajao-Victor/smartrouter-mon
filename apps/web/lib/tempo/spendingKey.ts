/**
 * The spending key (Handover "One-time setup: the spending key"): a Tempo access key that lives in
 * this browser and can spend from the user's wallet only up to an on-chain daily limit, only into
 * Tempo's payment contract, for 7 days. It signs every paid answer, so Privy is asked once at
 * setup and never per message.
 *
 * The private key is a non-extractable WebCrypto P256 key; only the CryptoKey handle is kept, in
 * IndexedDB, per wallet address. No script (and no XSS) can read the private key out.
 */
import { Account, Actions, WebCryptoP256 } from 'viem/tempo';

import type { SpendingKeyState } from '@/lib/api/types';
import { env } from '@/lib/env';
import { idb } from '@/lib/idb';

import { rootRelayClient } from './relay';

type KeyPair = Awaited<ReturnType<typeof WebCryptoP256.createKeyPair>>;

const keyName = (address: string) => `sr:spending-key:${address.toLowerCase()}`;

/** The stored key pair for this wallet, if any. */
export async function loadKeyPair(address: string): Promise<KeyPair | null> {
  return (await idb.get<KeyPair>(keyName(address))) ?? null;
}

async function createKeyPair(address: string): Promise<KeyPair> {
  const keyPair = await WebCryptoP256.createKeyPair({ extractable: false });
  await idb.set(keyName(address), keyPair);
  return keyPair;
}

/** The access-key account that signs answers for `address` (no Privy involvement). */
export function keyAccount(keyPair: KeyPair, address: string) {
  return Account.fromWebCryptoP256(keyPair, { access: address as `0x${string}` });
}

/** Address of this browser's spending key for `address`, if one exists. */
export async function localKeyAddress(address: string): Promise<string | null> {
  const kp = await loadKeyPair(address);
  return kp ? keyAccount(kp, address).accessKeyAddress : null;
}

const toUnits = (usd: number) => BigInt(Math.round(usd * 1e6));

/**
 * Generate the key and authorize it with the Privy wallet (one signature; the fee goes through
 * `/relay`). Returns the key's address for `POST /wallet/spending-key`.
 */
export async function authorizeSpendingKey(args: { address: string; setup: NonNullable<SpendingKeyState['setup']>; chainId: number | null }): Promise<string> {
  if (env.mock) return '0x000000000000000000000000000000000000beef';
  const keyPair = (await loadKeyPair(args.address)) ?? (await createKeyPair(args.address));
  const key = keyAccount(keyPair, args.address);
  const client = await rootRelayClient(args.chainId);
  const { setup } = args;
  await Actions.accessKey.authorizeSync(client, {
    accessKey: key,
    expiry: Math.floor(Date.now() / 1000) + setup.expiryDays * 86_400,
    limits: [{ token: setup.token as `0x${string}`, limit: toUnits(setup.limitUsd), period: setup.periodSeconds }],
    scopes: setup.scopes as never,
    feePayer: true,
  });
  return key.accessKeyAddress;
}

/** After `PATCH /me/settings` returned `spendingKeyLimitUsd`: move the key's on-chain limit to it. */
export async function updateSpendingKeyLimit(args: { address: string; token: string; limitUsd: number; chainId: number | null }): Promise<void> {
  if (env.mock) return;
  const keyPair = await loadKeyPair(args.address);
  if (!keyPair) return;
  const key = keyAccount(keyPair, args.address);
  const client = await rootRelayClient(args.chainId);
  await Actions.accessKey.updateLimitSync(client, { accessKey: key.accessKeyAddress, token: args.token as `0x${string}`, limit: toUnits(args.limitUsd), feePayer: true });
}

/** "Revoke spending key" (settings, and offered on sign-out). */
export async function revokeSpendingKey(args: { address: string; accessKeyAddress: string; chainId: number | null }): Promise<void> {
  if (!env.mock) {
    const client = await rootRelayClient(args.chainId);
    await Actions.accessKey.revokeSync(client, { accessKey: args.accessKeyAddress as `0x${string}`, feePayer: true });
  }
  await idb.del(keyName(args.address));
}
