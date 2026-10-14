/**
 * MSW handlers for SmartRouter on Monad (Monad handoff + the backend's wallet/run routes). Routes
 * have no `/api` prefix, money is USD decimals, errors are `{ code, message, details? }`, `/run`
 * streams SSE (`meta`, `delta`, heartbeat comments, `fallback`, `pending`, `done`, `error`). Paid
 * runs play the real protocol: 409 SETUP_REQUIRED until the vault setup is done, 402
 * ALLOCATION_EXHAUSTED when the AI balance is short, then the 402 PAYMENT_REQUIRED voucher
 * challenge answered with `X-SmartRouter-Voucher`. Signatures are not verified.
 * Prompt hooks for demos: `[fallback]`, `[fail]`, `[pending]`, `[slow]`.
 */
import { delay, http, HttpResponse } from 'msw';

import type { SliderPreset, TaskType } from '@/lib/api/types';
import { getContracts } from '@/lib/monad/contracts';

import { FREE_MODEL_ID, SAMPLE_FILES, SAMPLE_REPLY, mockModels } from './fixtures';
import { sseStream, tokenize, type SseEvent } from './sse';
import {
  appendMessage,
  charge,
  classify,
  createChat,
  depositToAi,
  FREE_LIMIT,
  makeQuote,
  modelById,
  nextId,
  optionsFor,
  pollRequest,
  publicChat,
  publicRequest,
  recordRequest,
  state,
  dailySpentUsd,
  MOCK_SEND_CODE,
  MOCK_STORAGE,
  mockTxHash,
  mockUploads,
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

/* ------------------------------ Monad typed data ------------------------------ */

const CHAIN_ID = 143;
const EXPLORER = 'https://monadscan.com';
const micro = (usd: number) => BigInt(Math.round(usd * 1e6));
const contracts = () => getContracts();
const vaultDomain = () => ({ name: 'SmartRouterVault', version: '1', chainId: CHAIN_ID, verifyingContract: contracts().vault });
const usdcDomain = () => ({ name: 'USDC', version: '2', chainId: CHAIN_ID, verifyingContract: contracts().usdc });
const nonce32 = () => `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
const ERC3009 = (name: string) => ({
  [name]: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
});

function setupTyped(signer: string | null, dailyUsd?: number, weeklyUsd?: number) {
  const now = Math.floor(Date.now() / 1000);
  return {
    domain: vaultDomain(),
    types: {
      Setup: [
        { name: 'user', type: 'address' },
        { name: 'signer', type: 'address' },
        { name: 'signerExpiry', type: 'uint64' },
        { name: 'dailyCap', type: 'uint128' },
        { name: 'weeklyCap', type: 'uint128' },
        { name: 'nonce', type: 'uint64' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Setup',
    message: {
      user: state.user.address,
      signer,
      signerExpiry: String(now + 7 * 86_400),
      dailyCap: micro(dailyUsd ?? state.user.dailyLimitUsd).toString(),
      weeklyCap: micro(weeklyUsd ?? state.user.weeklyLimitUsd).toString(),
      nonce: '0',
      deadline: String(now + 900),
    },
    submit: 'POST /wallet/setup { ...message, signature }',
  };
}

function voucherTyped(priceUsd: number) {
  return {
    domain: vaultDomain(),
    types: {
      Voucher: [
        { name: 'user', type: 'address' },
        { name: 'cumulativeAmount', type: 'uint256' },
      ],
    },
    primaryType: 'Voucher',
    message: { user: state.user.address, cumulativeAmount: (mockWallet.voucherTotalMicro + micro(priceUsd)).toString() },
    header: 'x-smartrouter-voucher',
  };
}

function readVoucher(raw: string | null): { cumulativeAmount: bigint; signature: string } | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(atob(raw)) as { cumulativeAmount?: string; signature?: string };
    if (!j.signature || !/^0x[0-9a-fA-F]{130,}$/.test(j.signature) || j.cumulativeAmount === undefined) return null;
    return { cumulativeAmount: BigInt(j.cumulativeAmount), signature: j.signature };
  } catch {
    return null;
  }
}

function aiBalance() {
  const s = state.session && state.session.status === 'open' ? state.session : null;
  return s ? { channelId: s.channelId, depositUsd: s.depositUsd, spentUsd: s.spentUsd, remainingUsd: s.remainingUsd } : null;
}

function record(type: string, amountUsd: number, counterparty: string | null) {
  const txHash = mockTxHash();
  mockWallet.activity.unshift({ id: nextId('mv'), type, status: 'completed', amountUsd, chain: 'monad', token: 'USDC', counterparty, txHash, at: new Date().toISOString() });
  return txHash;
}


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
    const ai = aiBalance();
    return HttpResponse.json({
      id: 'user_mock',
      address,
      email: 'demo@smartrouter.dev',
      loginMethod: 'email',
      country: null,
      network: { chainId: CHAIN_ID, name: 'Monad' },
      usage: usage(),
      settings,
      allocation: ai ? { channelId: ai.channelId, depositUsd: ai.depositUsd, usedUsd: ai.spentUsd, remainingUsd: ai.remainingUsd } : null,
      spendingKey: { setupDone: mockWallet.setupDone, address: mockWallet.spendingKey, expiresAt: mockWallet.setupDone ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null },
      freeRemainingToday: Math.max(0, FREE_LIMIT - state.freeUsed),
    });
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
    return HttpResponse.json({ ...settings, country: null, vaultSetupNeeded: patch.dailyLimitUsd !== undefined || patch.weeklyLimitUsd !== undefined });
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
    return HttpResponse.json({ chat: publicChat(chat), messages: chat.messages.map((m, i) => ({ id: m.id, seq: i + 1, role: m.role, content: m.text, modelId: m.modelId, resultRef: m.files[0]?.url ?? null, attachments: m.attachments ?? null, status: m.status, createdAt: m.createdAt })), hasMore: false });
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
    const { prompt, modelId, attachmentIds = [] } = await body<{ prompt?: string; modelId?: string; attachmentIds?: string[] }>(request);
    if (!prompt) return error(400, 'VALIDATION_FAILED', 'prompt is required');
    for (const id of attachmentIds) {
      const u = mockUploads.get(id);
      if (!u || u.status === 'deleted') return error(404, 'NOT_FOUND', 'An attached file was removed or has expired — attach it again');
      if (u.status !== 'ready') return error(400, 'VALIDATION_FAILED', `"${u.filename}" isn't ready yet`);
    }
    const task = classify(prompt);
    const options = optionsFor(chat.taskType, sliderOf(chat.slider ?? state.user.slider), prompt, null);
    const chosen = modelId ?? chat.currentModelId ?? options[0]?.modelId ?? FREE_MODEL_ID;
    if (!modelById(chosen)) return error(404, 'NOT_FOUND', 'Unknown model');
    await delay(120);
    // Files are priced in: the quote covers the prompt plus the files' text.
    const fileText = attachmentIds.map((id) => mockUploads.get(id)?.text ?? '').join('\n');
    const q = makeQuote(chat.id, chosen, fileText ? `${fileText}\n${prompt}` : prompt);
    q.prompt = prompt;
    q.attachmentIds = attachmentIds;
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
      network: { chainId: CHAIN_ID, name: 'Monad', token: contracts().usdc, vault: contracts().vault, ledger: contracts().ledger, operator: '0x61eB118FDb951cD9982a7fc6fA4132a31cF9c1a3', explorer: EXPLORER },
      suggestedDepositUsd: usage().nextDepositUsd,
      usage: usage(),
      session: s
        ? {
            channelId: s.channelId,
            depositUsd: s.depositUsd,
            spentUsd: s.spentUsd,
            remainingUsd: s.remainingUsd,
            settledUsd: 0,
            deliveredUsd: s.spentUsd,
            requests: s.requests,
            nextVoucherBaseMicro: mockWallet.voucherTotalMicro.toString(),
            setupDone: mockWallet.setupDone,
            signer: mockWallet.spendingKey,
            signerExpiresAt: mockWallet.setupDone ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
            lastUsedAt: s.openedAt,
          }
        : null,
    });
  }),

  /* ---------------------------------- wallet -------------------------------- */
  http.get(url('/wallet'), () => {
    const g = guard();
    if (g) return g;
    const ai = aiBalance();
    return HttpResponse.json({
      address: state.user.address,
      network: { chainId: CHAIN_ID, name: 'Monad', explorer: EXPLORER },
      token: { address: contracts().usdc, symbol: 'USDC', decimals: 6 },
      main: { balanceUsd: mockWallet.balanceUsd },
      ai,
      locked: ai,
      vault: { address: contracts().vault, ledger: contracts().ledger },
      caps: usage(),
      spendingKey: mockWallet.setupDone
        ? { status: 'active', address: mockWallet.spendingKey, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), onChainCaps: { dailyUsd: state.user.dailyLimitUsd, weeklyUsd: state.user.weeklyLimitUsd } }
        : { status: 'missing', address: null, expiresAt: null, onChainCaps: { dailyUsd: 0, weeklyUsd: 0 } },
      networkFees: { paidBy: 'smartrouter', sponsoredPerDay: 20, usedToday: 0 },
      features: { crossChain: false, card: { via: 'privy', chain: 'monad', token: 'USDC' }, cashOut: false, sendCode: { required: mockWallet.sendCodeRequired, sentTo: 'd•••@smartrouter.dev', ttlMinutes: 10 } },
    });
  }),
  http.get(url('/wallet/options'), () => {
    const monad = { chain: 'monad', chainId: CHAIN_ID, chainName: 'Monad', vmType: 'evm', token: 'USDC', tokenAddress: contracts().usdc, decimals: 6 };
    return HttpResponse.json({
      deposit: [{ ...monad, depositAvailable: true, method: 'direct', note: 'Send USDC on Monad to your wallet address, then move it to your AI balance with one signature.' }],
      send: [{ ...monad, method: 'direct' }],
      card: { via: 'privy', chain: 'monad', chainId: CHAIN_ID, token: 'USDC', tokenAddress: contracts().usdc, note: 'Buy USDC on Monad with a card (Privy funding); it lands in your wallet.' },
      aurora: null,
      cashOut: null,
    });
  }),
  http.get(url('/wallet/activity'), () => guard() ?? HttpResponse.json({ items: mockWallet.activity.map((a) => ({ ...a, deliveredUsd: a.amountUsd, explorerUrl: a.txHash ? `${EXPLORER}/tx/${a.txHash}` : null })), nextBefore: null, indexer: null })),

  http.get(url('/wallet/setup'), ({ request }) => {
    const g = guard();
    if (g) return g;
    const q = new URL(request.url).searchParams;
    const daily = q.get('dailyUsd');
    const weekly = q.get('weeklyUsd');
    return HttpResponse.json(setupTyped(q.get('signer'), daily ? Number(daily) : undefined, weekly ? Number(weekly) : undefined));
  }),
  http.post(url('/wallet/setup'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const b = await body<{ signer?: string; dailyCap?: string; weeklyCap?: string; signature?: string }>(request);
    if (!b.signer || !b.signature || !b.dailyCap || !b.weeklyCap) return error(400, 'VALIDATION_FAILED', 'Send { ...message, signature }');
    if (BigInt(b.dailyCap) <= 0n || BigInt(b.weeklyCap) < BigInt(b.dailyCap)) return error(400, 'VALIDATION_FAILED', 'Caps: daily must be above 0 and not above weekly');
    mockWallet.setupDone = true;
    mockWallet.spendingKey = b.signer.toLowerCase();
    const txHash = mockTxHash();
    return HttpResponse.json({ ok: true, txHash, explorerUrl: `${EXPLORER}/tx/${txHash}` });
  }),

  http.post(url('/wallet/deposit/authorization'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const { amountUsd } = await body<{ amountUsd?: number }>(request);
    if (!amountUsd || amountUsd <= 0) return error(400, 'VALIDATION_FAILED', 'amountUsd must be positive');
    if (amountUsd > mockWallet.balanceUsd) return error(400, 'VALIDATION_FAILED', `Not enough USDC in your wallet ($${mockWallet.balanceUsd.toFixed(2)})`);
    return HttpResponse.json({
      domain: usdcDomain(),
      types: ERC3009('ReceiveWithAuthorization'),
      primaryType: 'ReceiveWithAuthorization',
      message: { from: state.user.address, to: contracts().vault, value: micro(amountUsd).toString(), validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600), nonce: nonce32() },
      submit: 'POST /wallet/deposit { ...message, signature }',
    });
  }),
  http.post(url('/wallet/deposit'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const b = await body<{ value?: string; signature?: string; nonce?: string }>(request);
    if (!b.value || !b.signature || !b.nonce) return error(400, 'VALIDATION_FAILED', 'Send { ...message, signature }');
    const usd = Number(b.value) / 1e6;
    if (usd > mockWallet.balanceUsd) return error(400, 'VALIDATION_FAILED', `Not enough USDC in your wallet ($${mockWallet.balanceUsd.toFixed(2)})`);
    mockWallet.balanceUsd = Math.round((mockWallet.balanceUsd - usd) * 1e6) / 1e6;
    const s = depositToAi(usd);
    const txHash = record('to_ai_balance', usd, contracts().vault);
    return HttpResponse.json({ ok: true, txHash, explorerUrl: `${EXPLORER}/tx/${txHash}`, ai: { depositUsd: s.depositUsd, remainingUsd: s.remainingUsd } });
  }),

  http.post(url('/wallet/locked/return'), () => {
    const g = guard();
    if (g) return g;
    const s = state.session;
    const returned = s ? s.remainingUsd : 0;
    state.session = null;
    mockWallet.balanceUsd = Math.round((mockWallet.balanceUsd + returned) * 1e6) / 1e6;
    const txHash = returned > 0 ? record('from_ai_balance', returned, contracts().vault) : null;
    return HttpResponse.json({ returnedUsd: returned, settledUsd: s?.spentUsd ?? 0, txHash, skipped: [] });
  }),
  http.post(url('/wallet/send/quote'), async ({ request }) => {
    const { amountUsd } = await body<{ amountUsd?: number }>(request);
    return HttpResponse.json({ sendUsd: amountUsd ?? 0, receiveUsd: amountUsd ?? 0, bridgeFeeUsd: 0, networkFeeUsd: 0, etaSeconds: 1 });
  }),
  http.post(url('/wallet/send/code'), async ({ request }) => {
    const b = await body<{ chain?: string; token?: string; to?: string; amountUsd?: number }>(request);
    if ((b.amountUsd ?? 0) > mockWallet.balanceUsd) return error(400, 'VALIDATION_FAILED', `Not enough in your wallet ($${mockWallet.balanceUsd.toFixed(2)})`);
    // A new code cancels the old one.
    mockWallet.sendCode = { id: crypto.randomUUID(), body: JSON.stringify([b.chain, b.token, b.to?.toLowerCase(), b.amountUsd]), attemptsLeft: 5, used: false };
    return HttpResponse.json({ verificationId: mockWallet.sendCode.id, sentTo: 'd•••@smartrouter.dev', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), attemptsAllowed: 5, devCode: MOCK_SEND_CODE });
  }),
  http.post(url('/wallet/send'), async ({ request }) => {
    const { amountUsd, verificationId, code, chain, token, to } = await body<{ amountUsd?: number; verificationId?: string; code?: string; chain?: string; token?: string; to?: string }>(request);
    if (chain !== undefined && chain !== 'monad') return error(400, 'VALIDATION_FAILED', 'Only Monad USDC can be sent');
    if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) return error(400, 'VALIDATION_FAILED', 'Enter a valid Monad address (0x…)');
    const c = mockWallet.sendCode;
    if (mockWallet.sendCodeRequired) {
      if (!verificationId || !code) return error(400, 'VALIDATION_FAILED', 'Enter the 6-digit code we emailed you');
      if (!c || c.id !== verificationId || c.used || c.attemptsLeft <= 0) return error(410, 'SEND_CODE_EXPIRED', 'This code has expired or was already used; request a new one');
      if (c.body !== JSON.stringify([chain, token, to.toLowerCase(), amountUsd])) return error(410, 'SEND_CODE_EXPIRED', 'This code was for a different amount or recipient; request a new one');
      if (code.trim() !== MOCK_SEND_CODE) {
        c.attemptsLeft -= 1;
        if (c.attemptsLeft <= 0) return error(410, 'SEND_CODE_EXPIRED', 'Too many wrong codes; request a new one');
        return error(400, 'SEND_CODE_INVALID', `Wrong code — ${String(c.attemptsLeft)} ${c.attemptsLeft === 1 ? 'try' : 'tries'} left`, { attemptsLeft: c.attemptsLeft });
      }
    }
    if ((amountUsd ?? 0) > mockWallet.balanceUsd) return error(400, 'VALIDATION_FAILED', `Not enough in your wallet ($${mockWallet.balanceUsd.toFixed(2)})`);
    if (c) c.used = true;
    const sendId = crypto.randomUUID();
    mockWallet.sends.set(sendId, { to: to.toLowerCase(), amountUsd: amountUsd ?? 0 });
    const message = { from: state.user.address, to: to.toLowerCase(), value: micro(amountUsd ?? 0).toString(), validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 1800), nonce: nonce32() };
    return HttpResponse.json({
      sendId,
      chainId: CHAIN_ID,
      typedData: { domain: usdcDomain(), types: ERC3009('TransferWithAuthorization'), primaryType: 'TransferWithAuthorization', message },
      submit: `POST /wallet/send/${sendId}/sign { signature }`,
      sendUsd: amountUsd ?? 0,
      receiveUsd: amountUsd ?? 0,
      networkFeeUsd: 0,
    });
  }),
  http.post(url('/wallet/send/:id/sign'), async ({ params, request }) => {
    const g = guard();
    if (g) return g;
    const pending = mockWallet.sends.get(String(params.id));
    const { signature } = await body<{ signature?: string }>(request);
    if (!pending) return error(404, 'NOT_FOUND', 'Send not found or already submitted');
    if (!signature) return error(400, 'VALIDATION_FAILED', 'Send { signature }');
    mockWallet.sends.delete(String(params.id));
    mockWallet.balanceUsd = Math.round((mockWallet.balanceUsd - pending.amountUsd) * 1e6) / 1e6;
    const txHash = record('send', pending.amountUsd, pending.to);
    return HttpResponse.json({ sendId: String(params.id), status: 'completed', txHash, explorerUrl: `${EXPLORER}/tx/${txHash}` });
  }),

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
    const { requestId, rating, signature } = await body<{ requestId?: string; rating?: number; signature?: string }>(request);
    if (!requestId || (rating !== 1 && rating !== -1)) return error(400, 'VALIDATION_FAILED', 'requestId and rating (1 | -1) are required');
    state.feedback.push({ requestId, rating });
    return HttpResponse.json({ ok: true, onChain: Boolean(signature) });
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

  /* --------------------------------- uploads -------------------------------- */
  http.get(url('/uploads/limits'), () => guard() ?? HttpResponse.json({ enabled: true, maxBytes: 20 * 1024 * 1024, perDay: 30, maxPerMessage: 5, keepDays: 30, accepted: 'PDF, Word (.docx), text, Markdown, CSV, JSON or code files' })),
  http.post(url('/uploads'), async ({ request }) => {
    const g = guard();
    if (g) return g;
    const b = await body<{ filename?: string; mime?: string; sizeBytes?: number }>(request);
    if (!b.filename || !b.sizeBytes) return error(400, 'VALIDATION_FAILED', 'filename and sizeBytes are required');
    if (/\.(png|jpe?g|gif|zip|exe)$/i.test(b.filename)) return error(400, 'VALIDATION_FAILED', "That file type isn't supported yet. Attach PDF, Word (.docx), text, Markdown, CSV, JSON or code files.");
    const uploadId = crypto.randomUUID();
    const mime = b.mime || 'text/plain';
    mockUploads.set(uploadId, { uploadId, filename: b.filename, mime, sizeBytes: b.sizeBytes, status: 'pending', text: null });
    return HttpResponse.json({ uploadId, putUrl: `${MOCK_STORAGE}/u/${uploadId}`, method: 'PUT', headers: { 'content-type': mime }, expiresAt: new Date(Date.now() + 600_000).toISOString() }, { status: 201 });
  }),
  http.put(`${MOCK_STORAGE}/u/:id`, async ({ params, request }) => {
    const u = mockUploads.get(String(params.id));
    if (!u) return new HttpResponse(null, { status: 403 });
    const text = await request.text();
    u.text = u.mime === 'application/pdf' ? '[page 1]\nMock PDF text' : text;
    return new HttpResponse(null, { status: 200 });
  }),
  http.post(url('/uploads/:id/complete'), ({ params }) => {
    const g = guard();
    if (g) return g;
    const u = mockUploads.get(String(params.id));
    if (!u || u.status === 'deleted') return error(404, 'NOT_FOUND', 'File not found');
    if (u.text === null) return error(400, 'VALIDATION_FAILED', "The file hasn't finished uploading — upload it to putUrl first");
    if (!u.text.trim()) return error(400, 'VALIDATION_FAILED', `"${u.filename}" has no text to read (a scanned PDF or an image?)`);
    u.status = 'ready';
    return HttpResponse.json({ uploadId: u.uploadId, filename: u.filename, mime: u.mime, sizeBytes: u.sizeBytes, status: 'ready', tokens: Math.ceil(u.text.length / 4), truncated: false, error: null });
  }),
  http.delete(url('/uploads/:id'), ({ params }) => {
    const u = mockUploads.get(String(params.id));
    if (u) u.status = 'deleted';
    return HttpResponse.json({ ok: true });
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
      if (!mockWallet.setupDone) return error(409, 'SETUP_REQUIRED', 'Set up your spending key and caps first (one signature).', { setup: setupTyped(null) });
      const s = state.session && state.session.status === 'open' ? state.session : null;
      const remaining = s?.remainingUsd ?? 0;
      if (remaining < quote.priceUsd) {
        return error(402, 'ALLOCATION_EXHAUSTED', 'Your AI balance is too low for this answer. Top up, or continue on the free model.', {
          priceUsd: quote.priceUsd,
          remainingUsd: remaining,
          shortfallUsd: Math.round((quote.priceUsd - remaining) * 1e6) / 1e6,
          suggestedDepositUsd: usage().nextDepositUsd,
          freeFallback: { available: state.freeUsed < FREE_LIMIT, remaining: Math.max(0, FREE_LIMIT - state.freeUsed), modelId: FREE_MODEL_ID },
        });
      }
      const voucher = readVoucher(request.headers.get('x-smartrouter-voucher'));
      const expected = mockWallet.voucherTotalMicro + micro(quote.priceUsd);
      if (!voucher || voucher.cumulativeAmount !== expected) {
        return error(402, 'PAYMENT_REQUIRED', voucher ? `Voucher rejected: expected cumulativeAmount ${expected.toString()}. Sign the voucher in details and retry.` : 'Sign the voucher in details with your spending key and retry with the X-SmartRouter-Voucher header.', {
          priceUsd: quote.priceUsd,
          remainingUsd: remaining,
          voucher: voucherTyped(quote.priceUsd),
        });
      }
      mockWallet.voucherTotalMicro = expected;
    }

    quote.used = true;
    const task = model.taskTypes.includes(chat.taskType) ? chat.taskType : (model.taskTypes[0] ?? 'chat');
    const attachments = (quote.attachmentIds ?? []).flatMap((id) => {
      const u = mockUploads.get(id);
      return u ? [{ kind: 'file' as const, ref: u.uploadId, name: u.filename, mime: u.mime, sizeBytes: u.sizeBytes }] : [];
    });
    const userMsg = appendMessage(chat.id, { role: 'user', text: prompt, modelId: null, requestId: null, chargedUsd: null, files: [], attachments: attachments.length ? attachments : null, status: 'done' });
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
