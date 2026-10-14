/**
 * `POST /run` streaming client (PDF "Streaming answers"): Server-Sent Events read with fetch +
 * `ReadableStream` (never `EventSource` — the request is a POST with a body). Events are
 * `event:` + JSON `data:` lines separated by a blank line; lines starting with `:` are
 * heartbeats (every 15 s) and are ignored for content but reset the watchdog.
 *
 * Paid quotes go through `paidFetch` (Monad handoff §6: the 402 voucher challenge, signed by the
 * spending key, then the same request with `X-SmartRouter-Voucher`); free quotes use the plain
 * `apiRequest` helper (X-Session-Token).
 */
import { z } from 'zod';

import { ApiError, apiRequest, errorFromFetchFailure, errorFromResponse, isApiError } from '@/lib/api/client';
import { RUN_PATH } from '@/lib/api/endpoints';
import { fileSchema, usageSchema, usdSchema, type RunInput } from '@/lib/api/types';
import { toPaymentError } from '@/lib/monad/paymentErrors';
import { micro, type MicroUsd } from '@/lib/money';

export const HEARTBEAT_MS = 15_000;
/** PDF: answers can take over a minute to start; heartbeats keep the connection open. */
export const WATCHDOG_MS = 60_000;

const meta = z.object({
  requestId: z.string(),
  modelId: z.string(),
  label: z.string().default(''),
  priceUsd: usdSchema.default(0),
  free: z.boolean().default(false),
  chatId: z.string().nullish(),
  userMessageId: z.string().nullish(),
  assistantMessageId: z.string().nullish(),
  /** Paid runs: what's left of the AI balance after this answer's charge. */
  remainingUsd: usdSchema.nullish(),
  /** Paid runs: the router's decision hash, recorded on Monad with the receipt. */
  routeHash: z.string().nullish(),
  /** Paid runs: the usage object for the banners (Handover "Usage banners"). */
  usage: usageSchema.nullish(),
});
const delta = z.object({ text: z.string() });
const fallback = z.object({ fromModelId: z.string(), toModelId: z.string(), label: z.string().default(''), reason: z.string().default('') });
const done = z.object({
  requestId: z.string(),
  modelId: z.string().default(''),
  text: z.string().nullish(),
  files: z.array(fileSchema).default([]),
  citations: z.array(z.unknown()).default([]),
  /** The real charge for this request (the `Payment-Receipt` header counts only earlier requests). */
  chargedUsd: usdSchema.default(0),
  latencyMs: z.number().nullish(),
  usage: usageSchema.nullish(),
});
const pending = z.object({ requestId: z.string(), pollUrl: z.string() });
const error = z.object({
  code: z.string().default('INTERNAL'),
  message: z.string().default('The run failed'),
  refunded: z.boolean().default(false),
  refundedUsd: usdSchema.nullish(),
  freeRerun: z.object({ available: z.boolean().default(false), modelId: z.string().nullish() }).nullish(),
  /** Pre-stream failures only: the error body's `details` (e.g. `reason`, `freeFallback`) and `Retry-After`. */
  details: z.unknown().optional(),
  retryAfter: z.number().optional(),
});

export type SseMeta = z.output<typeof meta>;
export type SseFallback = z.output<typeof fallback>;
export type SseDone = z.output<typeof done>;
export type SsePending = z.output<typeof pending>;
export type SseError = z.output<typeof error>;

export interface RunHandlers {
  onMeta?: (m: SseMeta) => void;
  onDelta?: (text: string) => void;
  onHeartbeat?: () => void;
  onFallback?: (f: SseFallback) => void;
  onPending?: (p: SsePending) => void;
  onDone?: (d: SseDone) => void;
  onError?: (e: SseError) => void;
}

export type RunOutcome =
  | { kind: 'done'; data: SseDone }
  | { kind: 'pending'; data: SsePending }
  | { kind: 'error'; data: SseError }
  | { kind: 'aborted' };

interface Frame {
  event: string;
  data: string;
  /** Comment-only frame (`: heartbeat`). */
  comment: boolean;
}

/** Parse complete SSE frames out of a buffer; returns remaining partial text. */
export function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, '\n');
  const parts = normalised.split(/\n\n/);
  const rest = parts.pop() ?? '';
  const frames: Frame[] = [];
  for (const block of parts) {
    let event = 'message';
    let comment = false;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) comment = true;
      else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0 || event !== 'message') frames.push({ event, data: data.join('\n'), comment: false });
    else if (comment) frames.push({ event: 'heartbeat', data: '', comment: true });
  }
  return { frames, rest };
}

function errorEvent(code: string, message: string, freeRerun = true): SseError {
  return { code, message, refunded: true, refundedUsd: null, freeRerun: { available: freeRerun, modelId: null } };
}

