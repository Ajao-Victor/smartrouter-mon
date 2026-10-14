/**
 * Live API contract — SmartRouter on Monad (Monad handoff and the backend routes it cites),
 * built on "SmartRouter Frontend Architecture" (Oct 9, 2026).
 *
 * Money arrives as USD decimals (`priceUsd`, `depositUsd`, `chargedUsd` …) and is converted to
 * branded integer micro-USD on parse. Field names follow the PDF; where the PDF names a value
 * without spelling its key (e.g. "the user: address, slider, allocation, weekly limit"), the
 * schema accepts the obvious spellings and normalises them, so one backend rename never breaks
 * the UI. Every assumption is marked `ASSUMPTION`.
 */
import { z } from 'zod';

import { micro, parseUsd, type MicroUsd } from '@/lib/money';

/* ---------------------------------- primitives --------------------------------- */

/** USD decimal (number or numeric string) → micro-USD. */
export const usdSchema = z.union([z.number(), z.string()]).transform((v): MicroUsd => parseUsd(v));
const usdOrZero = usdSchema.nullish().transform((v) => v ?? micro(0));

export const taskTypeSchema = z.enum(['chat', 'writing', 'coding', 'research', 'translation', 'image', 'music']);
export type TaskType = z.infer<typeof taskTypeSchema>;
export const TASK_TYPES = taskTypeSchema.options;

/** Slider presets (PDF weights q,p,s): cheapest (0.2,0.7,0.1) · balanced (0.45,0.4,0.15) · best (0.8,0.1,0.1). */
export const sliderPresetSchema = z.enum(['cheapest', 'balanced', 'best']);
export type SliderPreset = z.infer<typeof sliderPresetSchema>;

export const SLIDER_WEIGHTS: Record<SliderPreset, { quality: number; price: number; speed: number }> = {
  cheapest: { quality: 0.2, price: 0.7, speed: 0.1 },
  balanced: { quality: 0.45, price: 0.4, speed: 0.15 },
  best: { quality: 0.8, price: 0.1, speed: 0.1 },
};

/**
 * ASSUMPTION: the PDF only says `slider?`. We send the preset name and accept either a preset
 * name or a 0..1 number back (0 = cheapest, 1 = best quality).
 */
export const sliderSchema = z.preprocess((v) => {
  if (typeof v === 'number') return v < 0.34 ? 'cheapest' : v < 0.67 ? 'balanced' : 'best';
  return v;
}, sliderPresetSchema);

/** PDF free model id (`modelId: 'free:llama-3.1-8b'`). */
export const FREE_MODEL_ID = 'free:llama-3.1-8b';
export const FREE_MODEL_LABEL = 'Free · Llama 3.1 8B';
/** PDF: 30 free messages per user per day. */
export const FREE_MESSAGES_PER_DAY = 30;

/** Pick the first present key from a list of spellings. */
function alias(aliases: Record<string, readonly string[]>) {
  return (input: unknown): unknown => {
    if (!input || typeof input !== 'object') return input;
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = { ...src };
    for (const [to, from] of Object.entries(aliases)) {
      if (out[to] !== undefined) continue;
      for (const key of from) {
        if (src[key] !== undefined) {
          out[to] = src[key];
          break;
        }
      }
    }
    return out;
  };
}

const isoDate = z.string();

/* ------------------------------------- auth ------------------------------------ */

/** `POST /auth/privy { identityToken }` (Handover "Sign-in flow", step 3). */
export interface PrivySignInInput {
  identityToken: string;
}
/** → `{ userId, address, email, loginMethod, token, expiresAt }`; `address` is the Privy embedded wallet on Monad that must sign. */
export const privySignInSchema = z.object({
  userId: z.string(),
  address: z.string(),
  email: z.string().nullish().transform((v) => v ?? null),
  loginMethod: z.string().nullish().transform((v) => v ?? null),
  token: z.string().min(1),
  expiresAt: isoDate.nullish().transform((v) => v ?? null),
});
export type PrivySignIn = z.output<typeof privySignInSchema>;

/* ------------------------------------ usage ------------------------------------ */

/**
 * Handover "Usage banners": the same `usage` object comes from `GET /me`, `GET /wallet` (as
 * `caps`), `GET /sessions/current`, the paid `meta` event and the `done` event. The backend
 * computes the banner; the UI renders `usage.alert` and the two cap bars.
 *
 * Parsed leniently on purpose: an unknown meter or action from a newer backend must never break
 * `/me` (that once left the signed-in app stuck on a skeleton).
 */
export const usageAlertSchema = z.object({
  level: z.enum(['warning', 'critical', 'exhausted']),
  /** `daily` / `weekly` = spending caps; `balance` = the wallet can't fund the next deposit. */
  meter: z.string().default('daily'),
  usedPct: z.number().default(0),
  message: z.string().default(''),
  /** `raise_limit` → "Raise cap" (settings); `add_funds` → "Add funds" (Deposit panel). */
  action: z.string().default('raise_limit'),
});
export type UsageAlert = z.output<typeof usageAlertSchema>;

const capMeterSchema = z.object({
  spentUsd: usdOrZero,
  limitUsd: usdOrZero,
  usedPct: z.number().default(0),
  remainingUsd: usdOrZero,
  resetsAt: isoDate.nullish().transform((v) => v ?? null),
});
export type CapMeter = z.output<typeof capMeterSchema>;

