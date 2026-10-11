/**
 * The user's Privy embedded wallet, exposed to non-React code. The Privy bridge
 * (`components/auth/AuthProvider`) registers a getter over `useWallets()`; wallet actions read it
 * with `getPrivyWallet()` (Handover: `wallets.find((w) => w.walletClientType === 'privy')`).
 *
 * `getPrivyAccount()` turns it into the "raw-signer" viem account (Privy's Tempo guide, option 1)
 * that signs Tempo transactions: authorizing the spending key and wallet sends. Answers are never
 * signed by Privy — the spending key signs those.
 */
import { ApiError } from '@/lib/api/client';

export interface EmbeddedWallet {
  address: string;
  walletClientType: string;
  getEthereumProvider: () => Promise<unknown>;
  switchChain?: (chainId: number) => Promise<void>;
}

let getter: (() => readonly EmbeddedWallet[]) | null = null;

export function registerPrivyWallets(fn: (() => readonly EmbeddedWallet[]) | null): void {
  getter = fn;
}

export function getPrivyWallet(): EmbeddedWallet | null {
  return getter?.().find((w) => w.walletClientType === 'privy') ?? null;
}

/** Privy's viem account for the embedded wallet (signs Tempo 0x76 transactions). */
export async function getPrivyAccount() {
  const wallet = getPrivyWallet();
  if (!wallet) throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sign in again to use your wallet.' });
  const { toViemAccount } = await import('@privy-io/react-auth');
  return toViemAccount({ wallet: wallet as unknown as Parameters<typeof toViemAccount>[0]['wallet'] });
}
