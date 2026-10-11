'use client';

import { Suspense } from 'react';

import { useSearchParams } from 'next/navigation';

import { taskTypeSchema } from '@/lib/api/types';

import { NewChat } from '@/components/chat/NewChat';

/** New chat. The chat history lives in the left sidebar. */
function NewChatScreen() {
  const params = useSearchParams();
  const parsed = taskTypeSchema.safeParse(params.get('category'));
  return <NewChat initialCategory={parsed.success ? parsed.data : null} />;
}

export default function NewChatPage() {
  return (
    <Suspense fallback={null}>
      <NewChatScreen />
    </Suspense>
  );
}