export const usageSchema = z.object({
  daily: capMeterSchema.nullish().transform((v) => v ?? null),
  weekly: capMeterSchema.nullish().transform((v) => v ?? null),
  /** The AI balance in SmartRouterVault: USDC held, answered-but-unsettled, and what's spendable. */
  deposit: z
    .object({ channelId: z.string().nullish(), depositUsd: usdOrZero, spentUsd: usdOrZero, remainingUsd: usdOrZero, usedPct: z.number().default(0) })
    .nullish()
    .transform((v) => v ?? null),
  /** Suggested top-up of the AI balance (capped by what's left of today's and this week's caps). */
  nextDepositUsd: usdSchema.nullish().transform((v) => v ?? null),
  alert: usageAlertSchema.nullish().catch(null).transform((v) => v ?? null),
});
export type Usage = z.output<typeof usageSchema>;

/* ------------------------------------ users ------------------------------------ */

/** `PATCH /me/settings` → the updated settings (and `GET /me` nests the same object). */
export const settingsSchema = z.preprocess(
  alias({
    dailyLimitUsd: ['dailyLimit', 'daily_limit', 'daily_limit_usd'],
    weeklyLimitUsd: ['weeklyLimit', 'weekly_limit', 'weekly_limit_usd'],
    autoFreeFallback: ['auto_free_fallback'],
  }),
  z.object({
    slider: sliderSchema.catch('balanced').default('balanced'),
    /** Daily spending cap (default $2, resets 00:00 UTC). */
    dailyLimitUsd: usdSchema.default(2),
    /** Weekly spending cap (default $10, last 7 days). */
    weeklyLimitUsd: usdSchema.default(10),
    autoFreeFallback: z.boolean().default(true),
    country: z.string().nullish().transform((v) => v ?? null),
    /** PATCH only: caps changed, so the vault's on-chain caps differ until Setup is re-signed. */
    vaultSetupNeeded: z.boolean().default(false),
  }),
);
export type Settings = z.output<typeof settingsSchema>;

/**
 * `GET /me` → `{ id, address, email, loginMethod, usage, settings }`. Settings are flattened onto
 * the user so screens read `user.slider`, `user.dailyLimitUsd` … directly.
 */
export const userSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== 'object') return v;
    const src = alias({ address: ['tempoAddress', 'tempo_address', 'wallet'], freeRemaining: ['freeRemainingToday', 'freeMessagesRemaining', 'freeLeft'] })(v) as Record<string, unknown>;
    const nested = src.settings && typeof src.settings === 'object' ? (src.settings as Record<string, unknown>) : {};
    return { ...src, ...nested };
  },
  z
    .object({
      id: z.string().nullish().transform((v) => v ?? null),
      address: z.string(),
      email: z.string().nullish().transform((v) => v ?? null),
      loginMethod: z.string().nullish().transform((v) => v ?? null),
      usage: usageSchema.nullish().catch(null).transform((v) => v ?? null),
      /** Free messages left today, when the backend includes it. */
      freeRemaining: z.number().int().nonnegative().nullish().transform((v) => v ?? null),
      /** Monad handoff §4: a working login has `network.chainId === 143`. */
      network: z.object({ chainId: z.number(), name: z.string().default('Monad') }).nullish().transform((v) => v ?? null),
      /** Whether the spending key and caps are registered in the vault. */
      spendingKey: z
        .object({ setupDone: z.boolean().default(false), address: z.string().nullish().transform((v) => v ?? null), expiresAt: isoDate.nullish().transform((v) => v ?? null) })
        .nullish()
        .catch(null)
        .transform((v) => v ?? null),
    })
    .and(settingsSchema),
);
export type User = z.output<typeof userSchema>;

/** `PATCH /me/settings { slider?, dailyLimitUsd?, weeklyLimitUsd? (0–1000), autoFreeFallback?, country? }`. */
export interface SettingsPatch {
  slider?: SliderPreset;
  dailyLimitUsd?: number;
  weeklyLimitUsd?: number;
  autoFreeFallback?: boolean;
  country?: string;
}

/* ------------------------------------ wallet ----------------------------------- */

/**
 * EIP-712 typed data the backend hands over for signing (`GET /wallet/setup`,
 * `POST /wallet/deposit/authorization`, `POST /wallet/send` → `typedData`, the 402 voucher).
 * Integer fields arrive as decimal strings and are kept exactly; they become `bigint` only for
 * the wallet call (Monad handoff §5.3).
 */
const typedFieldSchema = z.object({ name: z.string(), type: z.string() });
export const typedDataSchema = z.object({
  domain: z
    .object({
      name: z.string(),
      version: z.string(),
      chainId: z.coerce.number().int().positive(),
      verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    })
    .passthrough(),
  types: z.record(z.array(typedFieldSchema)),
  primaryType: z.string(),
  message: z.record(z.union([z.string(), z.number(), z.null()])),
});
export type TypedData = z.output<typeof typedDataSchema>;

/** `GET /wallet/setup?signer=` → the Setup typed data (spending key + caps), signed by the Privy wallet. */
export const setupRequestSchema = typedDataSchema.extend({ primaryType: z.literal('Setup') });
export type SetupRequest = z.output<typeof setupRequestSchema>;

