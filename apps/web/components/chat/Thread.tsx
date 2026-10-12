'use client';

import { useEffect, useRef, useState } from 'react';

import { ArrowDown } from 'lucide-react';

import type { Message } from '@/lib/api/types';

import { selectAnyStreaming, useStreamStore } from '@/stores/streamStore';

import { MessageBubble } from '@/components/chat/MessageBubble';

export interface ThreadProps {
  messages: Message[];
  onRerunFree?: (messageId: string) => void;
  /** Message ids rendered elsewhere (CompareSplit). */
  exclude?: readonly string[];
  /** Extra content rendered below the last message (compare split, top-up prompt). */
  children?: React.ReactNode;
}

const WINDOW = 80;

function scrollToEnd(behavior: ScrollBehavior): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}

/** The conversation. Follows the stream while the reader is near the bottom; otherwise offers "Jump to latest". */
export function Thread({ messages, onRerunFree, exclude = [], children }: ThreadProps) {
  const [showAll, setShowAll] = useState(false);
  const [pinned, setPinned] = useState(true);
  // Read by the follow effect without being one of its triggers: reaching the bottom must not scroll the page.
  const pinnedRef = useRef(true);
  const streaming = useStreamStore(selectAnyStreaming);
  const visible = showAll || messages.length <= WINDOW ? messages : messages.slice(-WINDOW);

  useEffect(() => {
    const onScroll = () => {
      const gap = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      pinnedRef.current = gap < 160;
      setPinned(pinnedRef.current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const lastId = messages.at(-1)?.id;
  // Follow new messages only. Scroll the document to its real end so the last reply clears the sticky composer.
  useEffect(() => {
    if (pinnedRef.current) scrollToEnd('auto');
  }, [lastId, streaming]);

  return (
    <div className="space-y-8" aria-label="Conversation">
      {!showAll && messages.length > WINDOW && (
        <div className="text-center">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-text-1 transition-colors hocus:bg-bg-2 hocus:text-text-0"
            onClick={() => {
              setShowAll(true);
            }}
          >
            Show {String(messages.length - WINDOW)} earlier messages
          </button>
        </div>
      )}
      {visible
        .filter((m) => !exclude.includes(m.id) && m.role !== 'system')
        .map((m) => (
          <MessageBubble key={m.id} message={m} {...(onRerunFree ? { onRerunFree } : {})} />
        ))}
      {children}
      {!pinned && streaming && (
        <div className="fixed bottom-36 left-1/2 z-content -translate-x-1/2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-pill bg-bg-2 px-3 py-1.5 text-sm text-text-0 shadow-hairline-strong transition-colors hocus:bg-bg-3"
            onClick={() => {
              pinnedRef.current = true;
              setPinned(true);
              scrollToEnd('smooth');
            }}
          >
            <ArrowDown size={14} aria-hidden="true" /> Jump to latest
          </button>
        </div>
      )}
    </div>
  );
}
