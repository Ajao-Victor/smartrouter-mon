'use client';

import { useCallback, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ApiError, isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import { runStream, type RunOutcome, type SseError } from '@/lib/api/sse';
import { FREE_MODEL_ID, freeFallbackSchema, type FreeFallback, type Quote } from '@/lib/api/types';
import { micro, type MicroUsd } from '@/lib/money';
import { toPaymentError } from '@/lib/tempo/paymentErrors';

import { optimisticMessage, useChatCache } from '@/hooks/useChat';
import { isQuoteExpired } from '@/hooks/useQuote';
import { selectCanAfford, selectNextDeposit, useAllocationStore } from '@/stores/allocationStore';
import { useComposerStore } from '@/stores/composerStore';
import { useStreamStore } from '@/stores/streamStore';
import { toast } from '@/stores/toastStore';
import { selectPaidBlocked, useUsageStore } from '@/stores/usageStore';

export interface RunRequest {
  prompt: string;
  /** Fresh quote for the chosen model (price on the Send button). */
  quote: Quote;
  label?: string | null;
  autoFreeFallback: boolean;
}

/**
 * - `needs_top_up`: the deposit (or weekly limit) can't cover it — the message is kept.
 * - `needs_requote`: QUOTE_EXPIRED / VALIDATION_FAILED → re-quote silently and run.
 * - `needs_sign_in`: 401 → the sign-in modal is open; send again after sign-in.
 * - `needs_reauth`: FORBIDDEN → sign out and back in.
 * - `rate_limited`: wait `Retry-After` seconds, then retry.
 */
export type RunStart = 'started' | 'needs_top_up' | 'needs_requote' | 'needs_sign_in' | 'needs_reauth' | 'rate_limited' | 'free_exhausted' | 'cancelled' | 'busy' | 'ignored';

export interface NeedsTopUp {
  priceUsd: MicroUsd;
  prompt: string;
  freeFallback: FreeFallback;
  /** `deposit`: open the deposit dialog (close-and-reopen). `weekly_limit`: raise the limit or go free. */
  reason: 'deposit' | 'weekly_limit';
}

/** 402 ALLOCATION_EXHAUSTED with `details.reason: 'weekly_limit'` is the weekly limit; anything else is the deposit. */
function topUpReason(details: unknown): NeedsTopUp['reason'] {
  return details && typeof details === 'object' && (details as { reason?: unknown }).reason === 'weekly_limit' ? 'weekly_limit' : 'deposit';
}

const FREE_FALLBACK_DEFAULT: FreeFallback = { available: true, remaining: null, modelId: FREE_MODEL_ID, auto: false };

export interface ComparePair {
  compareGroup: string;
  userMessageId: string;
  leftMessageId: string;
  rightMessageId: string;
  leftModelId: string;
  rightModelId: string;
  prompt: string;
}

/** Codes that mean the run never started (nothing streamed, nothing charged). */
const PRE_STREAM_CODES: ReadonlySet<string> = new Set(['ALLOCATION_EXHAUSTED', 'PAYMENT_REQUIRED', 'QUOTE_EXPIRED', 'QUOTE_USED', 'VALIDATION_FAILED', 'RATE_LIMITED', 'SESSION_BUSY', 'FREE_LIMIT_REACHED', 'PAYMENT_CANCELLED', 'PAYMENT_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'PROVIDER_UNAVAILABLE', 'NOT_FOUND']);

function compareGroupId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cg_${String(Date.now())}_${Math.random().toString(36).slice(2)}`;
}

/**
 * PDF "A normal turn" + "Paying for runs" in the browser: quote → affordability check
 * (Top up / Continue free before contacting the server) → one-time payment prep → `POST /run`
 * (free: plain fetch; paid: the mppx manager with the voucher) → SSE events into the stream
 * store → `done`: record the charge and refresh the balance. Failed answers are never charged.
 */
export function useRun(chatId: string) {
  const qc = useQueryClient();
  const cache = useChatCache(chatId);
  const [needsTopUp, setNeedsTopUp] = useState<NeedsTopUp | null>(null);
  const [running, setRunning] = useState(false);
  const [cooldownKey, setCooldownKey] = useState(0);
  /** Seconds from the last RATE_LIMITED `Retry-After`. */
  const retryAfterRef = useRef(0);
  const [compare, setCompare] = useState<ComparePair | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
    void qc.invalidateQueries({ queryKey: queryKeys.chats() });
    void qc.invalidateQueries({ queryKey: queryKeys.requests() });
  }, [qc]);

  /**
   * Handover "Paid messages", steps 2–3: a viem wallet client over the Privy embedded wallet on
   * `network.chainId`, and one `sessionManager` per signed-in user with `maxDeposit` = the chosen
   * deposit (default `suggestedDepositUsd`). No prompt here — the deposit opens on the first paid run.
   */
  const preparePayments = useCallback(async (): Promise<void> => {
    const alloc = useAllocationStore.getState();
    if (!alloc.paidRunsEnabled) throw new ApiError({ status: 503, code: 'PROVIDER_UNAVAILABLE', message: 'Paid models are not available right now. Use the free model.' });
    try {
      const { ensureSession } = await import('@/lib/tempo/session');
      await ensureSession({ maxDepositUsd: selectNextDeposit(alloc), chainId: alloc.chainId });
    } catch (err) {
      throw toPaymentError(err) ?? err;
    }
  }, []);

  /** Stream one assistant message and apply every PDF record/failure rule. */
  const executeStream = useCallback(
    async (args: { messageId: string; userMessageId: string; quote: Quote; prompt: string; compareGroup?: string }): Promise<RunOutcome> => {
      const { messageId, userMessageId, quote, prompt, compareGroup } = args;
      const controller = new AbortController();
      abortRef.current = controller;
      const outcome = await runStream(
        { quoteId: quote.quoteId, prompt, ...(compareGroup ? { compareGroup } : {}) },
        { free: quote.free },
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
        useStreamStore.getState().fail(messageId, { code: e.code, message: e.message, refunded: e.refunded, refundedUsd: e.refundedUsd ?? null, canRerunFree: e.freeRerun?.available ?? !quote.free });
        if (e.code === 'RATE_LIMITED') setCooldownKey((k) => k + 1);
      }
      cache.update(messageId, { status: 'error' });
      refresh();
      return outcome;
    },
    [cache, refresh],
  );

  /** Shared pre-flight: handles every error thrown before a stream starts. */
  const handlePreflightError = useCallback(
    (err: unknown, prompt: string, priceUsd: MicroUsd, cleanup: () => void): RunStart => {
      cleanup();
      const e = isApiError(err) ? err : toPaymentError(err);
      if (!e) {
        toast.error('Something went wrong, try again', err instanceof Error ? err.message : undefined);
        return 'cancelled';
      }
      switch (e.code) {
        case 'ALLOCATION_EXHAUSTED':
        case 'PAYMENT_REQUIRED': {
          // Only the server knows the free allowance. When it didn't say (e.g. mppx refused locally
          // with "exceeds local maxDeposit"), assume free is available — the free run itself will
          // answer FREE_LIMIT_REACHED if it isn't.
          const raw = (e.details as { freeFallback?: unknown } | undefined)?.freeFallback;
          const parsed = raw ? freeFallbackSchema.safeParse(raw) : null;
          setNeedsTopUp({ priceUsd, prompt, freeFallback: parsed?.success ? parsed.data : FREE_FALLBACK_DEFAULT, reason: topUpReason(e.details) });
          return 'needs_top_up';
        }
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
          toast.info('Payment cancelled', 'Nothing was charged. Your prompt is still in the box.');
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
      const price = quote.free ? micro(0) : quote.priceUsd;

      if (!quote.free) {
        const alloc = useAllocationStore.getState();
        const usage = useUsageStore.getState();
        // `exhausted` (100%) blocks paid Send and offers the free model.
        const blocked = selectPaidBlocked(usage);
        if (blocked || !selectCanAfford(price)(alloc)) {
          if (req.autoFreeFallback) {
            toast.info('Allocation used — continuing free');
            return runFree(prompt);
          }
          const reason = blocked && usage.usage?.alert?.meter === 'weekly' ? 'weekly_limit' : 'deposit';
          setNeedsTopUp({ priceUsd: price, prompt, freeFallback: FREE_FALLBACK_DEFAULT, reason });
          return 'needs_top_up';
        }
      }

      setRunning(true);
      try {
        if (!quote.free) await preparePayments();
      } catch (err) {
        setRunning(false);
        return handlePreflightError(err, prompt, price, () => undefined);
      }

      const userMsg = optimisticMessage({ role: 'user', text: prompt });
      const asstMsg = optimisticMessage({ role: 'assistant', text: '', status: 'streaming', modelId: quote.modelId });
      cache.append(userMsg);
      cache.append(asstMsg);
      useComposerStore.getState().setDraft('');
      useStreamStore.getState().start(asstMsg.id, { modelId: quote.modelId, label: req.label ?? quote.label, free: quote.free });
      setNeedsTopUp(null);

      const outcome = await executeStream({ messageId: asstMsg.id, userMessageId: userMsg.id, quote, prompt });
      setRunning(false);
      if (outcome.kind === 'error' && PRE_STREAM_CODES.has(outcome.data.code) && !useStreamStore.getState().byMessageId[asstMsg.id]?.requestId) {
        // Pre-stream failure surfaced through the stream path: undo the optimistic turn and apply the rule.
        const err = new ApiError({ status: 0, code: outcome.data.code as ApiError['code'], message: outcome.data.message, details: outcome.data.details, ...(outcome.data.retryAfter !== undefined ? { retryAfter: outcome.data.retryAfter } : {}) });
        return handlePreflightError(err, prompt, price, () => {
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

  /** "Continue free" / "Rerun on free model": re-quote with the free model, then run. */
  const runFree = useCallback(
    async (prompt: string): Promise<RunStart> => {
      try {
        const quote = await api.chats.quote(chatId, { prompt, modelId: FREE_MODEL_ID });
        return await run({ prompt, quote: { ...quote, free: true }, autoFreeFallback: false });
      } catch (err) {
        return handlePreflightError(err, prompt, micro(0), () => undefined);
      }
    },
    [chatId, handlePreflightError, run],
  );

  /** PDF Compare: two `/run` calls sharing a `compareGroup`, both answers stream side by side. */
  const runCompare = useCallback(
    async (req: { prompt: string; left: Quote; right: Quote }): Promise<RunStart> => {
      const { prompt, left, right } = req;
      if (isQuoteExpired(left.expiresAt) || isQuoteExpired(right.expiresAt)) return 'needs_requote';
      const total = micro((left.free ? 0 : left.priceUsd) + (right.free ? 0 : right.priceUsd));
      if (total > 0) {
        const alloc = useAllocationStore.getState();
        if (selectPaidBlocked(useUsageStore.getState()) || !selectCanAfford(total)(alloc)) {
          setNeedsTopUp({ priceUsd: total, prompt, freeFallback: FREE_FALLBACK_DEFAULT, reason: 'deposit' });
          return 'needs_top_up';
        }
      }
      setRunning(true);
      try {
        if (total > 0) await preparePayments();
      } catch (err) {
        setRunning(false);
        return handlePreflightError(err, prompt, total, () => undefined);
      }
      const compareGroup = compareGroupId();
      const userMsg = optimisticMessage({ role: 'user', text: prompt });
      const leftMsg = optimisticMessage({ role: 'assistant', text: '', status: 'streaming', modelId: left.modelId });
      const rightMsg = optimisticMessage({ role: 'assistant', text: '', status: 'streaming', modelId: right.modelId });
      cache.append(userMsg);
      cache.append(leftMsg);
      cache.append(rightMsg);
      useComposerStore.getState().setDraft('');
      useStreamStore.getState().start(leftMsg.id, { modelId: left.modelId, label: left.label, free: left.free });
      useStreamStore.getState().start(rightMsg.id, { modelId: right.modelId, label: right.label, free: right.free });
      setNeedsTopUp(null);
      setCompare({ compareGroup, userMessageId: userMsg.id, leftMessageId: leftMsg.id, rightMessageId: rightMsg.id, leftModelId: left.modelId ?? '', rightModelId: right.modelId ?? '', prompt });
      await Promise.all([
        executeStream({ messageId: leftMsg.id, userMessageId: userMsg.id, quote: left, prompt, compareGroup }),
        executeStream({ messageId: rightMsg.id, userMessageId: userMsg.id, quote: right, prompt, compareGroup }),
      ]);
      setRunning(false);
      return 'started';
    },
    [cache, executeStream, handlePreflightError, preparePayments],
  );

  return {
    run,
    runFree,
    runCompare,
    cancel,
    running,
    needsTopUp,
    clearNeedsTopUp: () => {
      setNeedsTopUp(null);
    },
    compare,
    clearCompare: () => {
      setCompare(null);
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
