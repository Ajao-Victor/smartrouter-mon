'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import type { CompareVoteInput, FeedbackInput, User } from '@/lib/api/types';
import { env } from '@/lib/env';

import { useAuthStore } from '@/stores/authStore';

function useAddress(): () => string | null {
  const qc = useQueryClient();
  return () => useAuthStore.getState().account?.address ?? qc.getQueryData<User>(queryKeys.me())?.address ?? null;
}

/**
 * Thumbs up/down under an answer (`POST /feedback { requestId, rating, signature? }`). With a
 * spending key in this browser the rating is signed (EIP-712 Rating) and recorded on
 * SmartRouterLedger; without one it is saved off-chain.
 */
export function useFeedback() {
  const address = useAddress();
  return useMutation({
    mutationFn: async (input: FeedbackInput) => {
      const who = address();
      if (!who || env.mock || input.signature) return api.feedback.rate(input);
      const { signRating } = await import('@/lib/monad/ledger');
      const signature = await signRating(who, input.requestId, input.rating);
      return api.feedback.rate({ ...input, ...(signature ? { signature } : {}) });
    },
  });
}

/**
 * Compare pick (`POST /compare/vote { compareGroup, winnerRequestId, prompt, signature? }`). When the
 * losing request is known the vote is signed (EIP-712 Vote) for the ledger.
 */
export function useCompareVote() {
  const address = useAddress();
  return useMutation({
    mutationFn: async ({ loserRequestId, ...input }: CompareVoteInput & { loserRequestId?: string }) => {
      const who = address();
      if (!who || !loserRequestId || env.mock || input.signature) return api.feedback.compareVote(input);
      const { signVote } = await import('@/lib/monad/ledger');
      const signature = await signVote(who, input.compareGroup, input.winnerRequestId, loserRequestId);
      return api.feedback.compareVote({ ...input, ...(signature ? { signature } : {}) });
    },
  });
}
