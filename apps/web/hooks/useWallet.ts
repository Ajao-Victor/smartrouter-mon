'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import type { SendInput, SendRequest, Wallet } from '@/lib/api/types';
import { setExplorerBase } from '@/lib/explorer';
import { setContracts } from '@/lib/monad/contracts';
import { toPaymentError } from '@/lib/monad/paymentErrors';

import { selectIsSignedIn, useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { useUsageStore } from '@/stores/usageStore';

const message = (err: unknown) => {
  const e = isApiError(err) ? err : toPaymentError(err);
  return e ? e.message : err instanceof Error ? err.message : undefined;
};
const cancelled = (err: unknown) => toPaymentError(err)?.code === 'PAYMENT_CANCELLED';

/**
 * `GET /wallet` — the whole Wallet panel from one call: USDC on Monad, the AI balance in the vault,
 * caps, spending key. Refreshed after every deposit, send and paid answer, when the window regains
 * focus, every 30 s while the Wallet panel is open (10 s on Deposit), and by the refresh button.
 * Also the runtime source of the vault/USDC addresses and the explorer (Monad handoff §1).
 */
export function useWallet(options: { enabled?: boolean; pollMs?: number | false } = {}) {
  const signedIn = useAuthStore(selectIsSignedIn);
  const query = useQuery({
    queryKey: queryKeys.wallet.get(),
    queryFn: async ({ signal }) => {
      const w = await api.wallet.get(signal);
      if (w.caps) useUsageStore.getState().setUsage(w.caps);
      setContracts({ usdc: w.token.address, vault: w.vault?.address ?? null, ledger: w.vault?.ledger ?? null });
      setExplorerBase(w.network?.explorer);
      return w;
    },
    enabled: signedIn && (options.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: options.pollMs ?? false,
    refetchOnWindowFocus: true,
  });
  return query;
}

export function useWalletOptions(enabled = true) {
  const signedIn = useAuthStore(selectIsSignedIn);
  return useQuery({ queryKey: queryKeys.wallet.options(), queryFn: ({ signal }) => api.wallet.options(signal), enabled: signedIn && enabled, staleTime: 5 * 60_000 });
}

/** `GET /wallet/activity` (newest first). */
export function useWalletActivity(enabled = true) {
  const signedIn = useAuthStore(selectIsSignedIn);
  return useQuery({ queryKey: queryKeys.wallet.activity(), queryFn: ({ signal }) => api.wallet.activity(null, signal), enabled: signedIn && enabled, staleTime: 15_000 });
}

/** "Return to wallet": `POST /wallet/locked/return` releases the AI balance from the vault. */
export function useReturnLocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.wallet.returnLocked(),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
      if (r.returnedUsd > 0) toast.success(`$${r.returnedUsd.toFixed(2)} returned to your wallet`);
      else toast.info('Nothing to return right now', r.skipped?.[0]);
    },
    onError: (err) => {
      toast.error('Could not return your AI balance', message(err));
    },
  });
}

/**
 * Top up the AI balance (Monad handoff §5.4): Circle USDC in the wallet → SmartRouterVault with one
 * Privy signature (ERC-3009 ReceiveWithAuthorization). SmartRouter pays the MON gas.
 */
export function useDepositToAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ wallet, amountUsd }: { wallet: Wallet; amountUsd: number }) => {
      const { depositToAiBalance } = await import('@/lib/monad/walletActions');
      return depositToAiBalance(wallet.address, amountUsd);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
      toast.success('Added to your AI balance', r.ai ? `$${(r.ai.remainingUsd / 1e6).toFixed(2)} ready for answers` : undefined);
    },
    onError: (err) => {
      if (cancelled(err)) {
        toast.info('Cancelled', 'Nothing was moved.');
        return;
      }
      console.error('[SmartRouter] AI balance top-up failed', err);
      toast.error('Could not top up your AI balance', message(err));
    },
  });
}

