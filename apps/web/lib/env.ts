import { z } from 'zod';

/**
 * Public runtime config (Monad handoff, "Required production configuration").
 *
 * SmartRouter runs on Monad mainnet (chain 143). The browser needs four public values: the API
 * base URL, the chain id, a public Monad RPC URL and the Privy app id (`smartmon`). The frontend
 * needs no secrets at all. Tempo is backend infrastructure only (the provider-payment hot wallet),
 * so nothing Tempo-related is configured here. Everything else is optional tooling (Sentry,
 * feature flags, the offline mock switch for development and tests).
 *
 * Each key is referenced literally so Next.js can inline it into the client bundle.
 */
const booleanFlag = z
  .enum(['0', '1', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

/** Monad handoff: mainnet is chain 143 (`monad` in `viem/chains`). */
export const MONAD_CHAIN_ID = 143;
export const DEFAULT_RPC_URL = 'https://rpc.monad.xyz';
export const DEFAULT_EXPLORER_URL = 'https://monadscan.com';

const schema = z.object({
  apiUrl: z.string().url().transform((u) => u.replace(/\/+$/, '')),
  chainId: z.coerce.number().int().positive().default(MONAD_CHAIN_ID),
  rpcUrl: z.string().url().default(DEFAULT_RPC_URL),
  /** Monad handoff: Privy app `smartmon`. Public — never the app secret. */
  privyAppId: z.string().min(1),
  objectStorageHost: z.string().optional().transform((s) => s ?? ''),
  sentryDsn: z.string().optional().transform((s) => s ?? ''),
  flagCompare: booleanFlag,
  flagMusic: booleanFlag,
  mock: booleanFlag,
});

export type Env = z.output<typeof schema>;

const raw = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID || undefined,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || undefined,
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  objectStorageHost: process.env.NEXT_PUBLIC_OBJECT_STORAGE_HOST,
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  flagCompare: process.env.NEXT_PUBLIC_FLAG_COMPARE ?? '1',
  flagMusic: process.env.NEXT_PUBLIC_FLAG_MUSIC ?? '1',
  mock: process.env.NEXT_PUBLIC_MOCK ?? '0',
};

function parseEnv(input: unknown): Env {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  NEXT_PUBLIC_${camelToScreaming(String(i.path[0] ?? '?'))}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid public environment (see apps/web/.env.example):\n${issues}`);
  }
  return result.data;
}

function camelToScreaming(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toUpperCase();
}

export const env: Env = parseEnv(raw);
