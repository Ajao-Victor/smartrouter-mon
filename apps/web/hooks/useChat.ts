'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import type { ChatHistory, Message } from '@/lib/api/types';

/** One chat with its history (`GET /chats/:id`). */
export function useChat(chatId: string | null) {
  return useQuery({
    queryKey: queryKeys.chat(chatId ?? ''),
    queryFn: ({ signal }) => api.chats.get(chatId ?? '', null, signal),
    enabled: chatId !== null,
  });
}

/** Optimistic helpers used by the run flow. */
export function useChatCache(chatId: string) {
  const qc = useQueryClient();
  const key = queryKeys.chat(chatId);
  return {
    append: (message: Message) => {
      qc.setQueryData<ChatHistory>(key, (prev) => (prev ? { ...prev, messages: [...prev.messages, message] } : prev));
    },
    update: (messageId: string, patch: Partial<Message>) => {
      qc.setQueryData<ChatHistory>(key, (prev) => (prev ? { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) } : prev));
    },
    remove: (messageId: string) => {
      qc.setQueryData<ChatHistory>(key, (prev) => (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== messageId) } : prev));
    },
    setCurrentModel: (modelId: string) => {
      qc.setQueryData<ChatHistory>(key, (prev) => (prev ? { ...prev, currentModelId: modelId } : prev));
    },
    invalidate: () => qc.invalidateQueries({ queryKey: key }),
  };
}

/** Build an optimistic message. */
export function optimisticMessage(over: Partial<Message> & Pick<Message, 'role' | 'text'>): Message {
  return {
    id: `local_${String(Date.now())}_${Math.random().toString(36).slice(2, 7)}`,
    modelId: null,
    requestId: null,
    createdAt: new Date().toISOString(),
    chargedUsd: null,
    seq: null,
    files: [],
    attachments: [],
    citations: [],
    status: 'done',
    ...over,
  };
}