/** `POST /wallet/deposit/authorization { amountUsd }` → ERC-3009 ReceiveWithAuthorization for Circle USDC. */
export const depositAuthorizationSchema = typedDataSchema.extend({ primaryType: z.literal('ReceiveWithAuthorization') });
export type DepositAuthorization = z.output<typeof depositAuthorizationSchema>;

/** `details.voucher` on 402 PAYMENT_REQUIRED: the Voucher to sign with the spending key. */
export const voucherChallengeSchema = typedDataSchema.extend({
  primaryType: z.literal('Voucher'),
  message: z.object({ user: z.string(), cumulativeAmount: z.union([z.string(), z.number()]).transform(String) }).catchall(z.union([z.string(), z.number(), z.null()])),
  header: z.string().default('x-smartrouter-voucher'),
});
export type VoucherChallenge = z.output<typeof voucherChallengeSchema>;

/** A relayed Monad transaction (`POST /wallet/setup`, `/wallet/deposit`, `/wallet/send/:id/sign`). */
export const relayedTxSchema = z
  .object({
    ok: z.boolean().default(true),
    txHash: z.string().nullish().transform((v) => v ?? null),
    explorerUrl: z.string().nullish().transform((v) => v ?? null),
    status: z.string().nullish().transform((v) => v ?? null),
  })
  .passthrough();
export type RelayedTx = z.output<typeof relayedTxSchema>;

/** `POST /wallet/deposit` → the new AI balance. */
export const depositResultSchema = relayedTxSchema.extend({
  ai: z.object({ depositUsd: usdOrZero, remainingUsd: usdOrZero }).nullish().transform((v) => v ?? null),
});
export type DepositResult = z.output<typeof depositResultSchema>;

/**
 * Spending key (`GET /wallet` → `spendingKey`): a browser-held key registered in
 * SmartRouterVault with the daily/weekly caps. `missing` / `expiring` / `unknown` → Set up.
 */
export const spendingKeySchema = z.object({
  /** `active` | `missing` | `expiring` | `unknown`. */
  status: z.string().default('missing'),
  address: z.string().nullish().transform((v) => v ?? null),
  expiresAt: isoDate.nullish().transform((v) => v ?? null),
  /** The caps the vault enforces on-chain (they can lag the settings until Setup is re-signed). */
  onChainCaps: z
    .object({ dailyUsd: usdOrZero, weeklyUsd: usdOrZero })
    .nullish()
    .transform((v) => v ?? null),
});
export type SpendingKeyState = z.output<typeof spendingKeySchema>;

/** The AI balance: the user's account in SmartRouterVault (`GET /wallet` → `ai`). */
const aiBalanceSchema = z.object({
  channelId: z.string().nullish().transform((v) => v ?? null),
  depositUsd: usdOrZero,
  spentUsd: usdOrZero,
  remainingUsd: usdOrZero,
});
export type AiBalance = z.output<typeof aiBalanceSchema>;

/** `GET /wallet` — the Wallet panel in one call. */
export const walletSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !('ai' in v) && 'locked' in v ? { ...v, ai: (v as { locked: unknown }).locked } : v),
  z.object({
    address: z.string(),
    network: z
      .object({ chainId: z.number(), name: z.string().default('Monad'), explorer: z.string().nullish().transform((v) => v ?? null) })
      .nullish()
      .transform((v) => v ?? null),
    token: z.object({ address: z.string(), symbol: z.string().default('USDC'), decimals: z.number().default(6) }),
    /** Circle USDC in the Privy wallet on Monad. */
    main: z.object({ balanceUsd: usdOrZero }),
    /** What answers are paid from. */
    ai: aiBalanceSchema.nullish().transform((v) => v ?? null),
    vault: z
      .object({ address: z.string(), ledger: z.string().nullish().transform((v) => v ?? null) })
      .nullish()
      .transform((v) => v ?? null),
    caps: usageSchema.nullish().catch(null).transform((v) => v ?? null),
    spendingKey: spendingKeySchema.nullish().catch(null).transform((v) => v ?? null),
    incomingUsd: usdOrZero,
    networkFees: z
      .object({ sponsoredPerDay: z.number().default(0), usedToday: z.number().default(0) })
      .passthrough()
      .nullish()
      .transform((v) => v ?? null),
    features: z
      .object({
        crossChain: z.boolean().default(false),
        /** Monad: `{ via: 'privy', chain: 'monad', token: 'USDC' }`; any value means card funding is on. */
        card: z.unknown().transform((v) => Boolean(v)),
        cashOut: z.boolean().default(false),
        /**
         * Whether sends need a 6-digit email code (backend SEND_CODE_REQUIRED; off since Oct 13).
         * `sentTo` is the masked email (null: no email).
         */
        sendCode: z
          .object({ required: z.boolean().default(false), sentTo: z.string().nullish().transform((v) => v ?? null), ttlMinutes: z.number().default(10) })
          .nullish()
          .catch(null)
          .transform((v) => v ?? null),
      })
      .default({}),
  }),
);
export type Wallet = z.output<typeof walletSchema>;

