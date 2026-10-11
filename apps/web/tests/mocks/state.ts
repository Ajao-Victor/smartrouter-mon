/**
 * In-memory backend for the mock API: user, chats, quotes, the payment session, requests and
 * the free quota. Shapes are what the live API sends (USD decimals, camelCase keys).
 */
import type { SliderPreset, TaskType } from '@/lib/api/types';

import { FREE_MODEL_ID, mockModels, mockUser, NOW, type MockModel, type MockUser } from './fixtures';

export interface MockMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modelId: string | null;
  requestId: string | null;
  createdAt: string;
  chargedUsd: number | null;
  files: { url: string; mime: string }[];
  status: 'done' | 'error' | 'pending';
}

export interface MockChat {
  id: string;
  title: string | null;
  taskType: TaskType;
  slider: SliderPreset | null;
  currentModelId: string | null;
  createdAt: string;
  updatedAt: string;
  spentUsd: number;
  archived: boolean;
  messages: MockMessage[];
}

export interface MockQuote {
  quoteId: string;
  chatId: string;
  modelId: string;
  prompt: string;
  priceUsd: number;
  free: boolean;
  expiresAt: string;
  used: boolean;
}

export interface MockSession {
  channelId: string;
  depositUsd: number;
  spentUsd: number;
  remainingUsd: number;
  requests: number;
  status: 'open' | 'closed';
  openedAt: string;
}

export interface MockRequest {
  requestId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  modelId: string;
  label: string;
  chatId: string;
  chargedUsd: number;
  refundedUsd: number | null;
  latencyMs: number | null;
  text: string | null;
  files: { url: string; mime: string }[];
  error: string | null;
  free: boolean;
  createdAt: string;
  compareGroup: string | null;
  txHash: string | null;
  /** Polls seen (pending jobs finish on the 3rd poll). */
  polls: number;
}

export interface MockState {
  authed: boolean;
  user: MockUser;
  chats: Map<string, MockChat>;
  quotes: Map<string, MockQuote>;
  session: MockSession | null;
  requests: Map<string, MockRequest>;
  freeUsed: number;
  feedback: { requestId: string; rating: number }[];
  votes: { compareGroup: string; winnerRequestId: string }[];
  waitlist: { email: string; interest: string; country?: string }[];
}

