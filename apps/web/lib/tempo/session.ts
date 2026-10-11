/**
 * Paying for runs (Handover "Paying for runs → Paid answers").
 *
 * 1. A viem client with the spending key as its account — no Privy involvement per message.
 * 2. A `sessionManager` with the key and `maxDeposit` = `suggestedDepositUsd` from
 *    `GET /sessions/current` ($1, or less if that's all that's left of today's or this week's cap).
 * 3. Paid runs go through `manager.fetch`. The first one locks that amount in Tempo's payment
 *    contract; each answer after that signs a voucher silently.
 * 4. When the locked amount runs out (`exceeds local maxDeposit`, or `/run` answers
 *    402 ALLOCATION_EXHAUSTED): ask `/sessions/current` again and create a new manager with the new
 *    `suggestedDepositUsd`. Don't close the old one — the backend returns its leftover.
 * 5. `suggestedDepositUsd` of 0 means a cap is reached: show the cap banner instead of paying.
 *
 * One paid run at a time: calls are queued (`paidRun`) so a second Send waits instead of failing;
 * the lock lifts as soon as the answer starts streaming.
 */
import { sessionManager } from 'mppx/client';
import { createClient, http } from 'viem';

import { ApiError, apiRequest } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { env } from '@/lib/env';
import { toUsdString } from '@/lib/money';

import { chainFor } from './chain';
import { keyAccount, loadKeyPair } from './spendingKey';

export type SessionManager = ReturnType<typeof sessionManager>;

/** Handover: `fetch: (url, init) => api(String(url).replace(API_URL, ''), init)` — adds X-Session-Token. */
const managerFetch: typeof fetch = (input, init) => {
  if (input instanceof Request) return apiRequest(input.url.replace(env.apiUrl, ''), { method: input.method, headers: input.headers, ...init });
  return apiRequest(String(input).replace(env.apiUrl, ''), init);
};

interface Current {
  manager: SessionManager;
  address: string;
}

let current: Current | null = null;
let last: Promise<unknown> = Promise.resolve();

/** No spending key in this browser (or it isn't active): run the one-time setup first. */
export class SpendingKeyMissing extends ApiError {
  constructor() {
    super({ status: 0, code: 'SPENDING_KEY_MISSING', message: 'Set up your spending key to pay for answers (one signature, no fee).' });
  }
}

/** `suggestedDepositUsd` is 0: a daily or weekly cap is reached. */
export class CapReached extends ApiError {
  constructor(details?: unknown) {
    super({ status: 403, code: 'SPENDING_CAP_REACHED', message: "You've reached your spending cap. Raise it in settings or use the free model.", details });
  }
}

/** A new manager on the spending key, sized to the next automatic deposit. */
async function newManager(address: string): Promise<SessionManager> {
  const keyPair = await loadKeyPair(address);
  if (!keyPair) throw new SpendingKeyMissing();
  const { suggestedDepositUsd, network, usage } = await api.sessions.current();
  if (suggestedDepositUsd <= 0) throw new CapReached({ usage });
  const key = keyAccount(keyPair, address);
  const chain = chainFor(network?.chainId ?? env.chainId);
  const keyClient = createClient({ chain, account: key, transport: http(env.rpcUrl) });
  // mppx bundles its own viem types; the runtime objects are the same. (Without these casts tsc
  // overflows its stack comparing the two copies of viem's Client type.)
  const manager = sessionManager({
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    account: key as never,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    client: keyClient as never,
    maxDeposit: toUsdString(suggestedDepositUsd), // e.g. '1' = $1 of USDC.e
    fetch: managerFetch,
    allowedChainIds: [chain.id],
  });
  current = { manager, address };
  return manager;
}

async function managerFor(address: string): Promise<SessionManager> {
  if (current && current.address.toLowerCase() === address.toLowerCase()) return current.manager;
  return newManager(address);
}

/** Forget the manager (sign-out, or after the spending key changed). */
export function resetSession(): void {
  current = null;
  last = Promise.resolve();
}

const exhausted = (err: unknown) => /exceeds local maxDeposit/i.test(String(err instanceof Error ? err.message : err));

async function isAllocationExhausted(res: Response): Promise<boolean> {
  if (res.status !== 402) return false;
  try {
    const body = (await res.clone().json()) as { code?: string };
    return body.code === 'ALLOCATION_EXHAUSTED';
  } catch {
    return false;
  }
}

/** One paid run: on exhaustion, the next automatic deposit (a new manager) and one retry. */
async function paidOnce(address: string, path: string, init?: RequestInit): Promise<Response> {
  const url = `${env.apiUrl}${path}`;
  let manager = await managerFor(address);
  try {
    const res = await manager.fetch(url, init);
    if (!(await isAllocationExhausted(res))) return res;
  } catch (err) {
    if (!exhausted(err)) throw err;
  }
  manager = await newManager(address); // next automatic deposit
  return manager.fetch(url, init);
}

/**
 * `paidRun`: queue paid calls; the next run waits for this one's payment step only, not for its
 * whole stream. On mocks the request is a plain `apiRequest` (MSW answers).
 */
export function paidFetch(path: string, init: RequestInit | undefined, address: string): Promise<Response> {
  if (env.mock) return apiRequest(path, init);
  const res = last.then(() => paidOnce(address, path, init));
  last = res.catch(() => undefined);
  return res;
}

export { toPaymentError } from './paymentErrors';
