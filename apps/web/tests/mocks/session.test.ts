import { paidFetch } from '@/lib/monad/payments';

import { server } from './server';
import { mockWallet, resetMockState, state } from './state';

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

const json = (path: string, body: unknown) => fetch(`http://localhost:8787${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('mock-mode paid runs (Monad voucher challenge)', () => {
  it('answers the 402 voucher challenge once and streams', async () => {
    const chat = (await (await json('/chats', { description: 'Write a cover letter' })).json()) as { options: { quoteId: string; free: boolean; priceUsd: number }[] };
    const paid = chat.options.find((o) => !o.free);
    expect(paid).toBeDefined();
    const res = await paidFetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: paid?.quoteId, prompt: 'Write a cover letter' }) }, state.user.address);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.text();
    expect(mockWallet.voucherTotalMicro).toBe(BigInt(Math.round((paid?.priceUsd ?? 0) * 1e6)));
  });

  it('passes SETUP_REQUIRED through untouched', async () => {
    mockWallet.setupDone = false;
    const chat = (await (await json('/chats', { description: 'Write a cover letter' })).json()) as { options: { quoteId: string; free: boolean }[] };
    const paid = chat.options.find((o) => !o.free);
    const res = await paidFetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: paid?.quoteId, prompt: 'Write a cover letter' }) }, state.user.address);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('SETUP_REQUIRED');
  });
});