export const walletChainOptionSchema = z
  .object({
    chain: z.string(),
    chainId: z.number().nullish(),
    chainName: z.string().default(''),
    vmType: z.string().default('evm'),
    token: z.string(),
    tokenAddress: z.string().nullish(),
    method: z.string().default('direct'),
    depositAvailable: z.boolean().default(true),
    note: z.string().nullish(),
  })
  .passthrough();
export type WalletChainOption = z.output<typeof walletChainOptionSchema>;

/** `GET /wallet/options` → `deposit[]` (Monad direct, Aurora chains), `send[]`, `card` (Privy on Monad). */
export const walletOptionsSchema = z.object({
  deposit: z.array(walletChainOptionSchema).default([]),
  send: z.array(walletChainOptionSchema).default([]),
  card: z
    .object({ chain: z.string(), chainId: z.number().nullish(), token: z.string(), tokenAddress: z.string().nullish(), note: z.string().default('') })
    .passthrough()
    .nullish()
    .transform((v) => v ?? null),
});
export type WalletOptions = z.output<typeof walletOptionsSchema>;

/** Monad handoff: only Monad USDC can be sent (`chain` is the literal `monad`). */
export interface SendInput {
  chain: 'monad';
  token: 'USDC';
  to: string;
  amountUsd: number;
}

/** `POST /wallet/send/quote` — gasless on Monad, so no fees. */
export const sendQuoteSchema = z.object({
  sendUsd: z.number(),
  receiveUsd: z.number(),
  receiveMinUsd: z.number().nullish().transform((v) => v ?? null),
  bridgeFeeUsd: z.number().default(0),
  networkFeeUsd: z.number().default(0),
  etaSeconds: z.number().nullish().transform((v) => v ?? null),
});
export type SendQuote = z.output<typeof sendQuoteSchema>;

/** `POST /wallet/send/code` → the code is emailed; it is bound to this exact send. */
export const sendCodeSchema = z.object({
  verificationId: z.string(),
  sentTo: z.string().nullish().transform((v) => v ?? null),
  expiresAt: isoDate.nullish().transform((v) => v ?? null),
  attemptsAllowed: z.number().default(5),
  /** When the backend echoes codes (SEND_CODE_ECHO, development only). */
  devCode: z.string().nullish().transform((v) => v ?? null),
});
export type SendCode = z.output<typeof sendCodeSchema>;

/** `POST /wallet/send` body: the send plus the emailed code (only when codes are required). */
export interface ConfirmedSendInput extends SendInput {
  verificationId: string;
  code: string;
}

/** `POST /wallet/send` body: `{ chain, token, to, amountUsd }`, plus the code when required. */
export type SendRequest = SendInput | ConfirmedSendInput;

/**
 * `POST /wallet/send` → the ERC-3009 TransferWithAuthorization to sign with the Privy wallet,
 * then `POST /wallet/send/:id/sign { signature }` (the operator relays it; no gas for the user).
 */
export const sendPlanSchema = z.object({
  sendId: z.string(),
  chainId: z.number().nullish().transform((v) => v ?? null),
  typedData: typedDataSchema.extend({ primaryType: z.literal('TransferWithAuthorization') }),
  sendUsd: z.number().nullish(),
  receiveUsd: z.number().nullish(),
});
export type SendPlan = z.output<typeof sendPlanSchema>;

export const walletActivityItemSchema = z
  .object({
    id: z.string(),
    /** `deposit` · `send` · `to_ai_balance` · `from_ai_balance` · `answers_settled` … */
    type: z.string(),
    status: z.string(),
    amountUsd: z.number(),
    deliveredUsd: z.number().nullish(),
    chain: z.string().nullish(),
    token: z.string().nullish(),
    counterparty: z.string().nullish(),
    txHash: z.string().nullish(),
    explorerUrl: z.string().nullish(),
    at: isoDate,
    spentUsd: z.number().nullish(),
  })
  .passthrough();
export type WalletActivityItem = z.output<typeof walletActivityItemSchema>;

export const walletActivitySchema = z.object({
  items: z.array(walletActivityItemSchema).default([]),
  nextBefore: z.string().nullish().transform((v) => v ?? null),
});

/* ---------------------------------- catalogue ---------------------------------- */

/** `GET /catalog?taskType=` entry (all models by task, quality and price). */
/** Live `medianLatencyMs` → the PDF speed label. */
export function speedLabel(latencyMs: number | null): string | null {
  if (latencyMs === null) return null;
  if (latencyMs < 1_000) return 'fast';
  if (latencyMs < 3_000) return 'steady';
  return 'slow';
}

