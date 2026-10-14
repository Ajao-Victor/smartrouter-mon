/**
 * Typed endpoint functions — every route of SmartRouter on Monad (Monad handoff, and the
 * backend routes it cites: auth, wallet, run, ledger).
 */
import { apiFetch } from '@/lib/api/client';
import {
  catalogSchema,
  chatHistorySchema,
  chatListSchema,
  chatSchema,
  createChatResponseSchema,
  quoteSchema,
  uploadLimitsSchema,
  uploadSchema,
  uploadTicketSchema,
  recommendResponseSchema,
  requestListSchema,
  requestSchema,
  privySignInSchema,
  depositAuthorizationSchema,
  depositResultSchema,
  relayedTxSchema,
  sendCodeSchema,
  sendPlanSchema,
  sendQuoteSchema,
  sessionsCurrentSchema,
  settingsSchema,
  setupRequestSchema,
  walletActivitySchema,
  walletOptionsSchema,
  walletSchema,
  type SendRequest,
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
  /** `PATCH /me/settings { slider?, dailyLimitUsd?, weeklyLimitUsd?, autoFreeFallback?, country? }` → settings (+ `vaultSetupNeeded`). */
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
  /** `GET /sessions/current` → `paidRunsEnabled`, `network` (vault, ledger, explorer), `suggestedDepositUsd`, `usage`, `session` (AI balance, `nextVoucherBaseMicro`). */
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
  /** `POST /feedback { requestId, rating: 1 | -1, signature? }` (signature: EIP-712 Rating by the spending key). */
  rate: (input: FeedbackInput) => apiFetch('/feedback', { method: 'POST', body: input }),
  /** `POST /compare/vote { compareGroup, winnerRequestId, prompt, signature? }` (EIP-712 Vote by the spending key). */
  compareVote: (input: CompareVoteInput) => apiFetch('/compare/vote', { method: 'POST', body: input }),
};

export const waitlist = {
  /** `POST /waitlist { email, interest, country? }`. */
  join: (input: WaitlistInput) => apiFetch('/waitlist', { method: 'POST', body: input }),
};

/** `POST /run` lives in `lib/api/sse.ts` (SSE reader; paid runs answer the 402 voucher challenge in `lib/monad/payments.ts`). */
export const RUN_PATH = '/run';

/**
 * Wallet on Monad (Monad handoff §5): balances, the AI balance in SmartRouterVault, the spending-key
 * setup, gasless deposits and sends, activity. Every on-chain action is a signature the backend
 * operator relays, so the user needs no MON. All need sign-in.
 */
