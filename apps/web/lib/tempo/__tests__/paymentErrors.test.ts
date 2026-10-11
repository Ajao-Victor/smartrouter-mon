import { ApiError } from '@/lib/api/client';
import { toUiAction } from '@/lib/api/errors';

import { toPaymentError } from '../paymentErrors';

describe('payment errors', () => {
  it('"exceeds local maxDeposit" → ALLOCATION_EXHAUSTED (deposit), and free stays available when the server said nothing', () => {
    const e = toPaymentError(new Error('requested voucher amount 3001 exceeds local maxDeposit 3000'));
    expect(e?.code).toBe('ALLOCATION_EXHAUSTED');
    const action = toUiAction(e);
    expect(action).toMatchObject({ kind: 'top_up', freeFallback: { available: true } });
  });

  it('an empty wallet is a payment failure with a funding hint, not "Allocation used"', () => {
    const e = toPaymentError(new Error('insufficient funds for transfer'));
    expect(e?.code).toBe('PAYMENT_FAILED');
    expect(e?.message).toMatch(/Fund your wallet/);
  });

  it('keeps the server freeFallback when present', () => {
    const err = new ApiError({ status: 402, code: 'ALLOCATION_EXHAUSTED', message: 'x', details: { freeFallback: { available: false, modelId: 'free:llama-3.1-8b', freeRemainingToday: 0 } } });
    expect(toUiAction(err)).toMatchObject({ kind: 'top_up', freeFallback: { available: false, remaining: 0 } });
  });
});