/** Live `GET /catalog` entry: `{ id, label, provider, taskTypes, free, web, priceEstimateUsd, medianLatencyMs, quality: { task: 0..1 } }`. */
export const catalogModelSchema = z.preprocess(
  (input) => {
    const v = alias({ modelId: ['id', 'model_id'], taskTypes: ['task_types', 'tasks'], priceUsd: ['priceEstimateUsd', 'price', 'price_usd', 'priceEstUsd'], free: ['isFree', 'is_free'], latencyMs: ['medianLatencyMs', 'latency'] })(input);
    if (!v || typeof v !== 'object') return v;
    const src = v as Record<string, unknown>;
    const q = src.quality;
    const quality = typeof q === 'number' ? q : q && typeof q === 'object' ? Math.max(0, ...Object.values(q as Record<string, unknown>).filter((n): n is number => typeof n === 'number')) : null;
    return { ...src, quality, qualityByTask: q && typeof q === 'object' ? q : null };
  },
  z
    .object({
      modelId: z.string(),
      label: z.string(),
      provider: z.string().default(''),
      taskTypes: z.array(z.string()).default([]),
      priceUsd: usdOrZero,
      quality: z.number().nullish().transform((v) => v ?? null),
      qualityByTask: z.record(z.number()).nullish().transform((v) => v ?? null),
      latencyMs: z.number().nullish().transform((v) => v ?? null),
      speed: z.string().nullish().transform((v) => v ?? null),
      web: z.boolean().default(false),
      free: z.boolean().default(false),
    })
    .transform((m) => ({ ...m, speed: m.speed ?? speedLabel(m.latencyMs) })),
);
export type CatalogModel = z.output<typeof catalogModelSchema>;
export const catalogSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v : (v as { models?: unknown; items?: unknown }).models ?? (v as { items?: unknown }).items ?? v),
  z.array(catalogModelSchema),
);

/* ------------------------------------ options ---------------------------------- */

/**
 * One recommended option (PDF `POST /chats` / `POST /recommend`): `quoteId`, `priceUsd`, `speed`,
 * `reason`, `free`. The three recommended models plus the free option.
 */
export const optionSchema = z.preprocess(
  alias({ modelId: ['model_id', 'id'], quoteId: ['quote_id'], priceUsd: ['price', 'price_usd'], free: ['isFree', 'is_free'], bestQuality: ['isBestQuality', 'is_best_quality', 'best'] }),
  z.object({
    modelId: z.string(),
    label: z.string().default(''),
    provider: z.string().default(''),
    quoteId: z.string().nullish().transform((v) => v ?? null),
    priceUsd: usdOrZero,
    speed: z.string().default('steady').transform((v) => v.toLowerCase()),
    reason: z.string().default(''),
    free: z.boolean().default(false),
    quality: z.number().nullish().transform((v) => v ?? null),
    bestQuality: z.boolean().default(false),
    expiresAt: isoDate.nullish().transform((v) => v ?? null),
  }),
);
export type Option = z.output<typeof optionSchema>;

export const recommendInputSchema = z.object({ prompt: z.string().min(1), slider: sliderPresetSchema.optional(), taskType: taskTypeSchema.optional() });
export type RecommendInput = z.input<typeof recommendInputSchema>;
export const recommendResponseSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { options: v } : v),
  z.object({
    options: z.array(optionSchema),
    taskType: taskTypeSchema.nullish().transform((v) => v ?? null),
    /** Handover "Guest mode": signed out → `guest: true` and no quotes (`quoteId: null`). */
    guest: z.boolean().default(false),
    freeRemainingToday: z.number().int().nonnegative().nullish().transform((v) => v ?? null),
    /** The router agent's decision: its keccak256 is the `routeHash` recorded on Monad. */
    router: z.object({ source: z.string().nullish(), routeHash: z.string().nullish(), ms: z.number().nullish() }).nullish().transform((v) => v ?? null),
  }),
);
export type RecommendResponse = z.output<typeof recommendResponseSchema>;

/* ------------------------------------ chats ------------------------------------ */

export const chatSchema = z.preprocess(
  alias({ id: ['chatId', 'chat_id'], taskType: ['task_type'], currentModelId: ['current_model_id'], updatedAt: ['lastMessageAt', 'updated_at'], createdAt: ['created_at'], messageCount: ['message_count'], spentUsd: ['spent', 'spent_usd'] }),
  z.object({
    id: z.string(),
    title: z.string().nullish().transform((v) => v ?? null),
    taskType: taskTypeSchema.nullish().transform((v) => v ?? 'chat'),
    slider: sliderSchema.nullish().transform((v) => v ?? null),
    currentModelId: z.string().nullish().transform((v) => v ?? null),
    updatedAt: isoDate.nullish().transform((v) => v ?? null),
    createdAt: isoDate.nullish().transform((v) => v ?? null),
    messageCount: z.number().int().nonnegative().nullish().transform((v) => v ?? null),
    spentUsd: usdOrZero,
  }),
);
export type Chat = z.output<typeof chatSchema>;

/** `GET /chats?cursor=` */
export const chatListSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { chats: v } : alias({ chats: ['items', 'data'], nextCursor: ['cursor', 'next', 'next_cursor'] })(v)),
  z.object({ chats: z.array(chatSchema), nextCursor: z.string().nullish().transform((v) => v ?? null) }),
);
export type ChatList = z.output<typeof chatListSchema>;

/** `POST /chats { taskType?, description?, slider? }` → `chatId`, `options[]`. */
export const createChatInputSchema = z.object({ taskType: taskTypeSchema.optional(), description: z.string().min(1).optional(), slider: sliderPresetSchema.optional() });
export type CreateChatInput = z.input<typeof createChatInputSchema>;
export const createChatResponseSchema = z.preprocess(
  alias({ chatId: ['id', 'chat_id'], taskType: ['task_type'] }),
  z.object({
    chatId: z.string(),
    options: z.array(optionSchema).default([]),
    taskType: taskTypeSchema.nullish().transform((v) => v ?? null),
    title: z.string().nullish().transform((v) => v ?? null),
    freeRemainingToday: z.number().int().nonnegative().nullish().transform((v) => v ?? null),
    /** The router agent's decision: its keccak256 is the `routeHash` recorded on Monad. */
    router: z.object({ source: z.string().nullish(), routeHash: z.string().nullish(), ms: z.number().nullish() }).nullish().transform((v) => v ?? null),
  }),
);
export type CreateChatResponse = z.output<typeof createChatResponseSchema>;

