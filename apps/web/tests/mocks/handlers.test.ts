import { server } from './server';
import { mockWallet, resetMockState, state } from './state';

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

const SIG = `0x${'11'.repeat(65)}`;

/**
 * `POST /run` the way the app does on Monad: the first call answers 402 PAYMENT_REQUIRED with the
 * voucher to sign; the same request again with `X-SmartRouter-Voucher` streams.
 */
async function run(body: { quoteId: string | null | undefined; prompt: string }): Promise<Response> {
  const first = await json('POST', '/run', body);
  if (first.status !== 402) return first;
  const err = (await first.clone().json()) as { code: string; details: { voucher?: { message: { cumulativeAmount: string } } } };
  if (err.code !== 'PAYMENT_REQUIRED' || !err.details.voucher) return first;
  const header = btoa(JSON.stringify({ cumulativeAmount: err.details.voucher.message.cumulativeAmount, signature: SIG }));
  return fetch(`${API}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SmartRouter-Voucher': header }, body: JSON.stringify(body) });
}

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

describe('mock API (Monad contract)', () => {
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

  it('challenges a paid run with a voucher for exactly the price, then streams and charges the AI balance', async () => {
    const c = (await (await json('POST', '/chats', { description: 'Write a cover letter' })).json()) as { chatId: string; options: Opt[] };
    const paid = c.options.find((o) => !o.free);
    expect(paid).toBeDefined();
    const challenge = await json('POST', '/run', { quoteId: paid?.quoteId, prompt: 'Write a cover letter' });
    expect(challenge.status).toBe(402);
    const ch = (await challenge.json()) as { code: string; details: { voucher: { primaryType: string; domain: { chainId: number }; message: { cumulativeAmount: string } } } };
    expect(ch.code).toBe('PAYMENT_REQUIRED');
    expect(ch.details.voucher.primaryType).toBe('Voucher');
    expect(ch.details.voucher.domain.chainId).toBe(143);
    expect(ch.details.voucher.message.cumulativeAmount).toBe(String(Math.round((paid?.priceUsd ?? 0) * 1e6)));
    const res = await run({ quoteId: paid?.quoteId, prompt: 'Write a cover letter' });
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
    const s = (await (await json('GET', '/sessions/current')).json()) as { session: { remainingUsd: number; nextVoucherBaseMicro: string } | null; suggestedDepositUsd: number };
    // Suggested top-up: $1, or less if that's all that's left of a cap.
    expect(s.suggestedDepositUsd).toBe(1);
    expect(s.session?.remainingUsd).toBeCloseTo(2 - (paid?.priceUsd ?? 0), 6);
    expect(s.session?.nextVoucherBaseMicro).toBe(String(Math.round((paid?.priceUsd ?? 0) * 1e6)));
    const r = (await (await json('GET', `/requests/${requestId}`)).json()) as { status: string; priceUsd: number; charged: boolean };
    expect(r.status).toBe('succeeded');
    expect(r.priceUsd).toBe(paid?.priceUsd);
    expect(r.charged).toBe(true);
    // Same quote cannot be reused.
    expect((await run({ quoteId: paid?.quoteId, prompt: 'Write a cover letter' })).status).toBe(409);
  }, 15_000);

  it('rejects a changed prompt, missing setup, a short AI balance and the free limit with API codes', async () => {
    const c = (await (await json('POST', '/chats', { description: 'hello there' })).json()) as { chatId: string; options: Opt[] };
    const paid = c.options.find((o) => !o.free);
    const changed = await json('POST', '/run', { quoteId: paid?.quoteId, prompt: 'hello there!' });
    expect(changed.status).toBe(400);
    expect(((await changed.json()) as { code: string }).code).toBe('VALIDATION_FAILED');

    mockWallet.setupDone = false;
    const setup = await json('POST', '/run', { quoteId: paid?.quoteId, prompt: 'hello there' });
    expect(setup.status).toBe(409);
    const sb = (await setup.json()) as { code: string; details: { setup: { primaryType: string } } };
    expect(sb.code).toBe('SETUP_REQUIRED');
    expect(sb.details.setup.primaryType).toBe('Setup');

    resetMockState({ session: { channelId: 'ch', depositUsd: 2, spentUsd: 2, remainingUsd: 0, requests: 3, status: 'open', openedAt: new Date().toISOString() }, freeUsed: 30 });
    const c2 = (await (await json('POST', '/chats', { description: 'hello there' })).json()) as { chatId: string; options: Opt[] };
    const paid2 = c2.options.find((o) => !o.free);
    const exhausted = await json('POST', '/run', { quoteId: paid2?.quoteId, prompt: 'hello there' });
    expect(exhausted.status).toBe(402);
    const body = (await exhausted.json()) as { code: string; details: { shortfallUsd: number; freeFallback: { available: boolean } } };
    expect(body.code).toBe('ALLOCATION_EXHAUSTED');
    expect(body.details.shortfallUsd).toBe(paid2?.priceUsd);
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
    const ev1 = await readSse(await run({ quoteId: q1.quoteId, prompt: '[fallback] explain tempo' }));
    expect(ev1.some((e) => e.event === 'fallback')).toBe(true);
    expect(ev1.at(-1)?.event).toBe('done');

    const q2 = await quote('[fail] explain tempo');
    const ev2 = await readSse(await run({ quoteId: q2.quoteId, prompt: '[fail] explain tempo' }));
    const err = ev2.at(-1);
    expect(err?.event).toBe('error');
    expect((err?.data as { refunded: boolean; freeRerun: { available: boolean } }).refunded).toBe(true);

    const q3 = await quote('[pending] a poster of lagos');
    const ev3 = await readSse(await run({ quoteId: q3.quoteId, prompt: '[pending] a poster of lagos' }));
    const pending = ev3.at(-1);
    expect(pending?.event).toBe('pending');
    const { pollUrl } = pending?.data as { pollUrl: string };
    let last: { status: string; files: unknown[] } = { status: '', files: [] };
    for (let i = 0; i < 3; i += 1) last = (await (await json('GET', pollUrl)).json()) as { status: string; files: unknown[] };
    expect(last.status).toBe('succeeded');
    expect(last.files).toHaveLength(1);
  }, 20_000);

  it('settings, feedback, compare votes and waitlist validate their bodies', async () => {
    const me = (await (await json('PATCH', '/me/settings', { dailyLimitUsd: 5, autoFreeFallback: false })).json()) as { dailyLimitUsd: number; autoFreeFallback: boolean; vaultSetupNeeded: boolean };
    expect(me.dailyLimitUsd).toBe(5);
    expect(me.vaultSetupNeeded).toBe(true);
    expect(me.autoFreeFallback).toBe(false);
    expect((await json('POST', '/feedback', { requestId: 'req_0001', rating: 1 })).status).toBe(200);
    expect((await json('POST', '/feedback', { requestId: 'req_0001', rating: 2 })).status).toBe(400);
    expect((await json('POST', '/compare/vote', { compareGroup: 'cg', winnerRequestId: 'req_0001', prompt: 'x' })).status).toBe(204);
    expect((await json('POST', '/waitlist', { email: 'ada@example.com', interest: 'naira', country: 'NG' })).status).toBe(201);
    expect((await json('POST', '/waitlist', { email: 'nope', interest: 'naira' })).status).toBe(400);
  });

  it('moves USDC into the AI balance and sends with signed authorizations', async () => {
    const auth = (await (await json('POST', '/wallet/deposit/authorization', { amountUsd: 0.5 })).json()) as { primaryType: string; message: Record<string, string> };
    expect(auth.primaryType).toBe('ReceiveWithAuthorization');
    expect(auth.message.value).toBe('500000');
    const dep = (await (await json('POST', '/wallet/deposit', { ...auth.message, signature: SIG })).json()) as { ok: boolean; ai: { remainingUsd: number } };
    expect(dep.ok).toBe(true);
    expect(dep.ai.remainingUsd).toBeCloseTo(2.5, 6);
    expect(mockWallet.balanceUsd).toBeCloseTo(12, 6);

    const to = '0x000000000000000000000000000000000000dead';
    const plan = (await (await json('POST', '/wallet/send', { chain: 'monad', token: 'USDC', to, amountUsd: 1 })).json()) as { sendId: string; typedData: { primaryType: string; message: Record<string, string> } };
    expect(plan.typedData.primaryType).toBe('TransferWithAuthorization');
    expect(plan.typedData.message.to).toBe(to);
    const sent = (await (await json('POST', `/wallet/send/${plan.sendId}/sign`, { signature: SIG })).json()) as { status: string; txHash: string };
    expect(sent.status).toBe('completed');
    expect(sent.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(mockWallet.balanceUsd).toBeCloseTo(11, 6);
    const activity = (await (await json('GET', '/wallet/activity')).json()) as { items: { type: string }[] };
    expect(activity.items.map((i) => i.type)).toEqual(['send', 'to_ai_balance']);
  });
});