function dispatch(frame: Frame, h: RunHandlers): RunOutcome | null {
  const json = (): unknown => {
    try {
      return frame.data ? JSON.parse(frame.data) : {};
    } catch {
      return {};
    }
  };
  switch (frame.event) {
    case 'meta': {
      const p = meta.safeParse(json());
      if (p.success) h.onMeta?.(p.data);
      return null;
    }
    case 'delta': {
      const p = delta.safeParse(json());
      if (p.success) h.onDelta?.(p.data.text);
      return null;
    }
    case 'heartbeat':
      h.onHeartbeat?.();
      return null;
    case 'fallback': {
      const p = fallback.safeParse(json());
      if (p.success) h.onFallback?.(p.data);
      return null;
    }
    case 'pending': {
      const p = pending.safeParse(json());
      if (p.success) {
        h.onPending?.(p.data);
        return { kind: 'pending', data: p.data };
      }
      return null;
    }
    case 'done': {
      const p = done.safeParse(json());
      if (p.success) {
        h.onDone?.(p.data);
        return { kind: 'done', data: p.data };
      }
      const e = errorEvent('INVALID_RESPONSE', 'Malformed done event');
      h.onError?.(e);
      return { kind: 'error', data: e };
    }
    case 'error': {
      const p = error.safeParse(json());
      const e: SseError = p.success ? p.data : errorEvent('INTERNAL', 'The run failed');
      h.onError?.(e);
      return { kind: 'error', data: e };
    }
    default:
      return null;
  }
}

async function openRun(body: RunInput, free: boolean, address: string | null, maxPriceUsd: MicroUsd | null, signal: AbortSignal): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  };
  try {
    // Handover: free messages go through the normal api() helper; no wallet is involved.
    if (free) return await apiRequest(RUN_PATH, init);
    // viem loads on the first paid run only.
    const { paidFetch } = await import('@/lib/monad/payments');
    return await paidFetch(RUN_PATH, init, address ?? '', maxPriceUsd);
  } catch (err) {
    if (isApiError(err)) throw err;
    const mapped = toPaymentError(err);
    if (mapped) throw mapped;
    // A fetch failure becomes NETWORK ("Could not reach SmartRouter" only if the device is offline;
    // otherwise its real message). Anything else thrown (Privy wallet, viem) keeps its own
    // message so it can be diagnosed.
    if (isFetchFailure(err)) throw errorFromFetchFailure(err);
    if (free) {
      console.error('[SmartRouter] free run failed before streaming', err);
      throw new ApiError({ status: 0, code: 'INTERNAL', message: err instanceof Error && err.message ? err.message : 'The run could not start.', details: err });
    }
    console.error('[SmartRouter] paid run failed in the payment client', err);
    const message = err instanceof Error && err.message ? err.message : 'The payment could not be completed.';
    throw new ApiError({ status: 0, code: 'PAYMENT_FAILED', message: `Payment failed: ${message.slice(0, 200)}`, details: err });
  }
}

/** `fetch` rejects with a TypeError ("Failed to fetch", "Load failed", "NetworkError…") or an AbortError. */
function isFetchFailure(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

/**
 * Start a run and stream events to `handlers`. Resolves with the outcome. Any event (including
 * heartbeat comments) resets the watchdog; silence for 60 s aborts with `TIMEOUT`.
 */
export async function runStream(body: RunInput, options: { free: boolean; address?: string | null; maxPriceUsd?: MicroUsd | null }, handlers: RunHandlers, signal?: AbortSignal): Promise<RunOutcome> {
  const controller = new AbortController();
  const onOuterAbort = () => {
    controller.abort();
  };
  signal?.addEventListener('abort', onOuterAbort);

  const watchdog: { id: number | null } = { id: null };
  const state = { timedOut: false };
  const kick = () => {
    if (watchdog.id !== null) window.clearTimeout(watchdog.id);
    watchdog.id = window.setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, WATCHDOG_MS);
  };

  try {
    const res = await openRun(body, options.free, options.address ?? null, options.maxPriceUsd ?? null, controller.signal);
    if (!res.ok) throw await errorFromResponse(res);
    const reader = res.body?.getReader();
    if (!reader) {
      const e = errorEvent('INVALID_RESPONSE', 'No stream body');
      handlers.onError?.(e);
      return { kind: 'error', data: e };
    }
    controller.signal.addEventListener('abort', () => {
      reader.cancel().catch(() => undefined);
    });
    const decoder = new TextDecoder();
    let buffer = '';
    kick();
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      kick();
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;
      for (const f of frames) {
        const outcome = dispatch(f, handlers);
        if (outcome) return outcome;
      }
    }
    if (state.timedOut) throw new DOMException('watchdog', 'AbortError');
    if (controller.signal.aborted) return { kind: 'aborted' };
    const tail = parseFrames(`${buffer}\n\n`);
    for (const f of tail.frames) {
      const outcome = dispatch(f, handlers);
      if (outcome) return outcome;
    }
    const e = errorEvent('STREAM_ENDED', 'The stream ended without a result');
    handlers.onError?.(e);
    return { kind: 'error', data: e };
  } catch (err) {
    if (state.timedOut) {
      const e = errorEvent('TIMEOUT', 'No heartbeat from SmartRouter for 60 s');
      handlers.onError?.(e);
      return { kind: 'error', data: e };
    }
    if (controller.signal.aborted || (err instanceof ApiError && err.code === 'ABORTED')) return { kind: 'aborted' };
    const e: SseError = {
      code: err instanceof ApiError ? err.code : 'NETWORK',
      message: err instanceof Error ? err.message : 'Run failed',
      refunded: true,
      refundedUsd: null,
      freeRerun: { available: !(err instanceof ApiError && err.code === 'FREE_LIMIT_REACHED'), modelId: null },
      ...(err instanceof ApiError ? { details: err.details, ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}) } : {}),
    };
    handlers.onError?.(e);
    return { kind: 'error', data: e };
  } finally {
    if (watchdog.id !== null) window.clearTimeout(watchdog.id);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export const ZERO_USD = micro(0);
