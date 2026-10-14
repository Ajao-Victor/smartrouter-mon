/**
 * Deposits from other chains through Aurora Intents Connect (NEAR Intents), landing straight in the
 * AI balance. The backend hands the recipe out in `GET /wallet/options → aurora`:
 *
 *   - destination: Circle USDC on Monad;
 *   - steps, run on Monad by Aurora's intermediary once the bridge settles:
 *     `USDC.approve(vault, {MIN_AMOUNT_OUT})` then `vault.depositFor(user, {MIN_AMOUNT_OUT})`;
 *   - `apiKeyProxyPath` (`/aurora/`): create calls go through the SmartRouter API, which adds the
 *     Aurora API key and rejects any other steps. Everything else goes to `baseUrl` directly.
 *
 * The origin wallet is the user's Privy embedded wallet (same EVM address on every EVM chain); it
 * signs the execution with `personal_sign` (erc191). The deposit itself is a plain USDC transfer to
 * the address Aurora returns after the signature, from any wallet on the chosen chain, so EVM
 * source chains only (no Solana wallet here).
 */
import type { Hex } from 'viem';

import { apiRequest, apiUrl, ApiError } from '@/lib/api/client';
import type { AuroraRecipe } from '@/lib/api/types';
import { env } from '@/lib/env';

import type { AuroraPhase } from '@/stores/depositStore';

import { getPrivyWallet } from './privyWallet';

/** The SDK's amount placeholder, templated into the recipe steps. */
export const AMOUNT_PLACEHOLDER = '{MIN_AMOUNT_OUT}';

/** EVM source chains the SDK knows (NEAR Intents chain names). Solana needs its own wallet. */
const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'op', 'pol', 'bsc', 'avax', 'gnosis', 'bera', 'monad']);

export function auroraSourceChains(recipe: AuroraRecipe): { chain: string; name: string }[] {
  return recipe.chains.filter((c) => EVM_CHAINS.has(c.chain));
}

/** The recipe's steps with the amount (literal or placeholder) templated in. */
export function buildAuroraSteps(recipe: AuroraRecipe, amount: string) {
  return recipe.steps.map((s) => ({
    to: s.to,
    functionSignature: s.functionSignature,
    parameters: s.parameters.map((p) => (p === AMOUNT_PLACEHOLDER ? amount : p)),
    value: s.value,
  }));
}

/** Collapses the SDK lifecycle into the panel's phases. */
export function toAuroraPhase(phase: string): AuroraPhase {
  switch (phase) {
    case 'resolving-identity':
    case 'planning':
    case 'creating':
      return 'preparing';
    case 'awaiting-signature':
    case 'submitting':
      return 'signing';
    case 'awaiting-deposit':
    case 'settling':
    case 'expired':
    case 'success':
    case 'failed':
      return phase;
    default:
      return 'idle';
  }
}

/** Whole USD → atomic units of a token with `decimals` (USDC: 6). */
export function toAtomic(amountUsd: number, decimals: number): string {
  const [whole = '0', frac = ''] = amountUsd.toFixed(Math.min(decimals, 6)).split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals)).toString();
}

interface SupportedToken {
  assetId?: string;
  blockchain?: string;
  contractAddress?: string;
  decimals?: number;
  symbol?: string;
}

/** USDC on the origin chain, from Aurora's supported-token list. */
export function findOriginUsdc(tokens: readonly SupportedToken[], chain: string): { assetId: string; contractAddress: string; decimals: number } | null {
  const t = tokens.find((x) => x.blockchain?.toLowerCase() === chain && x.symbol?.toUpperCase() === 'USDC' && x.assetId && x.contractAddress);
  return t?.assetId && t.contractAddress ? { assetId: t.assetId, contractAddress: t.contractAddress, decimals: t.decimals ?? 6 } : null;
}

export interface AuroraUpdate {
  phase?: AuroraPhase;
  executionId?: string;
  depositAddress?: string;
  deadline?: string | null;
}

export interface AuroraDepositInput {
  recipe: AuroraRecipe;
  /** The `/auth/privy` address (the Privy embedded wallet). */
  address: string;
  /** Source chain (NEAR Intents name, e.g. `base`). */
  chain: string;
  amountUsd: number;
  onUpdate: (u: AuroraUpdate) => void;
}

export interface AuroraHandle {
  done: Promise<void>;
  cancel: () => void;
}

const fail = (message: string) => new ApiError({ status: 0, code: 'PROVIDER_UNAVAILABLE', message });

/** Starts an Aurora bridge-in to the AI balance. `done` settles on success; it rejects on failure. */
export function startAuroraDeposit(input: AuroraDepositInput): AuroraHandle {
  return env.mock ? mockDeposit(input) : realDeposit(input);
}

