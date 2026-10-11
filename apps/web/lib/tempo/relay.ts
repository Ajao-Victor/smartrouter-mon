/**
 * Signing and the fee relay (Handover "Wallet → Signing and the fee relay"): Tempo transactions
 * signed by the Privy raw-signer account and routed through SmartRouter's `/relay`, so the hot
 * wallet pays every network fee. Used for authorizing the spending key and for wallet sends.
 */
import { createClient, http } from 'viem';
import { withRelay } from 'viem/tempo';

import { getSessionToken } from '@/lib/auth/session';
import { env } from '@/lib/env';

import { chainFor } from './chain';
import { getPrivyAccount } from './privyWallet';

/** viem client: Privy account + `withRelay(public RPC, /relay)` (sign-only: the relay pays the fee). */
export async function rootRelayClient(chainId?: number | null) {
  const account = await getPrivyAccount();
  const token = getSessionToken() ?? '';
  return createClient({
    chain: chainFor(chainId ?? env.chainId),
    account: account as never, // Privy bundles its own viem types; same runtime account.
    transport: withRelay(http(env.rpcUrl), http(`${env.apiUrl}/relay`, { fetchOptions: { headers: { 'X-Session-Token': token } } }), { policy: 'sign-only' }),
  });
}
