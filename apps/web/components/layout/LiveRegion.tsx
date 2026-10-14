'use client';

import { useEffect, useRef, useState } from 'react';

import { useModelLabel } from '@/hooks/useModelLabel';
import { useAllocationStore } from '@/stores/allocationStore';
import { selectAnyStreaming, useStreamStore } from '@/stores/streamStore';

/**
 * Screen-reader announcements: "Streaming…", "Done — {model}", "AI balance used". A single
 * polite live region, updated only on state transitions.
 */
export function LiveRegion() {
  const streaming = useStreamStore(selectAnyStreaming);
  const entries = useStreamStore((s) => s.byMessageId);
  const status = useAllocationStore((s) => s.status);
  const [message, setMessage] = useState('');
  const wasStreaming = useRef(false);
  const last = Object.values(entries).filter((e) => e.status === 'done').at(-1);
  const model = useModelLabel(last?.modelId ?? null, last?.label);

  useEffect(() => {
    if (streaming && !wasStreaming.current) setMessage('Streaming reply…');
    if (!streaming && wasStreaming.current) setMessage(model ? `Done — ${model.label}` : 'Done');
    wasStreaming.current = streaming;
  }, [streaming, model]);

  useEffect(() => {
    if (status === 'used') setMessage('AI balance used — Top up');
  }, [status]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">
      {message}
    </div>
  );
}
