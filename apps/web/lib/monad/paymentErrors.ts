/**
 * Map wallet and signing errors (thrown before a request is sent) to the app's error codes: a
 * rejected signature → PAYMENT_CANCELLED (nothing was charged); a refused typed-data check →
 * PAYMENT_FAILED. Pure, so it ships in the main bundle while viem stays lazy.
 */
import { ApiError } from '@/lib/api/client';

export function toPaymentError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (!(err instanceof Error)) return null;
  const m = err.message;
  if (err.name === 'TypedDataMismatch') return new ApiError({ status: 0, code: 'PAYMENT_FAILED', message: m, details: err });
  if (/reject|cancel|denied|abort|not allowed|NotAllowedError/i.test(m) || err.name === 'NotAllowedError') {
    return new ApiError({ status: 0, code: 'PAYMENT_CANCELLED', message: 'Cancelled — nothing was charged.', details: err });
  }
  if (/insufficient|exceeds balance|balance too low|not enough usdc/i.test(m)) {
    return new ApiError({ status: 0, code: 'INSUFFICIENT_FUNDS', message: "Your wallet doesn't have enough USDC on Monad. Add funds, or use the free model.", details: err });
  }
  return null;
}
