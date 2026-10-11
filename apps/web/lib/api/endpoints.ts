/**
 * Typed endpoint functions — every route from "SmartRouter Frontend Architecture"
 * (Screens and the endpoints each uses; Wallet and sign-in; Paying for runs).
 */
import { apiFetch } from '@/lib/api/client';
import {
  catalogSchema,
  chatHistorySchema,
  chatListSchema,
  chatSchema,
  createChatResponseSchema,
  quoteSchema,
  recommendResponseSchema,
  requestListSchema,
  requestSchema,
  privySignInSchema,
  depositAddressSchema,
  sendPlanSchema,
  sendQuoteSchema,
  sessionsCurrentSchema,
  settingsSchema,
  spendingKeySchema,
  walletActivitySchema,
  walletOptionsSchema,
  walletSchema,
  type SendInput,
  userSchema,
  type PrivySignInInput,
  type ChatPatch,
  type CompareVoteInput,
  type CreateChatInput,
  type FeedbackInput,
  type QuoteInput,
  type RecommendInput,
  type SettingsPatch,
  type TaskType,
  type WaitlistInput,
} from '@/lib/api/types';

const sig = (signal?: AbortSignal) => (signal ? { signal } : {});

export const auth = {
  /** `POST /auth/privy { identityToken }` → `{ userId, address, email, loginMethod, token, expiresAt }`. */
  privy: (input: PrivySignInInput) => apiFetch('/auth/privy', { method: 'POST', body: input, schema: privySignInSchema }),
  /** `POST /auth/logout` ends the session. */
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
};

export const me = {
  /** `GET /me` → `{ id, address, email, loginMethod, usage, settings }`. */
  get: (signal?: AbortSignal) => apiFetch('/me', { schema: userSchema, ...sig(signal) }),
  /** `PATCH /me/settings { slider?, allocationUsd?, weeklyLimitUsd?, autoFreeFallback?, country? }` → updated settings. */
  updateSettings: (patch: SettingsPatch) => apiFetch('/me/settings', { method: 'PATCH', body: patch, schema: settingsSchema }),
};

export const catalog = {
  /** `GET /catalog?taskType=` — all models by task, quality and price. */
  list: (taskType?: TaskType, signal?: AbortSignal) =>
    apiFetch(taskType ? `/catalog?taskType=${encodeURIComponent(taskType)}` : '/catalog', { schema: catalogSchema, ...sig(signal) }),
  /** `POST /recommend { prompt, slider?, taskType? }` — options for a prompt. */
  recommend: (input: RecommendInput, signal?: AbortSignal) =>
    apiFetch('/recommend', { method: 'POST', body: input, schema: recommendResponseSchema, ...sig(signal) }),
};

export const chats = {
  /** `GET /chats?cursor=&limit=` */
  list: (cursor?: string | null, signal?: AbortSignal) =>
    apiFetch(cursor ? `/chats?cursor=${encodeURIComponent(cursor)}` : '/chats', { schema: chatListSchema, ...sig(signal) }),
  /** `POST /chats { taskType?, description?, slider? }` → `chatId`, `options[]`. */
  create: (input: CreateChatInput) => apiFetch('/chats', { method: 'POST', body: input, schema: createChatResponseSchema }),
  /** `GET /chats/:id` (history, paged with `before`). */
  get: (chatId: string, before?: string | null, signal?: AbortSignal) =>
    apiFetch(`/chats/${encodeURIComponent(chatId)}${before ? `?before=${encodeURIComponent(before)}` : ''}`, { schema: chatHistorySchema, ...sig(signal) }),
  /** `PATCH /chats/:id { title?, slider?, currentModelId? }`. */
  update: (chatId: string, patch: ChatPatch) =>
    apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: 'PATCH', body: patch, schema: chatSchema }),
  /** `DELETE /chats/:id` (archive). */
  remove: (chatId: string) => apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }),
  /** `POST /chats/:id/quote { prompt, modelId? }` → `quoteId`, `priceUsd`, `free`, `expiresAt`, `suggestion?`. */
  quote: (chatId: string, input: QuoteInput, signal?: AbortSignal) =>
    apiFetch(`/chats/${encodeURIComponent(chatId)}/quote`, { method: 'POST', body: input, schema: quoteSchema, ...sig(signal) }),
};

export const sessions = {
  /** `GET /sessions/current` → `paidRunsEnabled`, `network`, `suggestedDepositUsd`, `usage`, `session`. */
  current: (signal?: AbortSignal) => apiFetch('/sessions/current', { schema: sessionsCurrentSchema, ...sig(signal) }),
};

