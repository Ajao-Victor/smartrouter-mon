import type { TaskType } from '@/lib/api/types';

/**
 * Single source of TanStack Query keys (rules.md §4.2).
 * Components never write key arrays inline.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  session: {
    current: () => ['session', 'current'] as const,
  },
  catalog: (task?: TaskType) => (task ? (['catalog', task] as const) : (['catalog'] as const)),
  chats: () => ['chats'] as const,
  uploadLimits: () => ['uploads', 'limits'] as const,
  chat: (chatId: string) => ['chat', chatId] as const,
  request: (requestId: string) => ['request', requestId] as const,
  requests: () => ['requests'] as const,
  wallet: {
    all: () => ['wallet'] as const,
    get: () => ['wallet', 'summary'] as const,
    options: () => ['wallet', 'options'] as const,
    activity: () => ['wallet', 'activity'] as const,
    depositAddress: (chain: string, token: string) => ['wallet', 'deposit-address', chain, token] as const,
    /** The spending key saved in this browser (IndexedDB), per wallet address. */
    localKey: (address: string) => ['wallet', 'local-key', address.toLowerCase()] as const,
  },
} as const;

/** Quote validity window in ms (PDF: 5 minutes). */
export const QUOTE_TTL_MS = 5 * 60_000;
