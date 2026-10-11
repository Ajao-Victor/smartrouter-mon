/**
 * MSW handlers for the LIVE contract ("SmartRouter Frontend Handover", Oct 11 2026). Routes have no
 * `/api` prefix, money is USD decimals, errors are `{ code, message, details? }`, `/run` streams
 * SSE (`meta`, `delta`, heartbeat comments, `fallback`, `pending`, `done`, `error`).
 * Prompt hooks for demos: `[fallback]`, `[fail]`, `[pending]`, `[slow]`.
 */
import { delay, http, HttpResponse } from 'msw';

import type { SliderPreset, TaskType } from '@/lib/api/types';

import { FREE_MODEL_ID, SAMPLE_FILES, SAMPLE_REPLY, mockModels } from './fixtures';
import { sseStream, tokenize, type SseEvent } from './sse';
import {
  appendMessage,
  charge,
  classify,
  createChat,
  FREE_LIMIT,
  makeQuote,
  modelById,
  nextId,
  openSession,
  optionsFor,
  pollRequest,
  publicChat,
  publicRequest,
  recordRequest,
  state,
  dailySpentUsd,
  mockWallet,
  usage,
  weeklySpentUsd,
} from './state';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
const url = (p: string) => `${API}${p}`;

const error = (status: number, code: string, message: string, details?: unknown) => HttpResponse.json({ code, message, ...(details !== undefined ? { details } : {}) }, { status });
const guard = () => (state.authed ? null : error(401, 'UNAUTHENTICATED', 'Sign in to continue'));

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

const sliderOf = (v: unknown): SliderPreset => (v === 'cheapest' || v === 'best' ? v : 'balanced');


/** Live request record: `priceUsd` + `charged` boolean, `errorCode`, `finishedAt`. */
function liveRequest(r: ReturnType<typeof publicRequest>) {
  const { requestId, chargedUsd, refundedUsd, error, label: _label, txHash: _tx, ...rest } = r;
  return { id: requestId, ...rest, priceUsd: r.status === 'failed' ? (refundedUsd ?? 0) : chargedUsd, charged: r.status !== 'failed', errorCode: error, finishedAt: r.status === 'succeeded' || r.status === 'failed' ? r.createdAt : null };
}