function realDeposit({ recipe, address, chain, amountUsd, onUpdate }: AuroraDepositInput): AuroraHandle {
  let dispose: (() => void) | null = null;
  const flag = { cancelled: false };
  const done = (async () => {
    if (!recipe.available || !recipe.baseUrl) throw fail('Deposits from other chains are not available yet.');
    const wallet = getPrivyWallet(address);
    if (!wallet) throw new ApiError({ status: 0, code: 'FORBIDDEN', message: 'Your SmartRouter wallet is not connected in this browser. Sign out and back in.' });
    onUpdate({ phase: 'preparing' });
    const sdk = await import('@aurora-is-near/intents-connect');
    const proxy = apiUrl(recipe.apiKeyProxyPath);
    // Create calls go through our proxy and need the session header; the rest go to Aurora as-is.
    const fetchLike = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
      url.startsWith(proxy) ? apiRequest(url.slice(env.apiUrl.length), { ...init }) : fetch(url, init);
    const api = sdk.createIntentsConnectApi({ baseUrl: recipe.baseUrl, apiKeyProxyUrl: proxy, fetch: fetchLike });
    const tokens = await api.listSupportedTokens('inOperation');
    const origin = findOriginUsdc(tokens.in ?? [], chain);
    if (!origin) throw fail(`USDC on ${chain} isn't supported for deposits right now. Pick another chain.`);
    if (flag.cancelled) return;
    const runner = sdk.createExecutionRunner({
      api,
      wallet: {
        id: 'privy',
        name: 'SmartRouter wallet',
        chains: [chain],
        signingStandard: 'erc191',
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        getAddress: () => address,
        getProviders: () => ({ evm: async () => (await wallet.getEthereumProvider()) as { request: (r: { method: string; params?: unknown[] | object }) => Promise<unknown> } }),
      },
      onEvent: (e) => {
        if (e.type === 'phase') onUpdate({ phase: toAuroraPhase(e.phase) });
        else if (e.type === 'created') onUpdate({ executionId: e.executionId });
        else if (e.type === 'deposit-address') onUpdate({ depositAddress: e.address, deadline: e.deadline ?? null });
      },
    });
    dispose = () => {
      runner.dispose();
    };
    const execution = await runner.run({
      recipe: {
        id: 'smartrouter-deposit',
        intent: recipe.metadata.intent,
        title: recipe.metadata.title,
        flow: 'bridge-in',
        type: 'evm',
        destination: { chain: recipe.destination.chain, assetId: recipe.destination.assetId, tokenAddress: recipe.destination.tokenAddress },
        buildSteps: ({ amount }) => buildAuroraSteps(recipe, amount),
      },
      params: undefined,
      quote: { originAsset: origin.assetId, destinationAsset: recipe.destination.assetId, amount: toAtomic(amountUsd, origin.decimals), swapType: 'EXACT_INPUT', slippageTolerance: 100 },
      originChain: chain,
      originToken: { contractAddress: origin.contractAddress, decimals: origin.decimals },
      depositViaWallet: false,
    });
    if (execution.status !== 'SUCCESS') throw fail('The cross-chain deposit did not complete. Any funds sent are refunded by Aurora.');
    onUpdate({ phase: 'success' });
  })();
  return {
    done,
    cancel: () => {
      flag.cancelled = true;
      dispose?.();
    },
  };
}

/** `NEXT_PUBLIC_MOCK=1`: the same phases against the MSW `/aurora/*` proxy (no real bridge). */
function mockDeposit({ recipe, address, amountUsd, onUpdate }: AuroraDepositInput): AuroraHandle {
  const flag = { cancelled: false };
  const stopped = () => flag.cancelled;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const done = (async () => {
    onUpdate({ phase: 'preparing' });
    const res = await apiRequest(`${recipe.apiKeyProxyPath.replace(/\/?$/, '/')}api/v1/executions/${address}`, {
      method: 'POST',
      body: JSON.stringify({ steps: buildAuroraSteps(recipe, toAtomic(amountUsd, 6)), quote: { destinationAsset: recipe.destination.assetId } }),
    });
    if (!res.ok) throw fail('Deposits from other chains are not available yet.');
    const { id, depositAddress } = (await res.json()) as { id: string; depositAddress: Hex };
    onUpdate({ executionId: id, phase: 'signing' });
    await wait(400);
    if (stopped()) return;
    onUpdate({ phase: 'awaiting-deposit', depositAddress, deadline: new Date(Date.now() + 30 * 60_000).toISOString() });
    await wait(2500);
    if (stopped()) return;
    onUpdate({ phase: 'settling' });
    await wait(1500);
    if (stopped()) return;
    onUpdate({ phase: 'success' });
  })();
  return {
    done,
    cancel: () => {
      flag.cancelled = true;
    },
  };
}
