/**
 * Paid answers (Monad handoff §6). A paid run is intentionally two requests:
 *
 *   1. `POST /run { quoteId, prompt }` → `402 PAYMENT_REQUIRED` with `details.voucher`: the EIP-712
 *      Voucher for exactly (previous total + this price).
 *   2. Sign it with the browser spending key (never the Privy wallet) and repeat the same request
 *      with `X-SmartRouter-Voucher: base64(JSON { cumulativeAmount, signature })` → the SSE stream.
 *
 * The first 402 is the protocol challenge, not a failed checkout. It is answered once; a second
 * challenge goes back to the caller as an error. Before signing, the voucher is checked: Monad's
 * chain, the SmartRouter vault, the user's own address, and a price no higher than the quote.
 * Every other status (409 SETUP_REQUIRED, 402 ALLOCATION_EXHAUSTED, 403 SPENDING_CAP_REACHED …)
 * is returned untouched for the SSE reader to map.
 *
 * One paid run at a time: calls are queued so a second Send waits for the first one's payment
 * step (not its whole stream).
 */
import { ApiError, apiRequest } from '@/lib/api/client';
import { voucherChallengeSchema, type VoucherChallenge } from '@/lib/api/types';
import { env } from '@/lib/env';
import type { MicroUsd } from '@/lib/money';

import { signWithSpendingKey } from './spendingKey';
import { assertTypedData, TypedDataMismatch, VOUCHER_HEADER } from './typedData';

let last: Promise<unknown> = Promise.resolve();

/** No spending key in this browser: run the one-time setup first. */
export class SpendingKeyMissing extends ApiError {
  constructor() {
    super({ status: 0, code: 'SPENDING_KEY_MISSING', message: 'Set up paid answers once (one signature, no gas).' });
  }
}

/** Forget queued payment state (sign-out, or after the spending key changed). */
export function resetPayments(): void {
  last = Promise.resolve();
}

interface Challenge {
  code?: string;
  details?: { voucher?: unknown; priceUsd?: number };
}

async function readChallenge(res: Response): Promise<{ voucher: VoucherChallenge; priceUsd: number | null } | null> {
  if (res.status !== 402) return null;
  let body: Challenge;
  try {
    body = (await res.clone().json()) as Challenge;
  } catch {
    return null;
  }
  if (body.code !== 'PAYMENT_REQUIRED') return null;
  const parsed = voucherChallengeSchema.safeParse(body.details?.voucher);
  if (!parsed.success) throw new ApiError({ status: 402, code: 'PAYMENT_FAILED', message: 'SmartRouter sent a voucher this app cannot read. Reload and try again.', details: parsed.error.issues });
  return { voucher: parsed.data, priceUsd: typeof body.details?.priceUsd === 'number' ? body.details.priceUsd : null };
}

/** base64(JSON { cumulativeAmount, signature }) — standard base64 of ASCII JSON. */
export function encodeVoucher(cumulativeAmount: string, signature: string): string {
  return btoa(JSON.stringify({ cumulativeAmount, signature }));
}

async function paidOnce(path: string, init: RequestInit, address: string, maxPriceUsd: MicroUsd | null): Promise<Response> {
  const first = await apiRequest(path, init);
  const challenge = await readChallenge(first);
  if (!challenge) return first;

  const { voucher, priceUsd } = challenge;
  try {
    assertTypedData(voucher, { primaryType: 'Voucher', contract: 'vault', field: 'user', address });
  } catch (err) {
    if (err instanceof TypedDataMismatch) throw new ApiError({ status: 402, code: 'PAYMENT_FAILED', message: err.message });
    throw err;
  }
  if (maxPriceUsd !== null && priceUsd !== null && Math.round(priceUsd * 1e6) > maxPriceUsd) {
    throw new ApiError({ status: 402, code: 'QUOTE_EXPIRED', message: 'The price changed since the quote. Getting a fresh quote.' });
  }
  const signature = await signWithSpendingKey(address, voucher);
  if (!signature) throw new SpendingKeyMissing();

  const headers = new Headers(init.headers);
  headers.set(VOUCHER_HEADER, encodeVoucher(voucher.message.cumulativeAmount, signature));
  return apiRequest(path, { ...init, headers });
}

/**
 * `POST /run` for a paid quote: answers the voucher challenge, then hands back the stream (or the
 * error response). On mocks MSW plays the same 402 handshake.
 */
export function paidFetch(path: string, init: RequestInit, address: string, maxPriceUsd: MicroUsd | null = null): Promise<Response> {
  if (!address) return Promise.reject(new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sign in to run paid models.' }));
  const run = last.then(() => paidOnce(path, init, address, env.mock ? null : maxPriceUsd));
  last = run.catch(() => undefined);
  return run;
}

export { toPaymentError } from './paymentErrors';
