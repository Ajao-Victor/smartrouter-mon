'use client';

import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api/endpoints';
import type { CompareVoteInput, FeedbackInput } from '@/lib/api/types';

/** Thumbs up/down under an answer (`POST /feedback { requestId, rating: 1 | -1 }`). */
export function useFeedback() {
  return useMutation({ mutationFn: (input: FeedbackInput) => api.feedback.rate(input) });
}

/** Compare pick (`POST /compare/vote { compareGroup, winnerRequestId, prompt }`). */
export function useCompareVote() {
  return useMutation({ mutationFn: (input: CompareVoteInput) => api.feedback.compareVote(input) });
}
