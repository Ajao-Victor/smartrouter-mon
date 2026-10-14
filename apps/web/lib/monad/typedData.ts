/**
 * EIP-712 on Monad — mirrors `packages/shared/src/typed-data.ts` of the backend so both sides agree
 * byte for byte with the contracts:
 *
 *   Voucher   — "SmartRouter may take up to `cumulativeAmount` in total" (spending key, per answer)
 *   Setup     — registers the spending key and the daily/weekly caps (Privy wallet, once)
 *   ReceiveWithAuthorization / TransferWithAuthorization — gasless USDC (Privy wallet, ERC-3009)
 *
 * The API sends integers as decimal strings. They are kept as strings everywhere except the signing
 * call itself, where `toSignable` turns uint/int fields into `bigint` (Monad handoff §5.3).
 */

import type { TypedData } from '@/lib/api/types';

import { getContracts, sameAddress } from './contracts';

export const VOUCHER_HEADER = 'X-SmartRouter-Voucher';

/** Decimal-string integers → `bigint` for the fields the types declare as uint/int. */
export function toSignable(typed: TypedData): Record<string, unknown> {
  const fields = typed.types[typed.primaryType] ?? [];
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = typed.message[f.name];
    if (v === null || v === undefined) throw new Error(`Typed data is missing ${f.name}`);
    out[f.name] = /^u?int\d*$/.test(f.type) ? BigInt(v) : v;
  }
  return out;
}

/** JSON body for the submit endpoints: every message field as a string, exactly as received. */
export function toBody(typed: TypedData, signature: string): Record<string, string> {
  const body: Record<string, string> = { signature };
  for (const [k, v] of Object.entries(typed.message)) if (v !== null) body[k] = String(v);
  return body;
}

/** Thrown when typed data from the API doesn't match what this app expects to sign. */
export class TypedDataMismatch extends Error {
  constructor(what: string) {
    super(`Refusing to sign: ${what}. Reload and try again.`);
    this.name = 'TypedDataMismatch';
  }
}

/**
 * Checks before anything is signed: Monad's chain id, the expected contract, the expected type,
 * and (when given) the wallet that must appear in the message.
 */
export function assertTypedData(typed: TypedData, expect: { primaryType: string; contract: 'vault' | 'usdc'; field?: string; address?: string }): void {
  const c = getContracts();
  if (typed.primaryType !== expect.primaryType) throw new TypedDataMismatch(`expected ${expect.primaryType}, got ${typed.primaryType}`);
  if (typed.domain.chainId !== c.chainId) throw new TypedDataMismatch(`chain ${String(typed.domain.chainId)} is not Monad (${String(c.chainId)})`);
  const contract = expect.contract === 'vault' ? c.vault : c.usdc;
  if (!sameAddress(typed.domain.verifyingContract, contract)) throw new TypedDataMismatch(`unexpected contract ${typed.domain.verifyingContract}`);
  if (expect.field && expect.address) {
    const v = typed.message[expect.field];
    if (typeof v !== 'string' || !sameAddress(v, expect.address)) throw new TypedDataMismatch(`${expect.field} is not your wallet`);
  }
}