export const FREE_LIMIT = 30;
export const QUOTE_TTL_MS = 5 * 60_000;

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${String(counter).padStart(4, '0')}`;
}

function blank(): MockState {
  return { authed: true, user: mockUser(), chats: new Map(), quotes: new Map(), session: null, requests: new Map(), freeUsed: 0, feedback: [], votes: [], waitlist: [] };
}

export const state: MockState = blank();

export function resetMockState(over: Partial<Pick<MockState, 'authed' | 'session' | 'freeUsed'>> = {}): void {
  const fresh = blank();
  counter = 0;
  Object.assign(state, fresh, over);
  mockWallet.balanceUsd = 12.5;
  mockWallet.spendingKey = null;
  seedDemoChat();
}

/* --------------------------------- classify --------------------------------- */

const KEYWORDS: [TaskType, RegExp][] = [
  ['image', /\b(image|picture|photo|logo|poster|draw|illustration|render)\b/i],
  ['music', /\b(song|music|track|beat|melody|jingle|lyrics)\b/i],
  ['coding', /\b(code|bug|function|typescript|python|javascript|sql|api|regex|refactor|compile)\b/i],
  ['translation', /\b(translate|translation|in (french|spanish|yoruba|igbo|hausa|german|portuguese))\b/i],
  ['research', /\b(research|compare|sources|latest|cite|summar(y|ise|ize) the (news|paper)|what is the current)\b/i],
  ['writing', /\b(write|draft|cover letter|essay|email|blog|rewrite|edit|proofread|caption|post)\b/i],
];

export function classify(prompt: string): TaskType {
  for (const [task, re] of KEYWORDS) if (re.test(prompt)) return task;
  return 'chat';
}

/* ---------------------------------- pricing --------------------------------- */

function roundUpUsd(usd: number): number {
  return Math.ceil(usd * 10_000 - 1e-9) / 10_000;
}

export function modelById(modelId: string): MockModel | undefined {
  return mockModels.find((m) => m.modelId === modelId);
}

/** Price = typical price scaled by prompt length + 10% fee, rounded up to $0.0001 (PDF). */
export function priceFor(modelId: string, prompt: string): number {
  const m = modelById(modelId);
  if (!m || m.free) return 0;
  const scale = 1 + Math.min(3, prompt.length / 800);
  return roundUpUsd(m.priceUsd * scale * 1.1);
}

export function speedLabel(latency: number): string {
  if (latency < 800) return 'fast';
  if (latency < 2500) return 'steady';
  return 'slow';
}

const WEIGHTS: Record<SliderPreset, { q: number; p: number; s: number }> = {
  cheapest: { q: 0.2, p: 0.7, s: 0.1 },
  balanced: { q: 0.45, p: 0.4, s: 0.15 },
  best: { q: 0.8, p: 0.1, s: 0.1 },
};

export interface MockOption {
  modelId: string;
  label: string;
  provider: string;
  quoteId: string | null;
  priceUsd: number;
  speed: string;
  reason: string;
  free: boolean;
  quality: number;
  bestQuality: boolean;
  expiresAt: string | null;
}

/** PDF: three recommended models (top 2 by score + best quality) plus the free option. */
export function optionsFor(task: TaskType, slider: SliderPreset, prompt: string, chatId: string | null): MockOption[] {
  const w = WEIGHTS[slider];
  const paid = mockModels.filter((m) => !m.free && m.taskTypes.includes(task)).map((m) => ({ m, price: priceFor(m.modelId, prompt), q: m.quality[task] ?? 0.4 }));
  if (paid.length === 0) return [];
  const maxQ = Math.max(...paid.map((x) => x.q));
  const minP = Math.min(...paid.map((x) => x.price));
  const maxP = Math.max(...paid.map((x) => x.price));
  const scored = paid
    .map((x) => {
      const quality = x.q / maxQ;
      const price = maxP === minP ? 1 : 1 - (x.price - minP) / (maxP - minP);
      const speed = Math.max(0, 1 - x.m.latency / 10_000);
      return { ...x, score: w.q * quality + w.p * price + w.s * speed };
    })
    .sort((a, b) => b.score - a.score);
  const best = [...scored].sort((a, b) => b.q - a.q)[0];
  const picks = scored.slice(0, 2);
  if (best && !picks.some((p) => p.m.modelId === best.m.modelId)) picks.push(best);
  const bestPrice = best?.price ?? 1;
  const toOption = (x: (typeof scored)[number]): MockOption => {
    const pct = Math.round((x.q / (best?.q ?? 1)) * 100);
    const ratio = x.price > 0 ? Math.max(1, Math.round(bestPrice / x.price)) : 1;
    const isBest = x.m.modelId === best?.m.modelId;
    const quote = chatId ? makeQuote(chatId, x.m.modelId, prompt) : null;
    return {
      modelId: x.m.modelId,
      label: x.m.label,
      provider: x.m.provider,
      quoteId: quote?.quoteId ?? null,
      priceUsd: x.price,
      speed: speedLabel(x.m.latency),
      reason: isBest ? 'Highest quality for this task' : `${String(pct)}% of the best quality at 1/${String(ratio)} of the price`,
      free: false,
      quality: x.q,
      bestQuality: isBest,
      expiresAt: quote?.expiresAt ?? null,
    };
  };
  const out = picks.map(toOption);
  const free = modelById(FREE_MODEL_ID);
  if (free && free.taskTypes.includes(task)) {
    const quote = chatId ? makeQuote(chatId, FREE_MODEL_ID, prompt) : null;
    out.push({ modelId: FREE_MODEL_ID, label: free.label, provider: free.provider, quoteId: quote?.quoteId ?? null, priceUsd: 0, speed: 'fast', reason: `Free · ${String(FREE_LIMIT - state.freeUsed)} of ${String(FREE_LIMIT)} left today`, free: true, quality: free.quality[task] ?? 0.4, bestQuality: false, expiresAt: quote?.expiresAt ?? null });
  }
  return out;
}

/* ----------------------------------- chats ---------------------------------- */

export function createChat(input: { taskType?: TaskType; description?: string; slider?: SliderPreset }): MockChat {
  const now = NOW();
  const taskType = input.taskType ?? (input.description ? classify(input.description) : 'chat');
  const chat: MockChat = {
    id: nextId('chat'),
    title: input.description ? input.description.slice(0, 48) : null,
    taskType,
    slider: input.slider ?? null,
    currentModelId: null,
    createdAt: now,
    updatedAt: now,
    spentUsd: 0,
    archived: false,
    messages: [],
  };
  state.chats.set(chat.id, chat);
  return chat;
}

export function appendMessage(chatId: string, m: Omit<MockMessage, 'id' | 'createdAt'>): MockMessage {
  const chat = state.chats.get(chatId);
  if (!chat) throw new Error(`no chat ${chatId}`);
  const msg: MockMessage = { id: nextId('msg'), createdAt: NOW(), ...m };
  chat.messages.push(msg);
  chat.updatedAt = msg.createdAt;
  if (!chat.title && m.role === 'user') chat.title = m.text.slice(0, 48);
  return msg;
}

export function publicChat(chat: MockChat) {
  return { id: chat.id, title: chat.title, taskType: chat.taskType, slider: chat.slider, currentModelId: chat.currentModelId, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length, spentUsd: chat.spentUsd };
}

/* ---------------------------------- quotes ---------------------------------- */

export function makeQuote(chatId: string, modelId: string, prompt: string): MockQuote {
  const m = modelById(modelId);
  const quote: MockQuote = {
    quoteId: nextId('q'),
    chatId,
    modelId,
    prompt,
    priceUsd: priceFor(modelId, prompt),
    free: m?.free ?? false,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    used: false,
  };
  state.quotes.set(quote.quoteId, quote);
  return quote;
}

/* --------------------------------- sessions --------------------------------- */

export function openSession(depositUsd: number): MockSession {
  const s: MockSession = { channelId: nextId('ch'), depositUsd, spentUsd: 0, remainingUsd: depositUsd, requests: 0, status: 'open', openedAt: NOW() };
  state.session = s;
  return s;
}

export function charge(usd: number): void {
  const s = state.session;
  if (!s) return;
  s.spentUsd = Math.round((s.spentUsd + usd) * 1e6) / 1e6;
  s.remainingUsd = Math.max(0, Math.round((s.depositUsd - s.spentUsd) * 1e6) / 1e6);
  s.requests += 1;
}

/* --------------------------------- requests --------------------------------- */

export function recordRequest(args: Omit<MockRequest, 'requestId' | 'createdAt' | 'polls' | 'txHash'> & { requestId?: string }): MockRequest {
  const r: MockRequest = { requestId: args.requestId ?? nextId('req'), createdAt: NOW(), polls: 0, txHash: null, ...args };
  state.requests.set(r.requestId, r);
  return r;
}

export function publicRequest(r: MockRequest) {
  const { polls: _polls, ...rest } = r;
  return rest;
}

/** Pending jobs finish on the third poll; settled runs reveal a tx hash on the second. */
export function pollRequest(id: string): MockRequest | null {
  const r = state.requests.get(id);
  if (!r) return null;
  r.polls += 1;
  if (r.status === 'pending' && r.polls >= 3) {
    r.status = 'succeeded';
    r.latencyMs = 42_000;
    const chat = state.chats.get(r.chatId);
    const msg = chat?.messages.find((m) => m.requestId === r.requestId);
    if (msg) {
      msg.status = 'done';
      msg.text = r.text ?? '';
      msg.files = r.files;
      msg.chargedUsd = r.chargedUsd;
    }
    if (!r.free) charge(r.chargedUsd);
  }
  if (r.status === 'succeeded' && !r.free && r.polls >= 2 && !r.txHash) r.txHash = `0x${'7c'.repeat(32)}`;
  return r;
}

/* ----------------------------------- seed ----------------------------------- */

function seedDemoChat(): void {
  const chat = createChat({ taskType: 'writing', description: 'Write a LinkedIn post about launching on Tempo' });
  chat.title = 'LinkedIn post about launching on Tempo';
  chat.currentModelId = 'openrouter:z-ai/glm-5.3-flash';
  appendMessage(chat.id, { role: 'user', text: 'Write a LinkedIn post about launching on Tempo', modelId: null, requestId: null, chargedUsd: null, files: [], status: 'done' });
  const req = recordRequest({ status: 'succeeded', modelId: chat.currentModelId, label: 'GLM 5.3 Flash', chatId: chat.id, chargedUsd: 0.0009, refundedUsd: null, latencyMs: 1200, text: 'We just launched on Tempo 🚀 …', files: [], error: null, free: false, compareGroup: null });
  appendMessage(chat.id, { role: 'assistant', text: 'We just launched on Tempo 🚀 Pay per use for 40+ AI models, no subscriptions, from anywhere.', modelId: chat.currentModelId, requestId: req.requestId, chargedUsd: 0.0009, files: [], status: 'done' });
  chat.spentUsd = 0.0009;
}

seedDemoChat();

/* ----------------------------------- usage ---------------------------------- */

/** Paid spend in the last 7 days (the weekly meter). */
export function weeklySpentUsd(): number {
  const since = Date.now() - 7 * 24 * 3600_000;
  let total = 0;
  for (const r of state.requests.values()) if (!r.free && r.status !== 'failed' && Date.parse(r.createdAt) > since) total += r.chargedUsd;
  return Math.round(total * 1e6) / 1e6;
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.floor((part / whole) * 100)) : 0);

/** Paid spend since 00:00 UTC (the daily meter). */
export function dailySpentUsd(): number {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  let total = 0;
  for (const r of state.requests.values()) if (!r.free && r.status !== 'failed' && Date.parse(r.createdAt) >= since.getTime()) total += r.chargedUsd;
  return Math.round(total * 1e6) / 1e6;
}

/** Mock main-wallet balance (USD) for the Wallet panel and the balance alert. */
export const mockWallet = { balanceUsd: 12.5, spendingKey: null as string | null };

/** The backend's usage object (Handover "Usage banners"): daily + weekly caps, alert at 75/90/100%, balance alert. */
export function usage() {
  const daySpent = dailySpentUsd();
  const weekSpent = weeklySpentUsd();
  const left = (limit: number, spent: number) => Math.max(0, Math.round((limit - spent) * 1e6) / 1e6);
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  const daily = { spentUsd: daySpent, limitUsd: state.user.dailyLimitUsd, usedPct: pctOf(daySpent, state.user.dailyLimitUsd), remainingUsd: left(state.user.dailyLimitUsd, daySpent), resetsAt: tomorrow.toISOString() };
  const weekly = { spentUsd: weekSpent, limitUsd: state.user.weeklyLimitUsd, usedPct: pctOf(weekSpent, state.user.weeklyLimitUsd), remainingUsd: left(state.user.weeklyLimitUsd, weekSpent) };
  const s = state.session && state.session.status === 'open' ? state.session : null;
  const deposit = s ? { channelId: s.channelId, depositUsd: s.depositUsd, spentUsd: s.spentUsd, remainingUsd: s.remainingUsd, usedPct: pctOf(s.spentUsd, s.depositUsd) } : null;
  const nextDepositUsd = Math.min(1, daily.remainingUsd, weekly.remainingUsd);
  const cap = daily.usedPct >= weekly.usedPct ? { meter: 'daily' as const, usedPct: daily.usedPct } : { meter: 'weekly' as const, usedPct: weekly.usedPct };
  const level = cap.usedPct >= 100 ? 'exhausted' : cap.usedPct >= 90 ? 'critical' : cap.usedPct >= 75 ? 'warning' : null;
  let alert: { level: string; meter: string; usedPct: number; action: string; message: string } | null = level
    ? {
        level,
        meter: cap.meter,
        usedPct: cap.usedPct,
        action: 'raise_limit',
        message:
          level === 'exhausted'
            ? cap.meter === 'daily'
              ? "You've reached today's spending cap"
              : "You've reached this week's spending cap"
            : `You've used ${String(cap.usedPct)}% of ${cap.meter === 'daily' ? "today's" : "this week's"} spending cap`,
      }
    : null;
  const lockedLeft = s ? s.remainingUsd : 0;
  if (alert?.level !== 'exhausted' && nextDepositUsd > 0 && lockedLeft < 0.01 && mockWallet.balanceUsd < nextDepositUsd) {
    alert = { level: mockWallet.balanceUsd === 0 ? 'exhausted' : 'critical', meter: 'balance', usedPct: 100, action: 'add_funds', message: mockWallet.balanceUsd === 0 ? 'Your wallet is empty' : 'Your wallet balance is low' };
  }
  return { daily, weekly, deposit, nextDepositUsd, alert };
}
