'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import type { ConfirmedSendInput, SendInput, Wallet } from '@/lib/api/types';
import { env } from '@/lib/env';

import { selectIsSignedIn, useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { useUsageStore } from '@/stores/usageStore';

const message = (err: unknown) => (isApiError(err) ? err.message : err instanceof Error ? err.message : undefined);

/**
 * `GET /wallet` — the whole Wallet panel from one call (Handover "Wallet panel layout"). Refreshed
 * after every deposit, send and paid answer, when the window regains focus, every 30 s while the
 * Wallet panel is open (10 s on Deposit), and by the refresh button next to the balance.
 */
export function useWallet(options: { enabled?: boolean; pollMs?: number | false } = {}) {
  const signedIn = useAuthStore(selectIsSignedIn);
  const query = useQuery({
    queryKey: queryKeys.wallet.get(),
    queryFn: async ({ signal }) => {
      const w = await api.wallet.get(signal);
      if (w.caps) useUsageStore.getState().setUsage(w.caps);
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

/** `POST /wallet/deposit-address { chain, token }` — the same address comes back every time. */
export function useDepositAddress(chain: string | null, token: string | null, refundAddress?: string) {
  return useQuery({
    queryKey: queryKeys.wallet.depositAddress(chain ?? '', token ?? ''),
    queryFn: () => api.wallet.depositAddress({ chain: chain ?? 'tempo', ...(token ? { token } : {}), ...(refundAddress ? { refundAddress } : {}) }),
    enabled: chain !== null,
    staleTime: Infinity,
    retry: 0,
  });
}

/** "Return now": `POST /wallet/locked/return` → `{ returnedUsd }`. */
export function useReturnLocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.wallet.returnLocked(),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.session.current() });
      if (r.returnedUsd > 0) toast.success(`$${r.returnedUsd.toFixed(2)} returned to your wallet`);
      else toast.info('Nothing to return right now', r.skipped?.[0]);
      // The next paid answer opens a fresh automatic deposit.
      void import('@/lib/tempo/session').then(({ resetSession }) => {
        resetSession();
      });
    },
    onError: (err) => {
      toast.error('Could not return the locked money', message(err));
    },
  });
}

/** `POST /wallet/send/quote` — what arrives, the bridge fee and the time. */
export function useSendQuote() {
  return useMutation({ mutationFn: (input: SendInput) => api.wallet.sendQuote(input) });
}

/**
 * Send, step 1 (Handover "Email code before any send out"): `POST /wallet/send/code` emails a
 * 6-digit code bound to this chain, token, recipient and amount. A new code cancels the old one.
 */
export function useSendCode() {
  return useMutation({ mutationFn: (input: SendInput) => api.wallet.sendCode(input) });
}

/** Code errors are shown on the code screen itself, not as a toast. */
const CODE_ERRORS = new Set(['SEND_CODE_INVALID', 'SEND_CODE_EXPIRED', 'EMAIL_REQUIRED']);

/**
 * Send, step 2: `POST /wallet/send { …send, verificationId, code }` → sign all `calls` as ONE Tempo transaction with
 * `feePayer: true` through `/relay` → `POST /wallet/send/:id/submitted { txHash }`.
 */
export function useSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConfirmedSendInput) => {
      const plan = await api.wallet.send(input);
      if (env.mock) return api.wallet.submitted(plan.sendId, `0x${'ab'.repeat(32)}`);
      const [{ sendTransactionSync }, { rootRelayClient }] = await Promise.all([import('viem/actions'), import('@/lib/tempo/relay')]);
      const client = await rootRelayClient();
      const receipt = await sendTransactionSync(client as never, {
        calls: plan.calls.map((c) => ({ to: c.to as `0x${string}`, data: c.data as `0x${string}`, ...(c.value ? { value: BigInt(c.value) } : {}) })),
        feePayer: true,
      } as never);
      return api.wallet.submitted(plan.sendId, (receipt as { transactionHash: string }).transactionHash);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      toast.success(r.status === 'completed' ? 'Sent' : 'Sending', r.status === 'completed' ? undefined : 'It shows as completed in Activity once it arrives.');
    },
    onError: (err) => {
      if (isApiError(err) && CODE_ERRORS.has(err.code)) return;
      console.error('[SmartRouter] send failed', err);
      toast.error('Could not send', message(err));
    },
  });
}

/**
 * One-time setup: the spending key (Handover "Paying for runs"). Generate the key in this browser,
 * authorize it with the Privy wallet (one signature, fee through `/relay`), then
 * `POST /wallet/spending-key { accessKeyAddress }`.
 */
export function useSetupSpendingKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (wallet: Wallet) => {
      const setup = wallet.spendingKey?.setup;
      if (!setup) throw new Error('The spending-key setup is not available right now. Reload and try again.');
      const { authorizeSpendingKey } = await import('@/lib/tempo/spendingKey');
      const accessKeyAddress = await authorizeSpendingKey({ address: wallet.address, setup, chainId: wallet.network?.chainId ?? null });
      const state = await api.wallet.spendingKey(accessKeyAddress);
      const { resetSession } = await import('@/lib/tempo/session');
      resetSession();
      return state;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      toast.success('Spending key set up', 'Answers are now paid silently within your caps.');
    },
    onError: (err) => {
      console.error('[SmartRouter] spending key setup failed', err);
      toast.error('Could not set up the spending key', message(err));
    },
  });
}

/** "Revoke spending key" (settings, and offered on sign-out). */
export function useRevokeSpendingKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (wallet: Wallet) => {
      const key = wallet.spendingKey?.address;
      if (!key) return;
      const { revokeSpendingKey } = await import('@/lib/tempo/spendingKey');
      await revokeSpendingKey({ address: wallet.address, accessKeyAddress: key, chainId: wallet.network?.chainId ?? null });
      const { resetSession } = await import('@/lib/tempo/session');
      resetSession();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.wallet.all() });
      toast.success('Spending key revoked');
    },
    onError: (err) => {
      toast.error('Could not revoke the spending key', message(err));
    },
  });
}