/** `POST /wallet/send/quote` — what arrives (gasless on Monad: no fees). */
export function useSendQuote() {
  return useMutation({ mutationFn: (input: SendInput) => api.wallet.sendQuote(input) });
}

/**
 * Only when `features.sendCode.required` (backend SEND_CODE_REQUIRED=true): `POST /wallet/send/code`
 * emails a 6-digit code bound to this recipient and amount. A new code cancels the old one.
 */
export function useSendCode() {
  return useMutation({ mutationFn: (input: SendInput) => api.wallet.sendCode(input) });
}

/** Code errors are shown on the code screen itself, not as a toast. */
const CODE_ERRORS = new Set(['SEND_CODE_INVALID', 'SEND_CODE_EXPIRED', 'EMAIL_REQUIRED']);

/**
 * Send USDC on Monad: `POST /wallet/send { …send, verificationId?, code? }` → sign the
 * TransferWithAuthorization with the Privy wallet → `POST /wallet/send/:id/sign { signature }`.
 */
export function useSend(address: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendRequest) => {
      const { sendUsdc } = await import('@/lib/monad/walletActions');
      return sendUsdc(address, input);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      toast.success(r.status === 'completed' || r.txHash ? 'Sent' : 'Sending', r.status === 'completed' || r.txHash ? undefined : 'It shows as completed in Activity once it arrives.');
    },
    onError: (err) => {
      if (isApiError(err) && CODE_ERRORS.has(err.code)) return;
      if (cancelled(err)) {
        toast.info('Cancelled', 'Nothing was sent.');
        return;
      }
      console.error('[SmartRouter] send failed', err);
      toast.error('Could not send', message(err));
    },
  });
}

/**
 * One-time setup (Monad handoff §5.2–5.3): generate the spending key in this browser, sign the
 * Setup typed data with the Privy wallet, `POST /wallet/setup` (relayed; no MON needed). Also used
 * after a cap change (`reuseKey`) so the vault's on-chain caps match the settings.
 */
export function useSetupSpendingKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { wallet: Wallet; dailyUsd?: number; weeklyUsd?: number; reuseKey?: boolean }) => {
      const { registerSpendingKey } = await import('@/lib/monad/spendingKey');
      const res = await registerSpendingKey({ address: args.wallet.address, ...(args.dailyUsd !== undefined ? { dailyUsd: args.dailyUsd } : {}), ...(args.weeklyUsd !== undefined ? { weeklyUsd: args.weeklyUsd } : {}), ...(args.reuseKey ? { reuseKey: true } : {}) });
      const { resetPayments } = await import('@/lib/monad/payments');
      resetPayments();
      return res;
    },
    onSuccess: (_r, args) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
      void qc.invalidateQueries({ queryKey: queryKeys.me() });
      toast.success(args.reuseKey ? 'Caps updated on Monad' : 'Paid answers are set up', args.reuseKey ? undefined : 'Answers are now paid silently from your AI balance, within your caps.');
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      if (cancelled(err)) {
        toast.info('Cancelled', 'Nothing was set up.');
        return;
      }
      console.error('[SmartRouter] spending key setup failed', err);
      toast.error('Could not set up paid answers', message(err));
    },
  });
}

/**
 * "Remove spending key from this browser" (settings). The Monad backend has no revoke route, so the
 * key is forgotten here; the vault keeps it until it expires (see Monad_Backend_Gaps.md).
 */
export function useForgetSpendingKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (wallet: Wallet) => {
      const [{ forgetSpendingKey }, { resetPayments }] = await Promise.all([import('@/lib/monad/spendingKey'), import('@/lib/monad/payments')]);
      await forgetSpendingKey(wallet.address);
      resetPayments();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      toast.success('Spending key removed from this browser');
    },
    onError: (err) => {
      toast.error('Could not remove the spending key', message(err));
    },
  });
}
