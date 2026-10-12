'use client';

import { clsx } from 'clsx';
import { AlertCircle, FileText, Loader2, X } from 'lucide-react';

import { formatBytes } from '@/lib/uploads';

import type { DraftAttachment } from '@/stores/attachmentStore';

/** The files on the draft: name, size or progress, and a remove button. */
export function AttachmentChips({ items, onRemove }: { items: DraftAttachment[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached files">
      {items.map((a) => {
        const status =
          a.status === 'uploading' ? `Uploading ${String(Math.round(a.progress * 100))}%` : a.status === 'processing' ? 'Reading…' : a.status === 'failed' ? (a.error ?? 'Upload failed') : a.truncated ? 'Long file — cut to fit' : formatBytes(a.sizeBytes);
        return (
          <li
            key={a.id}
            className={clsx('flex max-w-full items-center gap-2 rounded-lg bg-bg-2 py-1.5 pr-1 pl-2.5 text-sm shadow-hairline', a.status === 'failed' && 'shadow-[0_0_0_1px_var(--signal)]')}
            title={a.status === 'failed' ? (a.error ?? undefined) : a.name}
          >
            {a.status === 'uploading' || a.status === 'processing' ? (
              <Loader2 size={16} className="shrink-0 animate-spin text-text-2" aria-hidden="true" />
            ) : a.status === 'failed' ? (
              <AlertCircle size={16} className="shrink-0 text-signal" aria-hidden="true" />
            ) : (
              <FileText size={16} className="shrink-0 text-accent-2" aria-hidden="true" />
            )}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-text-0">{a.name}</span>
              <span className={clsx('num truncate text-2xs', a.status === 'failed' ? 'text-signal' : 'text-text-2')}>{status}</span>
            </span>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => {
                onRemove(a.id);
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hocus:bg-bg-3 hocus:text-text-0"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Files on a sent message (inside the user's bubble). */
export function MessageFiles({ files }: { files: { ref: string; name: string; sizeBytes: number | null }[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap justify-end gap-1.5" aria-label="Attached files">
      {files.map((f) => (
        <li key={f.ref} className="flex max-w-full items-center gap-1.5 rounded-md bg-bg-3/60 px-2 py-1 text-xs text-text-1">
          <FileText size={13} className="shrink-0 text-accent-2" aria-hidden="true" />
          <span className="truncate">{f.name}</span>
          {f.sizeBytes !== null && <span className="num shrink-0 text-text-2">{formatBytes(f.sizeBytes)}</span>}
        </li>
      ))}
    </ul>
  );
}
