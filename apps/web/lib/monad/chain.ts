import type { Chain } from 'viem';
import { monad } from 'viem/chains';

import { env } from '@/lib/env';

/**
 * Monad mainnet (chain 143) from `viem/chains`, on the configured public RPC. The handoff: every
 * wallet signature targets this chain; the user never switches to Tempo.
 */
export const chain: Chain = { ...monad, id: env.chainId, rpcUrls: { ...monad.rpcUrls, default: { http: [env.rpcUrl] } } };
