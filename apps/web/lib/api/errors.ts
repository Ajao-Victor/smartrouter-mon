/**
 * Error semantics the UI must honour (PDF "Errors and edge cases"). Maps an `ApiError` (or any
 * thrown value) to one UI action so hooks and components stay consistent.
 */
import { ApiError, isApiError } from '@/lib/api/client';
import { FREE_MODEL_ID, freeFallbackSchema, type FreeFallback } from '@/lib/api/types';
import { env } from '@/lib/env';

export type UiErrorAction =
  | { kind: 'sign_in' }
  | { kind: 'wrong_wallet' }
  | { kind: 'top_up'; freeFallback: FreeFallback }
  | { kind: 'requote' }
  | { kind: 'ignore' }
  | { kind: 'cooldown'; seconds: number }
  | { kind: 'free_exhausted'; scope: 'user' | 'global' }
  | { kind: 'other_model' }
  | { kind: 'not_found' }
  | { kind: 'offline' }
  | { kind: 'payment_cancelled' }
  | { kind: 'toast'; title: string; description?: string };

export const DEFAULT_COOLDOWN_SECONDS = 10;

function detail(err: ApiError, key: string): unknown {
  const d = err.details;
  if (d && typeof d === 'object' && key in d) return (d as Record<string, unknown>)[key];
  return undefined;
}

export function toUiAction(err: unknown): UiErrorAction {
  if (!isApiError(err)) {
    return { kind: 'toast', title: 'Something went wrong, try again', ...(err instanceof Error ? { description: err.message } : {}) };
  }
  switch (err.code) {
    case 'UNAUTHENTICATED':
      return { kind: 'sign_in' };
    case 'FORBIDDEN':
      return { kind: 'wrong_wallet' };
    case 'ALLOCATION_EXHAUSTED':
    case 'PAYMENT_REQUIRED': {
      const raw = detail(err, 'freeFallback');
      const parsed = raw ? freeFallbackSchema.safeParse(raw) : null;
      return { kind: 'top_up', freeFallback: parsed?.success ? parsed.data : { available: true, remaining: null, modelId: FREE_MODEL_ID, auto: false } };
    }
    case 'QUOTE_EXPIRED':
    case 'VALIDATION_FAILED':
      return { kind: 'requote' };
    case 'QUOTE_USED':
      return { kind: 'ignore' };
    case 'RATE_LIMITED':
      return { kind: 'cooldown', seconds: Math.max(1, Math.round(err.retryAfter ?? DEFAULT_COOLDOWN_SECONDS)) };
    case 'FREE_LIMIT_REACHED':
      return { kind: 'free_exhausted', scope: detail(err, 'scope') === 'global' ? 'global' : 'user' };
    case 'PROVIDER_UNAVAILABLE':
      return { kind: 'other_model' };
    case 'NOT_FOUND':
      return { kind: 'not_found' };
    case 'NETWORK':
      return { kind: 'offline' };
    case 'PAYMENT_CANCELLED':
      return { kind: 'payment_cancelled' };
    case 'INTERNAL':
      return { kind: 'toast', title: 'Something went wrong, try again' };
    default:
      return { kind: 'toast', title: err.message };
  }
}

export function describeAction(a: UiErrorAction): string {
  switch (a.kind) {
    case 'sign_in':
      return 'Sign in to continue';
    case 'wrong_wallet':
      return 'This payment session belongs to another wallet. Sign out and back in with the paying wallet.';
    case 'top_up':
      return 'Your balance is used up — Top up or Continue free';
    case 'requote':
      return 'Getting a fresh quote';
    case 'ignore':
      return 'Already sent';
    case 'cooldown':
      return `Too many requests — try again in ${String(a.seconds)} s`;
    case 'free_exhausted':
      return 'Free messages reset at 00:00 UTC';
    case 'other_model':
      return 'No model is available for this task right now — try another model or the free one';
    case 'not_found':
      return 'That no longer exists';
    case 'offline':
      return 'Could not reach SmartRouter';
    case 'payment_cancelled':
      return 'Payment cancelled — nothing was charged';
    case 'toast':
      return a.title;
  }
}

/**
 * Why the API is unreachable, for the offline alert/toast. In development with mocks off this
 * names the configured URL and the `NEXT_PUBLIC_MOCK=1` escape hatch.
 */
export function apiUnreachableHint(): string {
  if (process.env.NODE_ENV === 'development' && !env.mock) {
    return `No API answered at ${env.apiUrl}. Check NEXT_PUBLIC_API_URL in apps/web/.env.local, or set NEXT_PUBLIC_MOCK=1 to run on mocks.`;
  }
  return 'Check your connection and try again.';
}

export { ApiError };