export const messageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const fileSchema = z.object({ url: z.string().url(), mime: z.string().default('application/octet-stream') });
export type FileRef = z.output<typeof fileSchema>;

function mimeFromUrl(url: string): string {
  if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url)) return 'audio/mpeg';
  if (/\.(png)(\?|$)/i.test(url)) return 'image/png';
  if (/\.(webp)(\?|$)/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

/** A file on a user message: `{ kind: 'file', ref: uploadId, mime, name, sizeBytes }`. */
export const messageAttachmentSchema = z.object({
  kind: z.string().default('file'),
  ref: z.string(),
  name: z.string().default('file'),
  mime: z.string().nullish().transform((v) => v ?? null),
  sizeBytes: z.number().nullish().transform((v) => v ?? null),
});
export type MessageAttachment = z.output<typeof messageAttachmentSchema>;

/** Live message: `{ id, seq, role, content, modelId, resultRef, attachments, status, createdAt }`. */
export const messageSchema = z.preprocess(
  (input) => {
    const v = alias({ id: ['messageId', 'message_id'], text: ['content', 'body'], modelId: ['model_id', 'model'], requestId: ['request_id'], createdAt: ['created_at'], chargedUsd: ['charged_usd', 'priceUsd', 'price'] })(input);
    if (!v || typeof v !== 'object') return v;
    const src = v as Record<string, unknown>;
    const ref = typeof src.resultRef === 'string' && src.resultRef ? src.resultRef : null;
    return { ...src, files: Array.isArray(src.files) ? src.files : ref ? [{ url: ref, mime: mimeFromUrl(ref) }] : [] };
  },
  z.object({
    id: z.string(),
    role: messageRoleSchema,
    text: z.string().default(''),
    modelId: z.string().nullish().transform((v) => v ?? null),
    requestId: z.string().nullish().transform((v) => v ?? null),
    createdAt: isoDate.nullish().transform((v) => v ?? null),
    chargedUsd: usdSchema.nullish().transform((v) => v ?? null),
    seq: z.number().nullish().transform((v) => v ?? null),
    files: z.array(fileSchema).default([]),
    /** Files the user attached to this message (`attachments[]` with `kind: 'file'`). */
    attachments: z
      .array(messageAttachmentSchema)
      .nullish()
      .catch(null)
      .transform((v) => (v ?? []).filter((a) => a.kind === 'file')),
    citations: z.array(z.unknown()).default([]),
    status: z.string().nullish().transform((v) => v ?? 'done'),
  }),
);
export type Message = z.output<typeof messageSchema>;

/** `GET /chats/:id` — history, paged with `before`. */
export const chatHistorySchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== 'object') return v;
    const src = v as Record<string, unknown>;
    const chat = (src.chat && typeof src.chat === 'object' ? src.chat : src) as Record<string, unknown>;
    return { ...chat, messages: src.messages ?? chat.messages ?? [], nextBefore: src.nextBefore ?? src.before ?? src.next_before ?? null, hasMore: src.hasMore ?? false };
  },
  z.intersection(
    chatSchema,
    z.object({ messages: z.array(messageSchema), nextBefore: z.string().nullish().transform((v) => v ?? null), hasMore: z.boolean().default(false) }),
  ),
);
export type ChatHistory = z.output<typeof chatHistorySchema>;

/** `PATCH /chats/:id { title?, slider?, currentModelId? }`. */
export interface ChatPatch {
  title?: string;
  slider?: SliderPreset;
  currentModelId?: string;
}

/* ------------------------------------ quotes ----------------------------------- */

/** `POST /chats/:id/quote { prompt, modelId? }` → `quoteId`, `priceUsd`, `free`, `expiresAt`, `suggestion?`. */
export const suggestionSchema = z.preprocess(
  alias({ modelId: ['model_id'], taskType: ['task_type'] }),
  z.object({
    modelId: z.string(),
    label: z.string().default(''),
    reason: z.string().default(''),
    taskType: taskTypeSchema.nullish().transform((v) => v ?? null),
  }),
);
export type Suggestion = z.output<typeof suggestionSchema>;

export const quoteSchema = z.preprocess(
  alias({ quoteId: ['id', 'quote_id'], priceUsd: ['price', 'price_usd'], expiresAt: ['expires_at'], modelId: ['model_id'], free: ['isFree', 'is_free'] }),
  z.object({
    quoteId: z.string(),
    priceUsd: usdOrZero,
    free: z.boolean().default(false),
    /** Valid for 5 minutes (PDF). */
    expiresAt: isoDate,
    modelId: z.string().nullish().transform((v) => v ?? null),
    label: z.string().nullish().transform((v) => v ?? null),
    suggestion: suggestionSchema.nullish().transform((v) => v ?? null),
    /** Files cut to fit the model's file budget (the user is told). */
    filesCut: z.array(z.string()).nullish().catch(null).transform((v) => v ?? []),
  }),
);
export type Quote = z.output<typeof quoteSchema>;

