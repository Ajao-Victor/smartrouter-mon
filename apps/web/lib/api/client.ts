import type { ZodType, ZodTypeDef } from 'zod';

import { API_ERROR_CODES, type ServerErrorCode } from '@/lib/api/types';
import { clearSessionToken, getSessionToken, openSignIn } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Error codes the UI switches on. The PDF: "Every error before a stream starts has one JSON
 * shape `{ code, message, details? }`. Map on `code`, not on the HTTP status or the message text."
 * Server codes are listed in `types.ts`; the rest are client-side conditions.
 */
export type ApiErrorCode =
  | ServerErrorCode
  | 'NETWORK'
  | 'ABORTED'
  | 'INVALID_RESPONSE'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_FAILED'
  | 'SPENDING_KEY_MISSING'
  | 'INSUFFICIENT_FUNDS'
  | 'SESSION_BUSY'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Seconds to wait before retrying (from `Retry-After`), when the API sends it. */
  readonly retryAfter: number | undefined;
  readonly details: unknown;

  constructor(args: { status: number; code: ApiErrorCode; message: string; retryAfter?: number | undefined; details?: unknown }) {
    super(args.message);
    this.name = 'ApiError';
    this.status = args.status;
    this.code = args.code;
    this.retryAfter = args.retryAfter;
    this.details = args.details;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<string>(API_ERROR_CODES);

/** Fallback only for responses that carry no `code` (proxies, platform errors). */
function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 402) return 'PAYMENT_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'QUOTE_USED';
  if (status === 410) return 'QUOTE_EXPIRED';
  if (status === 400 || status === 422) return 'VALIDATION_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'PROVIDER_UNAVAILABLE';
  if (status >= 500) return 'INTERNAL';
  return 'UNKNOWN';
}

interface ErrorBody {
  code?: string;
  message?: string;
  error?: string;
  details?: unknown;
}

function parseErrorBody(text: string): ErrorBody {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* non-JSON body */
  }
  return {};
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : undefined;
}

/** Turn a non-OK response into an `ApiError` keyed by the body's `code`. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const text = await response.text();
  const body = parseErrorBody(text);
  const code = body.code && KNOWN_CODES.has(body.code.toUpperCase()) ? (body.code.toUpperCase() as ApiErrorCode) : codeFromStatus(response.status);
  return new ApiError({
    status: response.status,
    code,
    message: body.message ?? body.error ?? `Request failed (${String(response.status)})`,
    retryAfter: parseRetryAfter(response.headers.get('Retry-After')),
    details: body.details ?? body,
  });
}

/** Wrap a thrown fetch failure (offline, CORS, abort) as an `ApiError`. */
export function errorFromFetchFailure(err: unknown): ApiError {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new ApiError({ status: 0, code: 'ABORTED', message: 'Request aborted' });
  }
  return new ApiError({ status: 0, code: 'NETWORK', message: 'Could not reach SmartRouter. Check your connection.', details: err });
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequestOptions<T> {
  method?: HttpMethod;
  /** JSON-serialisable body; sent as `application/json`. */
  body?: unknown;
  /** Validates and types the response. Invalid payloads throw `ApiError('INVALID_RESPONSE')`. */
  schema?: ZodType<T, ZodTypeDef, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export function apiUrl(path: string): string {
  return `${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The raw API helper from the handover ("Sign-in flow"): adds `X-Session-Token` when signed in,
 * JSON content type for bodies, `credentials: 'include'` (the cookie still works where the
 * browser allows it), and on any 401 drops the token and opens the sign-in modal. `/auth/*`
 * calls are excluded from the modal: the sign-in flow handles its own failures.
 *
 * The mppx session manager uses this too (`fetch: (url, init) => apiRequest(...)`), so paid
 * runs carry the session header.
 */
export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token) headers.set('X-Session-Token', token);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(apiUrl(path), { ...init, headers, credentials: 'include' });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    clearSessionToken();
    openSignIn();
  }
  return res;
}

/**
 * Typed JSON client on top of `apiRequest`: JSON in/out, errors mapped by `code`. The API is
 * called directly — never through a Vercel rewrite — so the backend sees the real client IP.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiRequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const init: RequestInit = {
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  };

  let response: Response;
  try {
    response = await apiRequest(path, init);
  } catch (err) {
    throw errorFromFetchFailure(err);
  }

  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new ApiError({ status: response.status, code: 'INVALID_RESPONSE', message: 'SmartRouter returned a non-JSON response.', details: err });
  }

  if (options.schema) {
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError({ status: response.status, code: 'INVALID_RESPONSE', message: 'SmartRouter returned an unexpected payload.', details: parsed.error.issues });
    }
    return parsed.data;
  }
  return data as T;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