export const handlers = [
  /* ---------------------------------- auth --------------------------------- */
  http.post(url('/auth/privy'), async ({ request }) => {
    const { identityToken } = await body<{ identityToken?: string }>(request);
    const token = identityToken ?? request.headers.get('privy-id-token');
    if (!token) return error(400, 'VALIDATION_FAILED', 'Send { identityToken } from Privy');
    if (token === 'forged') return error(401, 'UNAUTHENTICATED', 'Privy token rejected: invalid signature');
    await delay(200);
    state.authed = true;
    return HttpResponse.json(
      { userId: 'user_mock', address: state.user.address, email: 'demo@smartrouter.dev', loginMethod: 'email', token: 'user_mock.0.mocksig', expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString() },
      { headers: { 'Set-Cookie': 'sr_session=mock; Path=/; HttpOnly; SameSite=Lax' } },
    );
  }),
  http.post(url('/auth/logout'), () => {
    state.authed = false;
    return HttpResponse.json({ ok: true });
  }),

  /* ----------------------------------- me ---------------------------------- */
  http.get(url('/me'), () => {
    const g = guard();
    if (g) return g;
    const { address, ...settings } = state.user;
    return HttpResponse.json({ id: 'user_mock', address, email: 'demo@smartrouter.dev', loginMethod: 'email', country: null, usage: usage(), settings, freeRemainingToday: Math.max(0, FREE_LIMIT - state.freeUsed) });
  }),
  http.patch(url('/me/settings'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const patch = await body<{ slider?: SliderPreset; dailyLimitUsd?: number; weeklyLimitUsd?: number; autoFreeFallback?: boolean }>(request);
    const daily = patch.dailyLimitUsd ?? state.user.dailyLimitUsd;
    const weekly = patch.weeklyLimitUsd ?? state.user.weeklyLimitUsd;
    if (daily < 0 || weekly < 0 || weekly > 1000) return error(400, 'VALIDATION_FAILED', 'Caps must be $0–$1,000');
    if (daily > weekly) return error(400, 'VALIDATION_FAILED', "The daily cap can't exceed the weekly cap");
    if (patch.slider) state.user.slider = sliderOf(patch.slider);
    if (typeof patch.dailyLimitUsd === 'number') state.user.dailyLimitUsd = patch.dailyLimitUsd;
    if (typeof patch.weeklyLimitUsd === 'number') state.user.weeklyLimitUsd = patch.weeklyLimitUsd;
    if (typeof patch.autoFreeFallback === 'boolean') state.user.autoFreeFallback = patch.autoFreeFallback;
    const { address: _address, ...settings } = state.user;
    return HttpResponse.json({ ...settings, country: null, spendingKeyLimitUsd: state.user.dailyLimitUsd + 1 });
  }),

  /* -------------------------------- catalogue ------------------------------- */
  http.get(url('/catalog'), ({ request }) => {
    const task = new URL(request.url).searchParams.get('taskType');
    const list = mockModels.filter((m) => !task || m.taskTypes.includes(task as TaskType));
    return HttpResponse.json({
      // Live shape: `id`, `priceEstimateUsd`, `medianLatencyMs`, `quality` per task.
      models: list.map((m) => ({ id: m.modelId, label: m.label, provider: m.provider, taskTypes: m.taskTypes, free: m.free, web: false, priceEstimateUsd: m.priceUsd, medianLatencyMs: m.latency, quality: m.quality })),
    });
  }),
  // Works signed out (Handover "Guest mode"): `guest: true` and nothing to pay against (`quoteId: null`).
  http.post(url('/recommend'), async ({ request }) => {
    const guest = !request.headers.get('x-session-token') || !state.authed;
    const { prompt, slider, taskType } = await body<{ prompt?: string; slider?: SliderPreset; taskType?: TaskType }>(request);
    if (!prompt) return error(400, 'VALIDATION_FAILED', 'prompt is required');
    const task = taskType ?? classify(prompt);
    await delay(150);
    const options = optionsFor(task, sliderOf(slider ?? state.user.slider), prompt, null).map((o) => (guest ? { ...o, quoteId: null, expiresAt: null } : o));
    return HttpResponse.json({ taskType: task, options, freeRemainingToday: Math.max(0, FREE_LIMIT - state.freeUsed), guest });
  }),

  /* ---------------------------------- chats -------------------------------- */
  http.get(url('/chats'), () => {
    const g = guard();
    if (g) return g;
    const chats = [...state.chats.values()].filter((c) => !c.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicChat);
    return HttpResponse.json({ chats, nextCursor: null });
  }),
  http.post(url('/chats'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const input = await body<{ taskType?: TaskType; description?: string; slider?: SliderPreset }>(request);
    const chat = createChat(input);
    await delay(150);
    const options = input.description ? optionsFor(chat.taskType, sliderOf(input.slider ?? state.user.slider), input.description, chat.id) : [];
    return HttpResponse.json({ chatId: chat.id, taskType: chat.taskType, title: chat.title, options, freeRemainingToday: Math.max(0, FREE_LIMIT - state.freeUsed) }, { status: 201 });
  }),
  http.get(url('/chats/:id'), ({ params }) => {
    const g = guard();
    if (g) return g;
    const chat = state.chats.get(String(params.id));
    if (!chat || chat.archived) return error(404, 'NOT_FOUND', 'Chat not found');
    // Live shape: `{ chat, messages: [{ id, seq, role, content, modelId, resultRef, attachments, status, createdAt }], hasMore }`.
    return HttpResponse.json({ chat: publicChat(chat), messages: chat.messages.map((m, i) => ({ id: m.id, seq: i + 1, role: m.role, content: m.text, modelId: m.modelId, resultRef: m.files[0]?.url ?? null, attachments: null, status: m.status, createdAt: m.createdAt })), hasMore: false });
  }),
  http.patch(url('/chats/:id'), async ({ params, request }) => {
    const g = guard();
    if (g) return g;
    const chat = state.chats.get(String(params.id));
    if (!chat) return error(404, 'NOT_FOUND', 'Chat not found');
    const patch = await body<{ title?: string; slider?: SliderPreset; currentModelId?: string }>(request);
    if (patch.title !== undefined) chat.title = patch.title;
    if (patch.slider) chat.slider = sliderOf(patch.slider);
    if (patch.currentModelId) chat.currentModelId = patch.currentModelId;
    return HttpResponse.json(publicChat(chat));
  }),
  http.delete(url('/chats/:id'), ({ params }) => {
    const g = guard();
    if (g) return g;
    const chat = state.chats.get(String(params.id));
    if (!chat) return error(404, 'NOT_FOUND', 'Chat not found');
    chat.archived = true;
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(url('/chats/:id/quote'), async ({ params, request }) => {
    const g = guard();
    if (g) return g;
    const chat = state.chats.get(String(params.id));
    if (!chat) return error(404, 'NOT_FOUND', 'Chat not found');
    const { prompt, modelId } = await body<{ prompt?: string; modelId?: string }>(request);
    if (!prompt) return error(400, 'VALIDATION_FAILED', 'prompt is required');
    const task = classify(prompt);
    const options = optionsFor(chat.taskType, sliderOf(chat.slider ?? state.user.slider), prompt, null);
    const chosen = modelId ?? chat.currentModelId ?? options[0]?.modelId ?? FREE_MODEL_ID;
    if (!modelById(chosen)) return error(404, 'NOT_FOUND', 'Unknown model');
    await delay(120);
    const q = makeQuote(chat.id, chosen, prompt);
    const suggestion = task !== chat.taskType && (task === 'image' || task === 'music' || task === 'research') ? { modelId: optionsFor(task, 'balanced', prompt, null)[0]?.modelId ?? chosen, taskType: task, reason: `looks like ${task}` } : null;
    return HttpResponse.json({ quoteId: q.quoteId, priceUsd: q.priceUsd, free: q.free, expiresAt: q.expiresAt, modelId: q.modelId, label: modelById(chosen)?.label ?? chosen, suggestion });
  }),

  /* --------------------------------- sessions ------------------------------- */
  http.get(url('/sessions/current'), () => {
    const g = guard();
    if (g) return g;
    const s = state.session;
    return HttpResponse.json({
      paidRunsEnabled: true,
      network: { chainId: 42431, token: '0x20c0000000000000000000000000000000000000', recipient: '0x00000000000000000000000000000000000000aa', operator: '0x00000000000000000000000000000000000000bb' },
      suggestedDepositUsd: usage().nextDepositUsd,
      usage: usage(),
      session: s ? { channelId: s.channelId, depositUsd: s.depositUsd, spentUsd: s.spentUsd, remainingUsd: s.remainingUsd, settledUsd: 0, requests: s.requests, openedAt: s.openedAt, lastUsedAt: s.openedAt } : null,
    });
  }),

  /* ---------------------------------- wallet -------------------------------- */
  http.get(url('/wallet'), () => {
    const g = guard();
    if (g) return g;
    const s = state.session && state.session.status === 'open' ? state.session : null;
    const locked = s ? { depositUsd: s.depositUsd, spentUsd: s.spentUsd, remainingUsd: s.remainingUsd } : null;
    return HttpResponse.json({
      address: state.user.address,
      network: { chainId: 42431, name: 'Tempo Testnet (Moderato)' },
      token: { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD', decimals: 6 },
      main: { balanceUsd: mockWallet.balanceUsd },
      ai: locked,
      locked,
      caps: usage(),
      spendingKey: mockWallet.spendingKey
        ? { status: 'active', address: mockWallet.spendingKey, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), setup: { token: '0x20c0000000000000000000000000000000000000', limitUsd: state.user.dailyLimitUsd + 1, periodSeconds: 86_400, expiryDays: 7, scopes: [{ address: '0x4d50500000000000000000000000000000000000' }] } }
        : { status: 'missing', setup: { token: '0x20c0000000000000000000000000000000000000', limitUsd: state.user.dailyLimitUsd + 1, periodSeconds: 86_400, expiryDays: 7, scopes: [{ address: '0x4d50500000000000000000000000000000000000' }] } },
      incomingUsd: 0,
      networkFees: { paidBy: 'smartrouter', sponsoredPerDay: 20, usedToday: 0, relayUrl: '/relay' },
      features: { crossChain: false, card: false, cashOut: false },
    });
  }),
  http.get(url('/wallet/options'), () =>
    HttpResponse.json({ deposit: [{ chain: 'tempo', chainId: 42431, chainName: 'Tempo Testnet (Moderato)', vmType: 'evm', token: 'pathUSD', depositAvailable: true, method: 'direct' }], send: [{ chain: 'tempo', chainId: 42431, chainName: 'Tempo Testnet (Moderato)', vmType: 'evm', token: 'pathUSD', method: 'direct' }], card: null, cashOut: null }),
  ),
  http.get(url('/wallet/activity'), () => guard() ?? HttpResponse.json({ items: [], nextBefore: null })),
  http.post(url('/wallet/deposit-address'), () => guard() ?? HttpResponse.json({ chain: 'tempo', token: 'pathUSD', address: state.user.address, method: 'direct' })),
  http.post(url('/wallet/spending-key'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const { accessKeyAddress } = await body<{ accessKeyAddress?: string }>(request);
    mockWallet.spendingKey = accessKeyAddress ?? null;
    return HttpResponse.json({ status: 'active', address: accessKeyAddress, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  }),
  http.post(url('/wallet/locked/return'), () => {
    const g = guard();
    if (g) return g;
    const s = state.session;
    const returned = s ? s.remainingUsd : 0;
    if (s) s.status = 'closed';
    state.session = null;
    mockWallet.balanceUsd = Math.round((mockWallet.balanceUsd + returned) * 1e6) / 1e6;
    return HttpResponse.json({ returnedUsd: returned, skipped: [] });
  }),
  http.post(url('/wallet/send/quote'), async ({ request }) => {
    const { amountUsd } = await body<{ amountUsd?: number }>(request);
    return HttpResponse.json({ sendUsd: amountUsd ?? 0, receiveUsd: amountUsd ?? 0, bridgeFeeUsd: 0, networkFeeUsd: 0, etaSeconds: 1 });
  }),
  http.post(url('/wallet/send'), async ({ request }) => {
    const { amountUsd } = await body<{ amountUsd?: number }>(request);
    if ((amountUsd ?? 0) > mockWallet.balanceUsd) return error(400, 'VALIDATION_FAILED', `Not enough in your main wallet ($${mockWallet.balanceUsd.toFixed(2)})`);
    mockWallet.balanceUsd = Math.round((mockWallet.balanceUsd - (amountUsd ?? 0)) * 1e6) / 1e6;
    return HttpResponse.json({ sendId: nextId('send'), chainId: 42431, calls: [], feePayer: true });
  }),
  http.post(url('/wallet/send/:id/submitted'), ({ params }) => HttpResponse.json({ sendId: String(params.id), status: 'completed' })),

  /* --------------------------------- requests ------------------------------- */
  http.get(url('/requests'), () => {
    const g = guard();
    if (g) return g;
    const requests = [...state.requests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(liveRequest);
    return HttpResponse.json({ requests, nextCursor: null });
  }),
  http.get(url('/requests/:id'), ({ params }) => {
    const g = guard();
    if (g) return g;
    const r = pollRequest(String(params.id));
    if (!r) return error(404, 'NOT_FOUND', 'Request not found');
    return HttpResponse.json(liveRequest(r));
  }),

  /* -------------------------------- feedback -------------------------------- */
  http.post(url('/feedback'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const { requestId, rating } = await body<{ requestId?: string; rating?: number }>(request);
    if (!requestId || (rating !== 1 && rating !== -1)) return error(400, 'VALIDATION_FAILED', 'requestId and rating (1 | -1) are required');
    state.feedback.push({ requestId, rating });
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(url('/compare/vote'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const { compareGroup, winnerRequestId } = await body<{ compareGroup?: string; winnerRequestId?: string }>(request);
    if (!compareGroup || !winnerRequestId) return error(400, 'VALIDATION_FAILED', 'compareGroup and winnerRequestId are required');
    state.votes.push({ compareGroup, winnerRequestId });
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(url('/waitlist'), async ({ request }) => {
    const input = await body<{ email?: string; interest?: string; country?: string }>(request);
    if (!input.email || !/.+@.+\..+/.test(input.email) || !input.interest) return error(400, 'VALIDATION_FAILED', 'email and interest are required');
    state.waitlist.push({ email: input.email, interest: input.interest, ...(input.country ? { country: input.country } : {}) });
    return HttpResponse.json({ ok: true }, { status: 201 });
  }),

  /* ----------------------------------- run ---------------------------------- */
  http.post(url('/run'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const { quoteId, prompt, compareGroup } = await body<{ quoteId?: string; prompt?: string; compareGroup?: string }>(request);
    if (!quoteId || !prompt) return error(400, 'VALIDATION_FAILED', 'quoteId and prompt are required');
    const quote = state.quotes.get(quoteId);
    if (!quote) return error(404, 'NOT_FOUND', 'Quote not found');
    if (quote.used) return error(409, 'QUOTE_USED', 'This quote was already used');
    if (Date.parse(quote.expiresAt) <= Date.now()) return error(410, 'QUOTE_EXPIRED', 'Quote expired — ask for a new one');
    if (quote.prompt !== prompt) return error(400, 'VALIDATION_FAILED', 'The prompt differs from the quoted prompt');
    const chat = state.chats.get(quote.chatId);
    if (!chat) return error(404, 'NOT_FOUND', 'Chat not found');
    const model = modelById(quote.modelId);
    if (!model) return error(404, 'NOT_FOUND', 'Unknown model');

    if (quote.free) {
      if (state.freeUsed >= FREE_LIMIT) return error(429, 'FREE_LIMIT_REACHED', 'Free messages reset at 00:00 UTC', { scope: 'user' });
    } else {
      const fallback = { available: state.freeUsed < FREE_LIMIT, modelId: FREE_MODEL_ID, freeRemainingToday: Math.max(0, FREE_LIMIT - state.freeUsed) };
      if (dailySpentUsd() + quote.priceUsd > state.user.dailyLimitUsd) {
        return error(403, 'SPENDING_CAP_REACHED', "You've reached today's spending cap. Raise it in settings or continue free.", { reason: 'daily_limit', freeFallback: fallback });
      }
      if (weeklySpentUsd() + quote.priceUsd > state.user.weeklyLimitUsd) {
        return error(403, 'SPENDING_CAP_REACHED', "You've reached this week's spending cap. Raise it in settings or continue free.", { reason: 'weekly_limit', freeFallback: fallback });
      }
      if (!state.session || state.session.status === 'closed') openSession(Math.max(0.01, usage().nextDepositUsd));
      const s = state.session;
      if (s && s.remainingUsd < quote.priceUsd) {
        return error(402, 'ALLOCATION_EXHAUSTED', 'Your allocation is used up', { freeFallback: { available: state.freeUsed < FREE_LIMIT, remaining: Math.max(0, FREE_LIMIT - state.freeUsed), modelId: FREE_MODEL_ID } });
      }
    }

    quote.used = true;
    const task = model.taskTypes.includes(chat.taskType) ? chat.taskType : (model.taskTypes[0] ?? 'chat');
    const userMsg = appendMessage(chat.id, { role: 'user', text: prompt, modelId: null, requestId: null, chargedUsd: null, files: [], status: 'done' });
    const requestId = nextId('req');
    const asstMsg = appendMessage(chat.id, { role: 'assistant', text: '', modelId: model.modelId, requestId, chargedUsd: null, files: [], status: 'done' });
    chat.currentModelId = model.modelId;
    if (quote.free) state.freeUsed += 1;

    const fail = /\[fail\]/i.test(prompt);
    const fallback = /\[fallback\]/i.test(prompt) && !quote.free;
    const pending = /\[pending\]/i.test(prompt) || task === 'music';
    const speed = /\[slow\]/i.test(prompt) ? 0.25 : 1;
    const started = Date.now();

    const events: SseEvent[] = [
      { event: 'meta', data: { requestId, modelId: model.modelId, label: model.label, priceUsd: quote.priceUsd, free: quote.free, chatId: chat.id, userMessageId: userMsg.id, assistantMessageId: asstMsg.id, ...(quote.free ? {} : { remainingUsd: state.session?.remainingUsd ?? null, usage: usage() }) }, delay: 120 },
      { event: 'heartbeat', data: null, delay: 200 },
    ];

    if (fail) {
      asstMsg.status = 'error';
      recordRequest({ requestId, status: 'failed', modelId: model.modelId, label: model.label, chatId: chat.id, chargedUsd: 0, refundedUsd: quote.priceUsd, latencyMs: null, text: null, files: [], error: 'The provider returned an error', free: quote.free, compareGroup: compareGroup ?? null });
      events.push({ event: 'error', data: { code: 'PROVIDER_UNAVAILABLE', message: 'The provider returned an error. You were not charged.', refunded: true, refundedUsd: quote.priceUsd, freeRerun: { available: state.freeUsed < FREE_LIMIT, modelId: FREE_MODEL_ID } }, delay: 500 });
      return new HttpResponse(sseStream(events, speed), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    if (pending) {
      asstMsg.status = 'pending';
      const file = SAMPLE_FILES[task === 'music' ? 'music' : 'image'];
      recordRequest({ requestId, status: 'pending', modelId: model.modelId, label: model.label, chatId: chat.id, chargedUsd: quote.priceUsd, refundedUsd: null, latencyMs: null, text: SAMPLE_REPLY[task], files: [file], error: null, free: quote.free, compareGroup: compareGroup ?? null });
      events.push({ event: 'pending', data: { requestId, pollUrl: `/requests/${requestId}` }, delay: 400 });
      return new HttpResponse(sseStream(events, speed), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    let answerModel = model;
    if (fallback) {
      const next = mockModels.find((m) => !m.free && m.modelId !== model.modelId && m.taskTypes.includes(task)) ?? model;
      answerModel = next;
      events.push({ event: 'delta', data: { text: 'Starting' }, delay: 200 });
      events.push({ event: 'fallback', data: { fromModelId: model.modelId, toModelId: next.modelId, label: next.label, reason: 'provider timeout' }, delay: 600 });
      asstMsg.modelId = next.modelId;
      chat.currentModelId = next.modelId;
    }

    const reply = SAMPLE_REPLY[task];
    const files = task === 'image' ? [SAMPLE_FILES.image] : [];
    for (const t of tokenize(reply, 3)) events.push({ event: 'delta', data: { text: t }, delay: 35 });
    const charged = quote.free ? 0 : quote.priceUsd;
    events.push({
      event: 'done',
      data: () => {
        asstMsg.text = reply;
        asstMsg.files = files;
        asstMsg.chargedUsd = charged;
        chat.spentUsd = Math.round((chat.spentUsd + charged) * 1e6) / 1e6;
        if (!quote.free) charge(charged);
        recordRequest({ requestId, status: 'succeeded', modelId: answerModel.modelId, label: answerModel.label, chatId: chat.id, chargedUsd: charged, refundedUsd: null, latencyMs: Date.now() - started, text: reply, files, error: null, free: quote.free, compareGroup: compareGroup ?? null });
        return { requestId, modelId: answerModel.modelId, text: reply, files, citations: [], chargedUsd: charged, latencyMs: Date.now() - started, usage: usage() };
      },
      delay: 150,
    });
    return new HttpResponse(sseStream(events, speed), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }),
];