export const quoteInputSchema = z.object({ prompt: z.string().min(1), modelId: z.string().optional(), attachmentIds: z.array(z.string()).optional() });
export type QuoteInput = z.input<typeof quoteInputSchema>;

/* ---------------------------------- uploads ----------------------------------- */

/** `GET /uploads/limits` — for the attach button. */
export const uploadLimitsSchema = z.object({
  enabled: z.boolean().default(false),
  maxBytes: z.number().default(20 * 1024 * 1024),
  perDay: z.number().default(30),
  maxPerMessage: z.number().default(5),
  keepDays: z.number().default(30),
  accepted: z.string().default('PDF, Word (.docx), text, Markdown, CSV, JSON or code files'),
});
export type UploadLimits = z.output<typeof uploadLimitsSchema>;

/** `POST /uploads` → where to PUT the bytes (straight to storage). */
export const uploadTicketSchema = z.object({
  uploadId: z.string(),
  putUrl: z.string().url(),
  method: z.string().default('PUT'),
  headers: z.record(z.string()).default({}),
});
export type UploadTicket = z.output<typeof uploadTicketSchema>;

/** `POST /uploads/:id/complete` / `GET /uploads/:id`. */
export const uploadSchema = z.object({
  uploadId: z.string(),
  filename: z.string(),
  mime: z.string().default('application/octet-stream'),
  sizeBytes: z.number().default(0),
  status: z.string(),
  tokens: z.number().nullish().transform((v) => v ?? null),
  truncated: z.boolean().default(false),
  error: z.string().nullish().transform((v) => v ?? null),
  url: z.string().nullish().transform((v) => v ?? null),
});
export type Upload = z.output<typeof uploadSchema>;

/* ---------------------------------- sessions ----------------------------------- */

/** `GET /sessions/current` → `session`: the user's AI balance in SmartRouterVault. */
export const sessionSummarySchema = z.preprocess(
  alias({ depositUsd: ['deposit', 'deposit_usd'], spentUsd: ['spent', 'spent_usd'], remainingUsd: ['remaining', 'remaining_usd'], channelId: ['channel_id', 'id'], openedAt: ['opened_at', 'createdAt'] }),
  z.object({
    depositUsd: usdOrZero,
    spentUsd: usdOrZero,
    remainingUsd: usdOrZero,
    requests: z.number().int().nonnegative().default(0),
    channelId: z.string().nullish().transform((v) => v ?? null),
    status: z.string().nullish().transform((v) => v ?? 'open'),
    openedAt: isoDate.nullish().transform((v) => v ?? null),
    /** Sign the next voucher for this + the quoted price (micro-USD, decimal string). */
    nextVoucherBaseMicro: z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined ? null : String(v))),
    setupDone: z.boolean().default(false),
    signer: z.string().nullish().transform((v) => v ?? null),
    signerExpiresAt: isoDate.nullish().transform((v) => v ?? null),
  }),
);
export type SessionSummary = z.output<typeof sessionSummarySchema>;

/** `network` on `/sessions/current`: Monad, Circle USDC, the vault and ledger, the explorer. */
export const paymentNetworkSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { name: v } : v),
  z.object({
    name: z.string().nullish().transform((v) => v ?? null),
    chainId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    token: z.string().nullish().transform((v) => v ?? null),
    vault: z.string().nullish().transform((v) => v ?? null),
    ledger: z.string().nullish().transform((v) => v ?? null),
    operator: z.string().nullish().transform((v) => v ?? null),
    explorer: z.string().nullish().transform((v) => v ?? null),
  }),
);
export type PaymentNetwork = z.output<typeof paymentNetworkSchema>;

/** `GET /sessions/current` → `{ paidRunsEnabled, network, suggestedDepositUsd, usage, session }`. */
export const sessionsCurrentSchema = z.preprocess(
  alias({ suggestedDepositUsd: ['suggestedDeposit', 'suggested_deposit_usd'] }),
  z.object({
    /** Handover: false → hide paid models. */
    paidRunsEnabled: z.boolean().default(true),
    /** Suggested top-up of the AI balance; 0 = a cap is reached (show the cap banner, don't pay). */
    suggestedDepositUsd: usdSchema.default(1),
    network: paymentNetworkSchema.nullish().transform((v) => v ?? null),
    usage: usageSchema.nullish().catch(null).transform((v) => v ?? null),
    session: sessionSummarySchema.nullish().transform((v) => v ?? null),
  }),
);
export type SessionsCurrent = z.output<typeof sessionsCurrentSchema>;

/* ------------------------------ requests & receipts ---------------------------- */

export const requestStatusSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  z.enum(['pending', 'running', 'succeeded', 'failed', 'refunded', 'done', 'streaming']).transform((s) => (s === 'done' ? 'succeeded' : s === 'streaming' ? 'running' : s)),
);
export type RequestStatus = z.output<typeof requestStatusSchema>;

