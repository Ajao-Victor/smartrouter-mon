import { z } from 'zod';

import { clearSessionToken, getSessionToken, registerAuthBridge, setSessionToken } from '@/lib/auth/session';

import { ApiError, apiFetch, isApiError } from './client';

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearSessionToken();
  registerAuthBridge(null);
});

describe('apiFetch (PDF "Data fetching")', () => {
  it('sends credentials and a JSON body straight to the API base URL (no /api prefix, no rewrite)', async () => {
    const spy = mockFetch(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await apiFetch('/me/settings', { method: 'PATCH', body: { slider: 'cheapest' } });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/me/settings');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('PATCH');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('X-Session-Token')).toBe(false);
    expect(init.body).toBe(JSON.stringify({ slider: 'cheapest' }));
  });

  it('sends X-Session-Token on every call once signed in (Brave/Safari block the cookie)', async () => {
    setSessionToken('user_1.123.sig', null);
    const spy = mockFetch(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await apiFetch('/me');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-Session-Token')).toBe('user_1.123.sig');
    expect(init.credentials).toBe('include');
  });

  it('any 401 drops the token and opens the sign-in modal', async () => {
    setSessionToken('expired', null);
    const openSignIn = vi.fn();
    registerAuthBridge({ openSignIn, logoutPrivy: () => Promise.resolve() });
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Session expired' }), { status: 401 })));
    await expect(apiFetch('/chats')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(getSessionToken()).toBeNull();
    expect(openSignIn).toHaveBeenCalledTimes(1);
  });

  it('a 401 from /auth/privy is left to the sign-in flow (no modal loop)', async () => {
    const openSignIn = vi.fn();
    registerAuthBridge({ openSignIn, logoutPrivy: () => Promise.resolve() });
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Privy token rejected' }), { status: 401 })));
    await expect(apiFetch('/auth/privy', { method: 'POST', body: { identityToken: 'x' } })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(openSignIn).not.toHaveBeenCalled();
  });

  it('validates the response with a schema', async () => {
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ message: 'sign me' }), { status: 200 })));
    const data = await apiFetch('/auth/challenge', { schema: z.object({ message: z.string() }) });
    expect(data.message).toBe('sign me');
  });

  it('throws INVALID_RESPONSE when the schema fails', async () => {
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ nope: 1 }), { status: 200 })));
    await expect(apiFetch('/auth/challenge', { schema: z.object({ message: z.string() }) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('maps 429 to RATE_LIMITED with Retry-After', async () => {
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'slow down' }), { status: 429, headers: { 'Retry-After': '12' } })));
    const err = await apiFetch('/chats').catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    const apiErr = err as ApiError;
    expect(apiErr.code).toBe('RATE_LIMITED');
    expect(apiErr.retryAfter).toBe(12);
    expect(apiErr.message).toBe('slow down');
  });

  it('prefers the body code over the status and keeps details', async () => {
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ code: 'ALLOCATION_EXHAUSTED', message: 'used up', details: { freeFallback: { available: true } } }), { status: 402 })));
    await expect(apiFetch('/run')).rejects.toMatchObject({ code: 'ALLOCATION_EXHAUSTED', details: { freeFallback: { available: true } } });
  });

  it('falls back to the status when a response carries no code', async () => {
    for (const [status, code] of [
      [401, 'UNAUTHENTICATED'],
      [402, 'PAYMENT_REQUIRED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'QUOTE_USED'],
      [410, 'QUOTE_EXPIRED'],
      [503, 'PROVIDER_UNAVAILABLE'],
      [500, 'INTERNAL'],
    ] as const) {
      mockFetch(() => Promise.resolve(new Response('oops', { status })));
      await expect(apiFetch('/x')).rejects.toMatchObject({ code, status });
    }
  });

  it('maps network failures: "Could not reach" only when offline, else the real error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0, message: 'Request to SmartRouter failed: Failed to fetch' });
    expect(spy).toHaveBeenCalled();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'NETWORK', message: 'Could not reach SmartRouter. Check your connection.' });
    online.mockRestore();
    spy.mockRestore();
  });

  it('returns undefined for 204', async () => {
    mockFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(apiFetch('/feedback', { method: 'POST', body: {} })).resolves.toBeUndefined();
  });
});
