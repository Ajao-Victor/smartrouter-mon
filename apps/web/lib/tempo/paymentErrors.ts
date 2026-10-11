/**
 * Map mppx client-side errors (thrown before any request is sent) to PDF semantics:
 * "exceeds local maxDeposit" → ALLOCATION_EXHAUSTED, "already in flight" → SESSION_BUSY,
 * wallet rejection → PAYMENT_CANCELLED (nothing was charged). Pure, so it ships in the main
 * bundle while `session.ts` (mppx) stays lazy.
 */
import { ApiError } from '@/lib/api/client';
import { isTestnet } from '@/lib/env';

export function toPaymentError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (!(err instanceof Error)) return null;
  const m = err.message;
  // Handover: the deposit can run out before the banner says 100% — mppx refuses before sending
  // anything. Treat it as exhausted: keep the message, open the deposit dialog, resend after.
  // Handover: when the locked amount runs out the app opens the next automatic deposit itself; this
  // only surfaces if that also failed.
  if (/exceeds local maxDeposit/i.test(m)) return new ApiError({ status: 402, code: 'ALLOCATION_EXHAUSTED', message: 'The money locked for answers ran out and the next deposit could not be opened. Try again.', details: { reason: 'deposit', cause: err } });
  // Tempo refused a deposit beyond the spending key's on-chain daily limit.
  if (/SpendingLimitExceeded|spending limit/i.test(m)) return new ApiError({ status: 403, code: 'SPENDING_CAP_REACHED', message: "You've reached today's spending cap.", details: { reason: 'daily_limit', cause: err } });
  if (/already in flight/i.test(m)) return new ApiError({ status: 0, code: 'SESSION_BUSY', message: 'A payment is already in progress. Try again in a moment.', details: err });
  if (/reject|cancel|denied|abort|not allowed|NotAllowedError/i.test(m) || err.name === 'NotAllowedError') {
    return new ApiError({ status: 0, code: 'PAYMENT_CANCELLED', message: 'Payment cancelled — nothing was charged.', details: err });
  }
  // The wallet itself can't fund the deposit: show "Add funds", not "Allocation used".
  if (/insufficient|exceeds balance|balance too low/i.test(m)) return new ApiError({ status: 0, code: 'INSUFFICIENT_FUNDS', message: `Your wallet doesn't have enough ${isTestnet ? 'pathUSD' : 'USDC.e'} for this answer. Add funds, or use the free model.`, details: err });
  return null;
}
