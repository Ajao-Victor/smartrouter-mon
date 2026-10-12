'use client';

import { clsx } from 'clsx';
import { Receipt, RotateCcw } from 'lucide-react';

import type { Message } from '@/lib/api/types';
import { formatUsd } from '@/lib/money';

import { useModelLabel } from '@/hooks/useModelLabel';
import { selectEntry, useStreamStore } from '@/stores/streamStore';
import { useUiStore } from '@/stores/uiStore';

import { MessageFiles } from '@/components/chat/AttachmentChips';
import { MediaCard } from '@/components/chat/MediaCard';
import { PendingCard } from '@/components/chat/PendingCard';
import { StreamText } from '@/components/chat/StreamText';
import { ThumbsFeedback } from '@/components/chat/ThumbsFeedback';

export interface MessageBubbleProps {
  message: Message;
  onRerunFree?: (messageId: string) => void;
}

function ModelTag({ modelId, hint }: { modelId: string | null; hint?: string | null | undefined }) {
  const m = useModelLabel(modelId, hint);
  if (!m) return null;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs', m.isFree ? 'text-free' : 'text-text-2')}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', m.isFree ? 'bg-free' : 'bg-accent-2')} aria-hidden="true" />
      {m.label}
    </span>
  );
}

/**
 * One message. User turns sit right in a quiet bubble; assistant turns are plain text with a
 * small meta line (model, charge, latency, rating, receipt). Status comes from the stream store
 * while the answer is live and from the message record afterwards.
 */
export function MessageBubble({ message, onRerunFree }: MessageBubbleProps) {
  const entry = useStreamStore(selectEntry(message.id));
  const openReceipt = useUiStore((s) => s.openReceipt);
  const fallbackModel = useModelLabel(entry?.fallback?.toModelId ?? null, entry?.fallback?.label);
  const isUser = message.role === 'user';
  const status = entry?.status ?? (message.status === 'error' || message.status === 'failed' ? 'error' : message.status === 'pending' ? 'pending' : 'done');
  const modelId = entry?.modelId ?? message.modelId;
  const requestId = entry?.result?.requestId ?? entry?.requestId ?? message.requestId;
  const files = entry?.result?.files.length ? entry.result.files : message.files;
  const chargedUsd = entry?.result?.chargedUsd ?? message.chargedUsd;
  const latencyMs = entry?.result?.latencyMs ?? null;

  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        {message.attachments.length > 0 && <MessageFiles files={message.attachments} />}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-bg-2 px-4 py-2.5 text-base leading-7 whitespace-pre-wrap text-text-0">{message.text}</div>
      </div>
    );
  }

  return (
    <article data-status={status} className="space-y-2" aria-label="Assistant reply">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ModelTag modelId={modelId} hint={entry?.label} />
        {entry?.fallback && (
          <span role="status" className="text-xs text-warn">
            {entry.fallback.label || fallbackModel?.label || entry.fallback.toModelId} is answering instead — no extra charge
          </span>
        )}
      </div>

      {status === 'pending' ? (
        <PendingCard label={entry?.label ?? null} />
      ) : (
        <>
          <StreamText messageId={message.id} content={message.text} />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-1">
              {files.map((f) => (
                <MediaCard key={f.url} url={f.url} mime={f.mime} />
              ))}
            </div>
          )}
        </>
      )}

      {status === 'error' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-signal/10 px-3 py-2">
          <p className="text-sm text-signal">
            {entry?.error?.message ?? 'The answer failed.'}
            {entry?.error?.refunded !== false && <span className="text-text-2"> You were not charged.</span>}
          </p>
          {(entry?.error?.canRerunFree ?? true) && onRerunFree && (
            <button
              type="button"
              onClick={() => {
                onRerunFree(message.id);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-free/15 px-2.5 py-1 text-xs font-medium text-free transition-colors hocus:bg-free/25"
            >
              <RotateCcw size={12} aria-hidden="true" /> Rerun on the free model
            </button>
          )}
        </div>
      )}

      {status === 'done' && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
          {chargedUsd !== null && <span className="num">{chargedUsd === 0 ? 'Free' : formatUsd(chargedUsd)}</span>}
          {latencyMs !== null && <span className="num">{String(Math.round(latencyMs / 100) / 10)} s</span>}
          {requestId && <ThumbsFeedback requestId={requestId} />}
          {requestId && (
            <button
              type="button"
              onClick={() => {
                openReceipt(requestId);
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-text-2 transition-colors hocus:bg-bg-2 hocus:text-text-0"
            >
              <Receipt size={14} aria-hidden="true" /> Receipt
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
