import { ApiError, OFFLINE_MESSAGE } from '../client';
import { describeAction, toUiAction } from '../errors';

const err = (code: ApiError['code'], extra: { retryAfter?: number; details?: unknown } = {}) =>
  new ApiError({ status: 400, code, message: 'm', ...(extra.retryAfter !== undefined ? { retryAfter: extra.retryAfter } : {}), ...(extra.details !== undefined ? { details: extra.details } : {}) });

describe('error semantics (PDF "Errors and edge cases")', () => {
  it('maps every PDF code to one UI action', () => {
    expect(toUiAction(err('UNAUTHENTICATED'))).toEqual({ kind: 'sign_in' });
    expect(toUiAction(err('FORBIDDEN'))).toEqual({ kind: 'wrong_wallet' });
    expect(toUiAction(err('ALLOCATION_EXHAUSTED', { details: { freeFallback: { available: true, remaining: 12 } } }))).toEqual({
      kind: 'top_up',
      freeFallback: { available: true, remaining: 12, modelId: 'free:llama-3.1-8b', auto: false },
    });
    expect(toUiAction(err('PAYMENT_REQUIRED'))).toMatchObject({ kind: 'top_up' });
    expect(toUiAction(err('QUOTE_EXPIRED'))).toEqual({ kind: 'requote' });
    expect(toUiAction(err('VALIDATION_FAILED'))).toEqual({ kind: 'requote' });
    expect(toUiAction(err('QUOTE_USED'))).toEqual({ kind: 'ignore' });
    expect(toUiAction(err('RATE_LIMITED', { retryAfter: 12 }))).toEqual({ kind: 'cooldown', seconds: 12 });
    expect(toUiAction(err('RATE_LIMITED'))).toEqual({ kind: 'cooldown', seconds: 10 });
    expect(toUiAction(err('FREE_LIMIT_REACHED', { details: { scope: 'global' } }))).toEqual({ kind: 'free_exhausted', scope: 'global' });
    expect(toUiAction(err('PROVIDER_UNAVAILABLE'))).toEqual({ kind: 'other_model' });
    expect(toUiAction(err('NOT_FOUND'))).toEqual({ kind: 'not_found' });
    // "Could not reach SmartRouter" only when the device is offline; otherwise the real message.
    expect(toUiAction(new ApiError({ status: 0, code: 'NETWORK', message: OFFLINE_MESSAGE }))).toEqual({ kind: 'offline' });
    expect(toUiAction(new ApiError({ status: 0, code: 'NETWORK', message: 'Request to SmartRouter failed: Failed to fetch' }))).toEqual({ kind: 'toast', title: 'Request to SmartRouter failed: Failed to fetch' });
    expect(toUiAction(err('PAYMENT_CANCELLED'))).toEqual({ kind: 'payment_cancelled' });
    expect(toUiAction(new Error('boom'))).toEqual({ kind: 'toast', title: 'Something went wrong, try again', description: 'boom' });
  });

  it('describes actions with the PDF copy', () => {
    expect(describeAction({ kind: 'top_up', freeFallback: { available: true, remaining: null, modelId: 'free:llama-3.1-8b', auto: false } })).toContain('Top up or Continue free');
    expect(describeAction({ kind: 'free_exhausted', scope: 'user' })).toBe('Free messages reset at 00:00 UTC');
    expect(describeAction({ kind: 'cooldown', seconds: 3 })).toContain('3 s');
    expect(describeAction({ kind: 'payment_cancelled' })).toContain('nothing was charged');
  });
});
