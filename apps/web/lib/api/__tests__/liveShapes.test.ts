/**
 * Payloads from the live API parsed with the frontend schemas. Public routes (catalogue, recommend)
 * were captured from smartrouter-testnet on 11 Oct 2026 and are unchanged on smartrouter-mon;
 * signed-in Monad payloads (`/sessions/current`, settings) follow the Monad backend routes
 * (`apps/api/src/routes/run.ts`, `auth.ts`). If the backend changes a shape, this is the test that
 * should fail first.
 */
import {
  catalogSchema,
  chatHistorySchema,
  chatListSchema,
  createChatResponseSchema,
  freeFallbackSchema,
  quoteSchema,
  recommendResponseSchema,
  requestListSchema,
  requestSchema,
  sessionsCurrentSchema,
  settingsSchema,
  userSchema,
} from '../types';

const DEPOSIT = { channelId: '0x490b', depositUsd: 2, spentUsd: 0.0018, remainingUsd: 1.9982, usedPct: 0 };

describe('live API shapes', () => {
  it('GET /me (nested settings, usage, allocation object)', () => {
    const me = userSchema.parse({
      id: 'u1',
      address: '0x7b7123cf531199d6bf4781c23ddcd965b011b9c2',
      email: null,
      loginMethod: 'wallet',
      country: null,
      usage: { weekly: { spentUsd: 0.0018, limitUsd: 10, usedPct: 0 }, deposit: DEPOSIT, alert: null },
      settings: { slider: 'balanced', dailyLimitUsd: 2, weeklyLimitUsd: 10, autoFreeFallback: true },
      allocation: { channelId: '0x490b', depositUsd: 2, usedUsd: 0.0018, remainingUsd: 1.9982 },
    });
    expect(me.address).toBe('0x7b7123cf531199d6bf4781c23ddcd965b011b9c2');
    expect(me.dailyLimitUsd).toBe(2_000_000);
    expect(me.weeklyLimitUsd).toBe(10_000_000);
    expect(me.autoFreeFallback).toBe(true);
    expect(me.usage?.deposit?.remainingUsd).toBe(1_998_200);
    expect(me.usage?.weekly?.spentUsd).toBe(1_800);
    // No session yet: allocation null must not break parsing.
    expect(userSchema.parse({ address: '0xabc', usage: { weekly: { spentUsd: 0, limitUsd: 10, usedPct: 0 }, deposit: null, alert: null }, settings: { slider: 'best', dailyLimitUsd: 3, weeklyLimitUsd: 10, autoFreeFallback: false }, allocation: null }).slider).toBe('best');
  });

  it('PATCH /me/settings answers with the settings only', () => {
    expect(settingsSchema.parse({ slider: 'balanced', dailyLimitUsd: 3, weeklyLimitUsd: 10, autoFreeFallback: true, country: null, vaultSetupNeeded: true }).dailyLimitUsd).toBe(3_000_000);
  });

  it('GET /sessions/current with and without a session', () => {
    const none = sessionsCurrentSchema.parse({
      paidRunsEnabled: true,
      network: { chainId: 143, name: 'Monad', token: '0x754704bc059f8c67012fed69bc8a327a5aafb603', vault: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c', ledger: '0xdc28d25a044da278ae82cbf91cdf1c5997aa2163', operator: '0x61eB118FDb951cD9982a7fc6fA4132a31cF9c1a3', explorer: 'https://monadscan.com' },
      suggestedDepositUsd: 3,
      usage: { weekly: { spentUsd: 0, limitUsd: 10, usedPct: 0 }, deposit: null, alert: null },
      session: null,
    });
    expect(none.session).toBeNull();
    expect(none.suggestedDepositUsd).toBe(3_000_000);
    expect(none.network?.token).toBe('0x754704bc059f8c67012fed69bc8a327a5aafb603');
    expect(none.network?.vault).toBe('0x88191be828c5ce6bda1c7796fb32450a10c3e54c');
    const open = sessionsCurrentSchema.parse({
      paidRunsEnabled: true,
      network: { chainId: 143, name: 'Monad', token: '0x754704bc059f8c67012fed69bc8a327a5aafb603', vault: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c', ledger: null, operator: '0x61eB118FDb951cD9982a7fc6fA4132a31cF9c1a3', explorer: 'https://monadscan.com' },
      suggestedDepositUsd: 2,
      usage: { weekly: { spentUsd: 0.0018, limitUsd: 10, usedPct: 0 }, deposit: DEPOSIT, alert: null },
      session: { channelId: '0x490b', depositUsd: 2, spentUsd: 0.0018, remainingUsd: 1.9982, settledUsd: 0, deliveredUsd: 0.0018, nextVoucherBaseMicro: '1800', setupDone: true, signer: '0x00000000000000000000000000000000000000b2', signerExpiresAt: '2026-10-21T00:00:00.000Z', withdrawRequestedUntil: null, lastSettleTx: null, lastUsedAt: '2026-10-11T15:48:26.175Z' },
    });
    expect(open.session?.remainingUsd).toBe(1_998_200);
    expect(open.session?.nextVoucherBaseMicro).toBe('1800');
    expect(open.session?.setupDone).toBe(true);
  });

  it('GET /catalog (priceEstimateUsd, quality per task, medianLatencyMs)', () => {
    const list = catalogSchema.parse({
      models: [
        { id: 'free:llama-3.1-8b', label: 'Free · Llama 3.1 8B', provider: 'cloudflare', taskTypes: ['chat', 'writing'], free: true, web: false, priceEstimateUsd: 0, medianLatencyMs: 1500, quality: { chat: 0.229, writing: 0.173 } },
        { id: 'anthropic:claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Anthropic)', provider: 'anthropic', taskTypes: ['chat'], free: false, web: false, priceEstimateUsd: 0.0087, medianLatencyMs: 4000, quality: { chat: 0.861, coding: 0.923 } },
      ],
    });
    expect(list[1]?.priceUsd).toBe(8_700);
    expect(list[1]?.quality).toBe(0.923);
    expect(list[1]?.speed).toBe('slow');
    expect(list[0]?.free).toBe(true);
  });

  it('POST /chats and POST /recommend options', () => {
    const created = createChatResponseSchema.parse({
      chatId: 'd4aa', taskType: 'writing', complexity: 'short', classifiedBy: 'rules', slider: 'balanced',
      options: [
        { quoteId: '2618', modelId: 'openrouter:z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', provider: 'openrouter', priceUsd: 0.0018, priceSource: 'quote', speed: 'Fast', reason: '80% of the best quality at 1/34 of the price', free: false, score: 0.761 },
        { quoteId: '5df0', modelId: 'free:llama-3.1-8b', label: 'Free · Llama 3.1 8B', provider: 'cloudflare', priceUsd: 0, priceSource: 'free', speed: 'Fast', reason: 'Free · 30 messages left today', free: true },
      ],
      freeRemainingToday: 30,
    });
    expect(created.options[0]?.speed).toBe('fast');
    expect(created.options[0]?.priceUsd).toBe(1_800);
    expect(created.freeRemainingToday).toBe(30);
    const rec = recommendResponseSchema.parse({ taskType: 'writing', complexity: 'short', classifiedBy: 'rules', options: [{ quoteId: null, modelId: 'm', label: 'M', provider: 'p', priceUsd: 0.0008, priceSource: 'estimate', speed: 'Fast', reason: 'r', free: false, score: 0.7 }] });
    expect(rec.options[0]?.quoteId).toBeNull();
  });

  it('GET /chats, GET /chats/:id (chat + messages + hasMore) and the quote', () => {
    const list = chatListSchema.parse({ chats: [{ id: 'c1', title: null, taskType: 'writing', currentModelId: 'm', messageCount: 0, lastMessageAt: '2026-10-11T15:45:47.799Z', spentUsd: 0 }], nextCursor: null });
    expect(list.chats[0]?.updatedAt).toBe('2026-10-11T15:45:47.799Z');
    const hist = chatHistorySchema.parse({
      chat: { id: 'c1', title: 'Probe', taskType: 'writing', slider: 'balanced', currentModelId: 'free:llama-3.1-8b', messageCount: 2, spentUsd: 0, createdAt: '2026-10-11T15:45:47.799Z' },
      messages: [
        { id: 'u', seq: 1, role: 'user', content: 'Write it', modelId: null, resultRef: null, attachments: null, status: 'done', createdAt: '2026-10-11T15:45:49.730Z' },
        { id: 'a', seq: 2, role: 'assistant', content: 'Dear Hiring Manager', modelId: 'free:llama-3.1-8b', resultRef: 'https://media.example/x.png', attachments: null, status: 'done', createdAt: '2026-10-11T15:45:49.730Z' },
      ],
      hasMore: false,
    });
    expect(hist.id).toBe('c1');
    expect(hist.messages[1]?.text).toBe('Dear Hiring Manager');
    expect(hist.messages[1]?.files[0]?.mime).toBe('image/png');
    const q = quoteSchema.parse({ quoteId: 'q', modelId: 'm', label: 'GLM', taskType: 'writing', free: false, priceUsd: 0.0018, priceSource: 'quote', contextTokens: 62, expiresAt: '2026-10-11T15:50:48.726Z' });
    expect(q.priceUsd).toBe(1_800);
    expect(q.suggestion).toBeNull();
  });

  it('GET /requests (priceUsd + charged boolean, errorCode)', () => {
    const r = requestSchema.parse({ id: 'r1', status: 'succeeded', chatId: 'c', modelId: 'm', taskType: 'chat', free: false, priceUsd: 0.0018, charged: true, text: 'Mock', files: [], citations: [], fallbackReason: null, errorCode: null, compareGroup: null, latencyMs: 442, createdAt: '2026-10-11T15:48:25.728Z', finishedAt: '2026-10-11T15:48:26.171Z' });
    expect(r.requestId).toBe('r1');
    expect(r.chargedUsd).toBe(1_800);
    expect(r.refundedUsd).toBeNull();
    const failed = requestSchema.parse({ id: 'r2', status: 'failed', modelId: 'm', free: false, priceUsd: 0.0018, charged: false, errorCode: 'PROVIDER_UNAVAILABLE' });
    expect(failed.chargedUsd).toBe(0);
    expect(failed.refundedUsd).toBe(1_800);
    expect(failed.error).toBe('PROVIDER_UNAVAILABLE');
    expect(requestListSchema.parse({ requests: [], nextCursor: null }).requests).toEqual([]);
  });

  it('402 PAYMENT_REQUIRED details.freeFallback', () => {
    const f = freeFallbackSchema.parse({ available: true, modelId: 'free:llama-3.1-8b', freeRemainingToday: 30, auto: true });
    expect(f.remaining).toBe(30);
    expect(f.auto).toBe(true);
  });
});