export const wallet = {
  /** `GET /wallet` — main USDC balance, AI balance, caps, spending key, features. */
  get: (signal?: AbortSignal) => apiFetch('/wallet', { schema: walletSchema, ...sig(signal) }),
  /** `GET /wallet/options` → `deposit[]`, `send[]`, `card`. */
  options: (signal?: AbortSignal) => apiFetch('/wallet/options', { schema: walletOptionsSchema, ...sig(signal) }),
  /** `GET /wallet/setup?signer=&dailyUsd=&weeklyUsd=` → Setup typed data for the Privy wallet to sign. */
  setupRequest: (input: { signer: string; dailyUsd?: number; weeklyUsd?: number }) => {
    const q = new URLSearchParams({ signer: input.signer });
    if (input.dailyUsd !== undefined) q.set('dailyUsd', String(input.dailyUsd));
    if (input.weeklyUsd !== undefined) q.set('weeklyUsd', String(input.weeklyUsd));
    return apiFetch(`/wallet/setup?${q.toString()}`, { schema: setupRequestSchema });
  },
  /** `POST /wallet/setup { ...message, signature }` → the operator relays `vault.setupFor`. */
  setup: (input: Record<string, string>) => apiFetch('/wallet/setup', { method: 'POST', body: input, schema: relayedTxSchema }),
  /** `POST /wallet/deposit/authorization { amountUsd }` → ReceiveWithAuthorization for Circle USDC. */
  depositAuthorization: (amountUsd: number) => apiFetch('/wallet/deposit/authorization', { method: 'POST', body: { amountUsd }, schema: depositAuthorizationSchema }),
  /** `POST /wallet/deposit { ...message, signature }` → the operator relays `vault.depositWithAuthorization`. */
  deposit: (input: Record<string, string>) => apiFetch('/wallet/deposit', { method: 'POST', body: input, schema: depositResultSchema }),
  /** `POST /wallet/send/quote { chain: 'monad', token: 'USDC', to, amountUsd }`. */
  sendQuote: (input: SendInput) => apiFetch('/wallet/send/quote', { method: 'POST', body: input, schema: sendQuoteSchema }),
  /** `POST /wallet/send/code { chain, token, to, amountUsd }` → emails a 6-digit code for this send. */
  sendCode: (input: SendInput) => apiFetch('/wallet/send/code', { method: 'POST', body: input, schema: sendCodeSchema }),
  /** `POST /wallet/send { chain, token, to, amountUsd, verificationId?, code? }` → `{ sendId, typedData }` (TransferWithAuthorization). */
  send: (input: SendRequest) => apiFetch('/wallet/send', { method: 'POST', body: input, schema: sendPlanSchema }),
  /** `POST /wallet/send/:id/sign { signature }` → the operator relays the transfer. */
  signSend: (sendId: string, signature: string) => apiFetch(`/wallet/send/${encodeURIComponent(sendId)}/sign`, { method: 'POST', body: { signature }, schema: relayedTxSchema }),
  /** `GET /wallet/activity?limit=30&before=<at>`. */
  activity: (before?: string | null, signal?: AbortSignal) =>
    apiFetch(`/wallet/activity?limit=30${before ? `&before=${encodeURIComponent(before)}` : ''}`, { schema: walletActivitySchema, ...sig(signal) }),
  /** `POST /wallet/locked/return` → `{ returnedUsd }`: the AI balance goes back to the wallet now. */
  returnLocked: () => apiFetch<{ returnedUsd: number; settledUsd?: number; txHash?: string | null; skipped?: string[] }>('/wallet/locked/return', { method: 'POST', body: {} }),
};

/** Public on-chain side (SmartRouterLedger): leaderboard and the router's decision log. */
export const ledger = {
  /** `GET /leaderboard?taskType=` — models ranked by delivered answers, thumbs and Compare wins. */
  leaderboard: (taskType?: TaskType, signal?: AbortSignal) =>
    apiFetch<{ taskType: TaskType | null; source: string; ledger: string | null; models: { modelId: string; label: string; taskType: string; delivered: number; failed: number; up: number; down: number; compareWins: number; compareLosses: number; score: number }[] }>(
      taskType ? `/leaderboard?taskType=${encodeURIComponent(taskType)}` : '/leaderboard',
      sig(signal),
    ),
  /** `GET /requests/:id/route` — why the router picked this model; `verified` = its hash matches the on-chain receipt. */
  route: (requestId: string, signal?: AbortSignal) =>
    apiFetch<{ requestId: string; routeHash: string | null; log: unknown; verified: boolean; ledgerTx: string | null; explorerUrl: string | null }>(`/requests/${encodeURIComponent(requestId)}/route`, sig(signal)),
};

/**
 * File uploads into chats: `POST /uploads` → PUT the bytes to `putUrl` (straight to storage) →
 * `POST /uploads/:id/complete` (text pulled out) → `attachmentIds` on `POST /chats/:id/quote`.
 */
const uploads = {
  limits: (signal?: AbortSignal) => apiFetch('/uploads/limits', { schema: uploadLimitsSchema, ...sig(signal) }),
  create: (input: { filename: string; mime: string; sizeBytes: number }) => apiFetch('/uploads', { method: 'POST', body: input, schema: uploadTicketSchema }),
  complete: (uploadId: string) => apiFetch(`/uploads/${encodeURIComponent(uploadId)}/complete`, { method: 'POST', schema: uploadSchema }),
  /** Details plus a 10-minute link to the file (owner only). */
  get: (uploadId: string) => apiFetch(`/uploads/${encodeURIComponent(uploadId)}`, { schema: uploadSchema }),
  remove: (uploadId: string) => apiFetch<{ ok: boolean }>(`/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }),
};

export const api = { auth, me, catalog, chats, sessions, requests, feedback, waitlist, wallet, ledger, uploads };
export type Api = typeof api;
