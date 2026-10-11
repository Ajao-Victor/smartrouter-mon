'use client';

import { useCallback, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ApiError, isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import { runStream, type RunOutcome, type SseError } from '@/lib/api/sse';
import { FREE_MODEL_ID, freeFallbackSchema, type FreeFallback, type Quote, type User } from '@/lib/api/types';
import { env } from '@/lib/env';
import { toPaymentError } from '@/lib/tempo/paymentErrors';

import { optimisticMessage, useChatCache } from '@/hooks/useChat';
import { isQuoteExpired } from '@/hooks/useQuote';
import { useAllocationStore } from '@/stores/allocationStore';
import { useAuthStore } from '@/stores/authStore';
import { useComposerStore } from '@/stores/composerStore';
import { useStreamStore } from '@/stores/streamStore';
import { toast } from '@/stores/toastStore';
import { useUsageStore } from '@/stores/usageStore';

export interface RunRequest {
  prompt: string;
  /** Fresh quote for the chosen model (price shown beside Send). */
  quote: Quote;
  label?: string | null;
  autoFreeFallback: boolean;
}

/**
 * - `blocked`: a spending cap is reached, or the wallet can't fund the answer — the message is kept
 *   and the cap / "Add funds" bar is shown with the free model offered.
 * - `needs_key`: the one-time spending-key setup hasn't been done in this browser.
 * - `needs_requote`: QUOTE_EXPIRED / VALIDATION_FAILED → re-quote silently and run.
 * - `needs_sign_in`: 401 → the sign-in modal is open; send again after sign-in.
 * - `needs_reauth`: FORBIDDEN → sign out and back in.
 * - `rate_limited`: wait `Retry-After` seconds, then retry.
 */
export type RunStart = 'started' | 'blocked' | 'needs_key' | 'needs_requote' | 'needs_sign_in' | 'needs_reauth' | 'rate_limited' | 'free_exhausted' | 'cancelled' | 'busy' | 'ignored';

/** Why a paid answer can't go out right now (Handover "Usage banners" / "Errors"). */
export interface PaidBlock {
  prompt: string;
  /** `daily` / `weekly` = cap reached ("Raise cap"); `balance` = wallet can't fund it ("Add funds"). */
  meter: 'daily' | 'weekly' | 'balance';
  message: string;
  freeFallback: FreeFallback;
}

const FREE_FALLBACK_DEFAULT: FreeFallback = { available: true, remaining: null, modelId: FREE_MODEL_ID, auto: false };

/** Codes that mean the run never started (nothing streamed, nothing charged). */
const PRE_STREAM_CODES: ReadonlySet<string> = new Set([
  'ALLOCATION_EXHAUSTED',
  'SPENDING_CAP_REACHED',
  'SPENDING_KEY_MISSING',
  'INSUFFICIENT_FUNDS',
  'PAYMENT_REQUIRED',
  'QUOTE_EXPIRED',
  'QUOTE_USED',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'SESSION_BUSY',
  'FREE_LIMIT_REACHED',
  'PAYMENT_CANCELLED',
  'PAYMENT_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PROVIDER_UNAVAILABLE',
  'NOT_FOUND',
]);

function freeFallbackFrom(details: unknown): FreeFallback {
  // Never decide on the client that free messages are used up: only the server's
  // `details.freeFallback.available` (or a 429 FREE_LIMIT_REACHED) says so.
  const raw = details && typeof details === 'object' ? (details as { freeFallback?: unknown }).freeFallback : undefined;
  const parsed = raw ? freeFallbackSchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : FREE_FALLBACK_DEFAULT;
}

function capMeter(details: unknown): 'daily' | 'weekly' {
  const reason = details && typeof details === 'object' ? (details as { reason?: unknown }).reason : undefined;
  return reason === 'weekly_limit' ? 'weekly' : 'daily';
}

/**
 * One turn in the browser (Handover "Every message follows the same steps"): quote → run.
 * Free quotes: `POST /run` with the plain `api()` helper, no wallet. Paid quotes: the spending key
 * signs through the mppx session (automatic small deposits within the caps, silent vouchers).
 * SSE events go into the stream store; `done` records the charge and refreshes the banner.
 * Failed answers are never charged.
 */
export function useRun(chatId: string) {
  const qc = useQueryClient();
  const cache = useChatCache(chatId);
  const [blocked, setBlocked] = useState<PaidBlock | null>(null);
  const [running, setRunning] = useState(false);
  const [cooldownKey, setCooldownKey] = useState(0);
  /** Seconds from the last RATE_LIMITED `Retry-After`. */
  const retryAfterRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
    void qc.invalidateQueries({ queryKey: queryKeys.chats() });
    void qc.invalidateQueries({ queryKey: queryKeys.requests() });
    // Refresh the Wallet panel after every paid answer.
    void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
  }, [qc]);

  const walletAddress = useCallback((): string | null => {
    return useAuthStore.getState().account?.address ?? qc.getQueryData<User>(queryKeys.me())?.address ?? null;
  }, [qc]);

  /**
   * Before the first paid answer: paid runs enabled, and the spending key set up in this browser
   * (`GET /wallet` → `spendingKey.status` is `active` and the key is ours).
   */
  const preparePayments = useCallback(async (): Promise<void> => {
    if (!useAllocationStore.getState().paidRunsEnabled) {
      throw new ApiError({ status: 503, code: 'PROVIDER_UNAVAILABLE', message: 'Paid models are not available right now. Use the free model.' });
    }
    if (env.mock) return;
    const address = walletAddress();
    if (!address) throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sign in to run paid models.' });
    const w = await qc.query({ queryKey: queryKeys.wallet.get(), queryFn: ({ signal }) => api.wallet.get(signal), staleTime: 30_000 });
    const { localKeyAddress } = await import('@/lib/tempo/spendingKey');
    const local = await localKeyAddress(address);
    const key = w.spendingKey;
    if (!key || key.status !== 'active' || !local || key.address?.toLowerCase() !== local.toLowerCase()) {
      const { SpendingKeyMissing } = await import('@/lib/tempo/session');
      throw new SpendingKeyMissing();
    }
  }, [qc, walletAddress]);

  /** Stream one assistant message and apply every record/failure rule. */
  const executeStream = useCallback(
    async (args: { messageId: string; userMessageId: string; quote: Quote; prompt: string }): Promise<RunOutcome> => {
      const { messageId, userMessageId, quote, prompt } = args;
      const controller = new AbortController();
      abortRef.current = controller;
      const outcome = await runStream(
        { quoteId: quote.quoteId, prompt },
        { free: quote.free, address: walletAddress() },
        {
          onMeta: (m) => {
            useStreamStore.getState().setMeta(messageId, { requestId: m.requestId, modelId: m.modelId, label: m.label, priceUsd: m.priceUsd, free: m.free, userMessageId: m.userMessageId ?? null, assistantMessageId: m.assistantMessageId ?? null });
            if (m.remainingUsd !== null && m.remainingUsd !== undefined) useAllocationStore.getState().setRemaining(m.remainingUsd);
            if (m.usage) useUsageStore.getState().setUsage(m.usage);
            cache.update(messageId, { requestId: m.requestId, modelId: m.modelId });
            if (m.userMessageId) cache.update(userMessageId, { id: m.userMessageId });
          },
          onDelta: (text) => {
            useStreamStore.getState().append(messageId, text);
          },
          onHeartbeat: () => {
            useStreamStore.getState().heartbeat(messageId);
          },
          onFallback: (f) => {
            useStreamStore.getState().fallback(messageId, f);
            cache.update(messageId, { modelId: f.toModelId });
          },
          onPending: (p) => {
            useStreamStore.getState().pending(messageId, { requestId: p.requestId, pollUrl: p.pollUrl });
            cache.update(messageId, { requestId: p.requestId, status: 'pending' });
          },
        },
        controller.signal,
      );
      abortRef.current = null;

      if (outcome.kind === 'done') {
        const d = outcome.data;
        useStreamStore.getState().done(messageId, { chargedUsd: d.chargedUsd, latencyMs: d.latencyMs ?? null, requestId: d.requestId, files: d.files, citations: d.citations, text: d.text });
        if (!quote.free) useAllocationStore.getState().applyCharge(d.chargedUsd);
        // Refresh the banner from every `done` event (no polling).
        if (d.usage) useUsageStore.getState().setUsage(d.usage);
        const entry = useStreamStore.getState().byMessageId[messageId];
        cache.update(messageId, { text: d.text ?? entry?.text ?? '', status: 'done', requestId: d.requestId, modelId: d.modelId || entry?.modelId || quote.modelId, chargedUsd: d.chargedUsd, files: d.files, citations: d.citations });
        refresh();
        return outcome;
      }
      if (outcome.kind === 'pending') return outcome;

      if (outcome.kind === 'aborted') {
        useStreamStore.getState().fail(messageId, { code: 'ABORTED', message: 'Stopped. You were not charged for an unfinished answer.', refunded: true, refundedUsd: null, canRerunFree: true });
      } else {
        const e: SseError = outcome.data;
        // Failed paid run: "not charged" and offer the free model (`freeRerun.available`).
        useStreamStore.getState().fail(messageId, { code: e.code, message: e.message, refunded: e.refunded, refundedUsd: e.refundedUsd ?? null, canRerunFree: e.freeRerun?.available ?? !quote.free });
        if (e.code === 'RATE_LIMITED') setCooldownKey((k) => k + 1);
      }
      cache.update(messageId, { status: 'error' });
      refresh();
      return outcome;
    },
    [cache, refresh, walletAddress],
  );

  /** Shared pre-flight: handles every error thrown before a stream starts. */
  const handlePreflightError = useCallback(
    (err: unknown, prompt: string, cleanup: () => void): RunStart => {
      cleanup();
      const e = isApiError(err) ? err : toPaymentError(err);
      if (!e) {
        toast.error('Something went wrong, try again', err instanceof Error ? err.message : undefined);
        return 'cancelled';
      }
      switch (e.code) {
        case 'SPENDING_CAP_REACHED':
          // 403: show the exhausted banner for that cap and offer the free model.
          setBlocked({ prompt, meter: capMeter(e.details), message: e.message, freeFallback: freeFallbackFrom(e.details) });
          void qc.invalidateQueries({ queryKey: queryKeys.me() });
          return 'blocked';
        case 'INSUFFICIENT_FUNDS':
          // The wallet is empty (the deposit can't be made): "Add funds", not "Allocation used".
          setBlocked({ prompt, meter: 'balance', message: e.message, freeFallback: freeFallbackFrom(e.details) });
          return 'blocked';
        case 'SPENDING_KEY_MISSING':
          return 'needs_key';
        case 'ALLOCATION_EXHAUSTED':
          toast.error('Could not open the next deposit', e.message);
          return 'cancelled';
        case 'PAYMENT_REQUIRED':
          toast.error('Payment required', e.message);
          return 'cancelled';
        case 'QUOTE_EXPIRED':
        case 'VALIDATION_FAILED':
          return 'needs_requote';
        case 'QUOTE_USED':
          // Already ran (double click / retry): not charged twice; the next Send gets a new quote.
          return 'ignored';
        case 'RATE_LIMITED':
          retryAfterRef.current = Math.max(1, Math.round(e.retryAfter ?? 10));
          setCooldownKey((k) => k + 1);
          toast.warn(`Busy — sending again in ${String(retryAfterRef.current)} s`);
          return 'rate_limited';
        case 'SESSION_BUSY':
          toast.warn('A payment is already in progress', 'Wait for the current answer to start streaming.');
          return 'busy';
        case 'FREE_LIMIT_REACHED':
          // The server's message says which limit (yours, or the free model's daily capacity).
          toast.warn(e.message || 'Free messages reset at 00:00 UTC', 'Pick a paid model to keep going.');
          return 'free_exhausted';
        case 'PAYMENT_FAILED':
          console.error('[SmartRouter] payment failed', e.details);
          toast.error('Payment failed — you were not charged', e.message);
          return 'cancelled';
        case 'PAYMENT_CANCELLED':
          toast.info('Cancelled', 'Nothing was charged. Your message is still in the box.');
          return 'cancelled';
        case 'UNAUTHENTICATED':
          return 'needs_sign_in';
        case 'FORBIDDEN':
          toast.error(e.message || 'This payment belongs to another account', 'Sign out and back in.');
          return 'needs_reauth';
        case 'PROVIDER_UNAVAILABLE':
          toast.warn(e.message || 'This model is unavailable right now', 'Pick another model.');
          return 'cancelled';
        case 'NOT_FOUND':
          void qc.invalidateQueries({ queryKey: queryKeys.chats() });
          toast.warn('That chat or quote is gone', 'The list has been refreshed.');
          return 'cancelled';
        default:
          console.error('[SmartRouter] run failed before streaming', e.code, e.message, e.details);
          toast.error(e.message);
          return 'cancelled';
      }
    },
    [qc],
  );

  const run = useCallback(
    async (req: RunRequest): Promise<RunStart> => {
      const { quote, prompt } = req;
      if (isQuoteExpired(quote.expiresAt)) return 'needs_requote';

      if (!quote.free) {
        // `exhausted` blocks paid Send and offers the free model.
        const alert = useUsageStore.getState().usage?.alert ?? null;
        if (alert?.level === 'exhausted') {
          if (req.autoFreeFallback) {
            toast.info(alert.message || 'Paid answers are paused — continuing free');
            return runFree(prompt);
          }
          setBlocked({ prompt, meter: alert.meter === 'balance' ? 'balance' : alert.meter === 'weekly' ? 'weekly' : 'daily', message: alert.message, freeFallback: FREE_FALLBACK_DEFAULT });
          return 'blocked';
        }
      }

      setRunning(true);
      try {
        if (!quote.free) await preparePayments();
      } catch (err) {
        setRunning(false);
        return handlePreflightError(err, prompt, () => undefined);
      }

      const userMsg = optimisticMessage({ role: 'user', text: prompt });
      const asstMsg = optimisticMessage({ role: 'assistant', text: '', status: 'streaming', modelId: quote.modelId });
      cache.append(userMsg);
      cache.append(asstMsg);
      useComposerStore.getState().setDraft('');
      useStreamStore.getState().start(asstMsg.id, { modelId: quote.modelId, label: req.label ?? quote.label, free: quote.free });
      setBlocked(null);

      const outcome = await executeStream({ messageId: asstMsg.id, userMessageId: userMsg.id, quote, prompt });
      setRunning(false);
      if (outcome.kind === 'error' && PRE_STREAM_CODES.has(outcome.data.code) && !useStreamStore.getState().byMessageId[asstMsg.id]?.requestId) {
        // Pre-stream failure surfaced through the stream path: undo the optimistic turn and apply the rule.
        const err = new ApiError({ status: 0, code: outcome.data.code as ApiError['code'], message: outcome.data.message, details: outcome.data.details, ...(outcome.data.retryAfter !== undefined ? { retryAfter: outcome.data.retryAfter } : {}) });
        return handlePreflightError(err, prompt, () => {
          cache.remove(userMsg.id);
          cache.remove(asstMsg.id);
          useStreamStore.getState().clear(asstMsg.id);
          useComposerStore.getState().setDraft(prompt);
        });
      }
      return 'started';
    },
    // runFree is defined below; both are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache, executeStream, handlePreflightError, preparePayments],
  );

  /**
   * "Continue free" / "Try free model" (Handover "Running the free model"): quote with the free
   * option's `modelId`, then `POST /run` with the plain `api()` helper — no wallet, no balance.
   */
  const runFree = useCallback(
    async (prompt: string, modelId: string = FREE_MODEL_ID): Promise<RunStart> => {
      try {
        const quote = await api.chats.quote(chatId, { prompt, modelId });
        return await run({ prompt, quote: { ...quote, free: true }, autoFreeFallback: false });
      } catch (err) {
        return handlePreflightError(err, prompt, () => undefined);
      }
    },
    [chatId, handlePreflightError, run],
  );

  return {
    run,
    runFree,
    cancel,
    running,
    blocked,
    clearBlocked: () => {
      setBlocked(null);
    },
    cooldownKey,
    /** Seconds to wait after a `rate_limited` result (from `Retry-After`). */
    retryAfterSeconds: () => retryAfterRef.current,
    bumpCooldown: () => {
      setCooldownKey((k) => k + 1);
    },
  };
}

export function isRateLimited(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'RATE_LIMITED';
}