export const requests = {
  /** `GET /requests?cursor=` — past runs and what they charged. */
  list: (cursor?: string | null, signal?: AbortSignal) =>
    apiFetch(cursor ? `/requests?cursor=${encodeURIComponent(cursor)}` : '/requests', { schema: requestListSchema, ...sig(signal) }),
  /** `GET /requests/:id` — also the poll target for slow jobs (`pending` event). */
  get: (requestId: string, signal?: AbortSignal) =>
    apiFetch(`/requests/${encodeURIComponent(requestId)}`, { schema: requestSchema, ...sig(signal) }),
  /** Poll an absolute or relative `pollUrl` from a `pending` event (must stay on the API origin). */
  poll: (pollUrl: string, signal?: AbortSignal) => apiFetch(pollPath(pollUrl), { schema: requestSchema, ...sig(signal) }),
};

/** Only paths on the API origin are polled; anything else is reduced to its path. */
export function pollPath(pollUrl: string): string {
  try {
    const u = new URL(pollUrl, 'https://placeholder.invalid');
    return `${u.pathname}${u.search}`;
  } catch {
    return pollUrl.startsWith('/') ? pollUrl : `/${pollUrl}`;
  }
}

export const feedback = {
  /** `POST /feedback { requestId, rating: 1 | -1 }`. */
  rate: (input: FeedbackInput) => apiFetch('/feedback', { method: 'POST', body: input }),
  /** `POST /compare/vote { compareGroup, winnerRequestId, prompt }`. */
  compareVote: (input: CompareVoteInput) => apiFetch('/compare/vote', { method: 'POST', body: input }),
};

export const waitlist = {
  /** `POST /waitlist { email, interest, country? }`. */
  join: (input: WaitlistInput) => apiFetch('/waitlist', { method: 'POST', body: input }),
};

/** `POST /run` lives in `lib/api/sse.ts` (SSE reader over fetch / the mppx session manager). */
export const RUN_PATH = '/run';

/** Wallet (Handover "Wallet"): one balance, spending caps, Deposit, Send, activity. All need sign-in. */
export const wallet = {
  /** `GET /wallet` — balance, locked, caps, spending key, features. */
  get: (signal?: AbortSignal) => apiFetch('/wallet', { schema: walletSchema, ...sig(signal) }),
  /** `GET /wallet/options` → `deposit[]`, `send[]`, `card`. */
  options: (signal?: AbortSignal) => apiFetch('/wallet/options', { schema: walletOptionsSchema, ...sig(signal) }),
  /** `POST /wallet/deposit-address { chain, token?, refundAddress? }`. */
  depositAddress: (input: { chain: string; token?: string; refundAddress?: string }) => apiFetch('/wallet/deposit-address', { method: 'POST', body: input, schema: depositAddressSchema }),
  /** `POST /wallet/send/quote { chain, token, to, amountUsd }`. */
  sendQuote: (input: SendInput) => apiFetch('/wallet/send/quote', { method: 'POST', body: input, schema: sendQuoteSchema }),
  /** `POST /wallet/send` → `{ sendId, calls, feePayer: true }`. */
  send: (input: SendInput) => apiFetch('/wallet/send', { method: 'POST', body: input, schema: sendPlanSchema }),
  /** `POST /wallet/send/:id/submitted { txHash }`. */
  submitted: (sendId: string, txHash: string) => apiFetch<{ status: string }>(`/wallet/send/${encodeURIComponent(sendId)}/submitted`, { method: 'POST', body: { txHash } }),
  /** `GET /wallet/activity?limit=30&before=<at>`. */
  activity: (before?: string | null, signal?: AbortSignal) =>
    apiFetch(`/wallet/activity?limit=30${before ? `&before=${encodeURIComponent(before)}` : ''}`, { schema: walletActivitySchema, ...sig(signal) }),
  /** `POST /wallet/spending-key { accessKeyAddress }` → its on-chain state. */
  spendingKey: (accessKeyAddress: string) => apiFetch('/wallet/spending-key', { method: 'POST', body: { accessKeyAddress }, schema: spendingKeySchema }),
  /** `POST /wallet/locked/return` → `{ returnedUsd }` (instant return of locked money). */
  returnLocked: () => apiFetch<{ returnedUsd: number; skipped?: string[] }>('/wallet/locked/return', { method: 'POST', body: {} }),
};

export const api = { auth, me, catalog, chats, sessions, requests, feedback, waitlist, wallet };
export type Api = typeof api;
