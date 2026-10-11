import { server } from './server';
import { resetMockState, state } from './state';

const API = 'http://localhost:8787';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  resetMockState();
});
afterAll(() => {
  server.close();
});

const json = (method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

async function readSse(res: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith(':')) return { event: 'heartbeat', data: null };
      const ev = /event: (.*)/.exec(block)?.[1] ?? '';
      const data = /data: (.*)/.exec(block)?.[1] ?? '{}';
      return { event: ev, data: JSON.parse(data) as unknown };
    });
}

interface Opt { modelId: string; quoteId: string | null; priceUsd: number; free: boolean; bestQuality: boolean; reason: string; expiresAt: string | null }

describe('mock API (live contract)', () => {
  it('signs in with POST /auth/privy and serves /me (settings nested, usage included)', async () => {
    resetMockState({ authed: false });
    expect((await json('GET', '/me')).status).toBe(401);
    expect((await json('POST', '/auth/privy', { identityToken: 'forged' })).status).toBe(401);
    const signIn = (await (await json('POST', '/auth/privy', { identityToken: 'privy-id-token' })).json()) as { address: string; token: string; email: string; loginMethod: string; expiresAt: string };
    expect(signIn.token).toBeTruthy();
    expect(signIn.address).toBe(state.user.address);
    expect(signIn.loginMethod).toBe('email');
    const me = (await (await json('GET', '/me')).json()) as { address: string; email: string; settings: { dailyLimitUsd: number }; usage: { alert: unknown } };
    expect(me.address).toBe(state.user.address);
    expect(me.email).toBe('demo@smartrouter.dev');
    expect(me.settings.dailyLimitUsd).toBe(2);
    expect(me.usage.alert).toBeNull();
  });

  it('POST /recommend works signed out: guest: true and no quotes', async () => {
    const res = (await (await json('POST', '/recommend', { prompt: 'Write a haiku' })).json()) as { guest: boolean; options: Opt[] };
    expect(res.guest).toBe(true);
    expect(res.options.every((o) => o.quoteId === null)).toBe(true);
  });

  it('POST /chats with a description returns quoted options: top 2 + best quality + free', async () => {
    const res = await json('POST', '/chats', { description: 'Write a cover letter for a payments engineer role' });
    expect(res.status).toBe(201);
    const c = (await res.json()) as { chatId: string; taskType: string; options: Opt[] };
    expect(c.taskType).toBe('writing');
    expect(c.options).toHaveLength(4);
    expect(c.options.filter((o) => o.free)).toHaveLength(1);
    expect(c.options.filter((o) => o.bestQuality)).toHaveLength(1);
    expect(c.options[0]?.reason).toMatch(/% of the best quality at 1\/\d+ of the price/);
    for (const o of c.options) {
      expect(o.quoteId).toMatch(/^q_/);
      expect(Date.parse(o.expiresAt ?? '') - Date.now()).toBeGreaterThan(4 * 60_000);
      expect(Math.round(o.priceUsd * 10_000)).toBe(o.priceUsd * 10_000);
    }
  });

  it('streams a paid run with meta/heartbeat/delta/done, charges the session and records the request', async () => {
    const c = (await (await json('POST', '/chats', { description: 'Write a cover letter' })).json()) as { chatId: string; options: Opt[] };
    const paid = c.options.find((o) => !o.free);
    expect(paid).toBeDefined();
    const res = await json('POST', '/run', { quoteId: paid?.quoteId, prompt: 'Write a cover letter' });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSse(res);
    expect(events[0]?.event).toBe('meta');
    expect(events.some((e) => e.event === 'heartbeat')).toBe(true);
    expect(events.some((e) => e.event === 'delta')).toBe(true);
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    const { requestId, chargedUsd } = done?.data as { requestId: string; chargedUsd: number };
    expect(chargedUsd).toBe(paid?.priceUsd);
    expect(state.session?.spentUsd).toBe(paid?.priceUsd);
    const s = (await (await json('GET', '/sessions/current')).json()) as { session: { remainingUsd: number } | null; suggestedDepositUsd: number };
    // The next automatic deposit: $1, or less if that's all that's left of a cap.
    expect(s.suggestedDepositUsd).toBe(1);
    expect(s.session?.remainingUsd).toBeCloseTo(1 - (paid?.priceUsd ?? 0), 6);
    const r = (await (await json('GET', `/requests/${requestId}`)).json()) as { status: string; priceUsd: number; charged: boolean };
    expect(r.status).toBe('succeeded');
    expect(r.priceUsd).toBe(paid?.priceUsd);
    expect(r.charged).toBe(true);
    // Same quote cannot be reused.
    expect((await json('POST', '/run', { quoteId: paid?.quoteId, prompt: 'Write a cover letter' })).status).toBe(409);
  }, 15_000);

  it('rejects a changed prompt, an exhausted allocation and the free limit with PDF codes', async () => {
    const c = (await (await json('POST', '/chats', { description: 'hello there' })).json()) as { chatId: string; options: Opt[] };
    const paid = c.options.find((o) => !o.free);
    const changed = await json('POST', '/run', { quoteId: paid?.quoteId, prompt: 'hello there!' });
    expect(changed.status).toBe(400);
    expect(((await changed.json()) as { code: string }).code).toBe('VALIDATION_FAILED');

    resetMockState({ session: { channelId: 'ch', depositUsd: 2, spentUsd: 2, remainingUsd: 0, requests: 3, status: 'open', openedAt: new Date().toISOString() }, freeUsed: 30 });
    const c2 = (await (await json('POST', '/chats', { description: 'hello there' })).json()) as { chatId: string; options: Opt[] };
    const paid2 = c2.options.find((o) => !o.free);
    const exhausted = await json('POST', '/run', { quoteId: paid2?.quoteId, prompt: 'hello there' });
    expect(exhausted.status).toBe(402);
    const body = (await exhausted.json()) as { code: string; details: { freeFallback: { available: boolean } } };
    expect(body.code).toBe('ALLOCATION_EXHAUSTED');
    expect(body.details.freeFallback.available).toBe(false);
    const free = c2.options.find((o) => o.free);
    const limited = await json('POST', '/run', { quoteId: free?.quoteId, prompt: 'hello there' });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe('FREE_LIMIT_REACHED');
  });

  it('runs the fallback, fail and pending scenarios', async () => {
    const c = (await (await json('POST', '/chats', { taskType: 'chat' })).json()) as { chatId: string };
    const quote = async (prompt: string) => (await (await json('POST', `/chats/${c.chatId}/quote`, { prompt })).json()) as { quoteId: string; priceUsd: number };

    const q1 = await quote('[fallback] explain tempo');
    const ev1 = await readSse(await json('POST', '/run', { quoteId: q1.quoteId, prompt: '[fallback] explain tempo' }));
    expect(ev1.some((e) => e.event === 'fallback')).toBe(true);
    expect(ev1.at(-1)?.event).toBe('done');

    const q2 = await quote('[fail] explain tempo');
    const ev2 = await readSse(await json('POST', '/run', { quoteId: q2.quoteId, prompt: '[fail] explain tempo' }));
    const err = ev2.at(-1);
    expect(err?.event).toBe('error');
    expect((err?.data as { refunded: boolean; freeRerun: { available: boolean } }).refunded).toBe(true);

    const q3 = await quote('[pending] a poster of lagos');
    const ev3 = await readSse(await json('POST', '/run', { quoteId: q3.quoteId, prompt: '[pending] a poster of lagos' }));
    const pending = ev3.at(-1);
    expect(pending?.event).toBe('pending');
    const { pollUrl } = pending?.data as { pollUrl: string };
    let last: { status: string; files: unknown[] } = { status: '', files: [] };
    for (let i = 0; i < 3; i += 1) last = (await (await json('GET', pollUrl)).json()) as { status: string; files: unknown[] };
    expect(last.status).toBe('succeeded');
    expect(last.files).toHaveLength(1);
  }, 20_000);

  it('settings, feedback, compare votes and waitlist validate their bodies', async () => {
    const me = (await (await json('PATCH', '/me/settings', { dailyLimitUsd: 5, autoFreeFallback: false })).json()) as { dailyLimitUsd: number; autoFreeFallback: boolean; spendingKeyLimitUsd: number };
    expect(me.dailyLimitUsd).toBe(5);
    expect(me.spendingKeyLimitUsd).toBe(6);
    expect(me.autoFreeFallback).toBe(false);
    expect((await json('POST', '/feedback', { requestId: 'req_0001', rating: 1 })).status).toBe(204);
    expect((await json('POST', '/feedback', { requestId: 'req_0001', rating: 2 })).status).toBe(400);
    expect((await json('POST', '/compare/vote', { compareGroup: 'cg', winnerRequestId: 'req_0001', prompt: 'x' })).status).toBe(204);
    expect((await json('POST', '/waitlist', { email: 'ada@example.com', interest: 'naira', country: 'NG' })).status).toBe(201);
    expect((await json('POST', '/waitlist', { email: 'nope', interest: 'naira' })).status).toBe(400);
  });
});