/** `GET /requests/:id` — a run and what it charged (refunds appear here). */
export const requestSchema = z.preprocess(
  (input) => {
    const v = alias({ requestId: ['id', 'request_id'], modelId: ['model_id'], chatId: ['chat_id'], refundedUsd: ['refunded_usd'], latencyMs: ['latency_ms', 'latency'], createdAt: ['created_at'], free: ['isFree', 'is_free'], compareGroup: ['compare_group'], txHash: ['tx_hash', 'settlementTx'], error: ['errorCode', 'errorMessage'] })(input);
    if (!v || typeof v !== 'object') return v;
    const src = v as Record<string, unknown>;
    // Live: `priceUsd` + `charged: boolean` (failed answers are refunded → charged false).
    const charged = src.charged;
    const price = src.priceUsd ?? src.price ?? 0;
    const chargedUsd = src.chargedUsd ?? src.charged_usd ?? (typeof charged === 'boolean' ? (charged ? price : 0) : price);
    const refundedUsd = src.refundedUsd ?? (charged === false && src.status !== 'pending' && src.status !== 'running' ? price : null);
    return { ...src, chargedUsd, refundedUsd, priceUsd: price };
  },
  z.object({
    requestId: z.string(),
    status: requestStatusSchema.default('succeeded'),
    modelId: z.string().nullish().transform((v) => v ?? null),
    label: z.string().nullish().transform((v) => v ?? null),
    chatId: z.string().nullish().transform((v) => v ?? null),
    priceUsd: usdOrZero,
    chargedUsd: usdOrZero,
    refundedUsd: usdSchema.nullish().transform((v) => v ?? null),
    latencyMs: z.number().nullish().transform((v) => v ?? null),
    text: z.string().nullish().transform((v) => v ?? null),
    files: z.array(fileSchema).default([]),
    citations: z.array(z.unknown()).default([]),
    error: z.string().nullish().transform((v) => v ?? null),
    fallbackReason: z.string().nullish().transform((v) => v ?? null),
    taskType: taskTypeSchema.nullish().transform((v) => v ?? null),
    free: z.boolean().default(false),
    createdAt: isoDate.nullish().transform((v) => v ?? null),
    finishedAt: isoDate.nullish().transform((v) => v ?? null),
    compareGroup: z.string().nullish().transform((v) => v ?? null),
    txHash: z.string().nullish().transform((v) => v ?? null),
    /** On-chain receipt in SmartRouterLedger, once the worker has recorded it. */
    routeHash: z.string().nullish().transform((v) => v ?? null),
    ledgerTx: z.string().nullish().transform((v) => v ?? null),
  }),
);
export type RequestRecord = z.output<typeof requestSchema>;

export const requestListSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { requests: v } : alias({ requests: ['items', 'data'], nextCursor: ['cursor', 'next', 'next_cursor'] })(v)),
  z.object({ requests: z.array(requestSchema), nextCursor: z.string().nullish().transform((v) => v ?? null) }),
);
export type RequestList = z.output<typeof requestListSchema>;

/* ---------------------------------- feedback ----------------------------------- */

/** `POST /feedback { requestId, rating: 1 | -1 }`. */
export interface FeedbackInput {
  requestId: string;
  rating: 1 | -1;
  /** EIP-712 Rating signed by the spending key: recorded on SmartRouterLedger. */
  signature?: string;
}

/** `POST /compare/vote { compareGroup, winnerRequestId, prompt }`. */
export interface CompareVoteInput {
  compareGroup: string;
  winnerRequestId: string;
  prompt: string;
  /** EIP-712 Vote signed by the spending key: recorded on SmartRouterLedger. */
  signature?: string;
}

/* ---------------------------------- waitlist ----------------------------------- */

/** `POST /waitlist { email, interest: 'naira' | 'credits', country? }`. */
export const waitlistInputSchema = z.object({
  email: z.string().email(),
  interest: z.enum(['naira', 'credits']),
  country: z.string().length(2).optional(),
});
export type WaitlistInput = z.input<typeof waitlistInputSchema>;

/* -------------------------------------- run ------------------------------------ */

/** `POST /run { quoteId, prompt, compareGroup? }` — same quoteId and exactly the quoted prompt. */
export interface RunInput {
  quoteId: string;
  prompt: string;
  compareGroup?: string;
}

/* ------------------------------------ errors ----------------------------------- */

/** PDF error codes (every error before a stream starts is `{ code, message, details? }`). */
export const API_ERROR_CODES = [
  'PAYMENT_REQUIRED',
  'ALLOCATION_EXHAUSTED',
  'SETUP_REQUIRED',
  'SPENDING_CAP_REACHED',
  'SEND_CODE_INVALID',
  'SEND_CODE_EXPIRED',
  'EMAIL_REQUIRED',
  'QUOTE_EXPIRED',
  'QUOTE_USED',
  'VALIDATION_FAILED',
  'FREE_LIMIT_REACHED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL',
] as const;
export type ServerErrorCode = (typeof API_ERROR_CODES)[number];

/** `details.freeFallback` on ALLOCATION_EXHAUSTED / SPENDING_CAP_REACHED: whether free is available and how many are left. */
export const freeFallbackSchema = z.preprocess(
  alias({ available: ['free', 'ok'], remaining: ['freeRemainingToday', 'left', 'messagesLeft', 'freeMessagesLeft'] }),
  z.object({ available: z.boolean().default(false), remaining: z.number().int().nonnegative().nullish().transform((v) => v ?? null), modelId: z.string().default(FREE_MODEL_ID), auto: z.boolean().default(false) }),
);
export type FreeFallback = z.output<typeof freeFallbackSchema>;
