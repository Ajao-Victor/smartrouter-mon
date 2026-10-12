'use client';

import { useEffect, useRef, useState } from 'react';

import { clsx } from 'clsx';
import { ArrowUp, Paperclip, Square } from 'lucide-react';

import { formatUsd, type MicroUsd } from '@/lib/money';
import { ACCEPT } from '@/lib/uploads';

import { useAttachments } from '@/hooks/useAttachments';
import { useComposerStore } from '@/stores/composerStore';

import { AttachmentChips } from '@/components/chat/AttachmentChips';
import { ModelPill } from '@/components/chat/ModelPill';

export interface ComposerQuote {
  priceUsd: MicroUsd;
  free: boolean;
}

export interface ComposerProps {
  /** Fresh quote for the current draft and model, if any — its price is shown beside Send. */
  quote: ComposerQuote | null;
  quoting?: boolean;
  running?: boolean;
  currentModel: { label: string; isFree: boolean } | null;
  onSend: (prompt: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  /** Increments on 429 → Send is paused for a few seconds. */
  cooldownKey?: number;
  placeholder?: string;
  className?: string;
  /** Show the attach button (needs sign-in; signed out it calls `onAttachSignedOut`). */
  allowAttach?: boolean;
  signedIn?: boolean;
  onAttachSignedOut?: () => void;
}

const MAX_ROWS = 8;
const COOLDOWN_MS = 10_000;

/**
 * The composer: one quiet box at the bottom of the thread. Enter sends, Shift+Enter breaks a
 * line, the model control sits under the text, and the quoted price sits
 * quietly beside the Send button (never on it).
 */
export function Composer({
  quote,
  quoting = false,
  running = false,
  currentModel,
  onSend,
  onStop,
  disabled = false,
  cooldownKey = 0,
  placeholder = 'Message SmartRouter…',
  className,
  allowAttach = false,
  signedIn = true,
  onAttachSignedOut,
}: ComposerProps) {
  const draft = useComposerStore((s) => s.draft);
  const setDraft = useComposerStore((s) => s.setDraft);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const attachments = useAttachments();
  const canAttach = allowAttach && attachments.enabled;
  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!signedIn) {
      onAttachSignedOut?.();
      return;
    }
    attachments.add(files);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = 24;
    el.style.height = `${String(Math.min(el.scrollHeight, line * MAX_ROWS + 16))}px`;
  }, [draft]);

  useEffect(() => {
    if (cooldownKey === 0) return;
    setCoolingDown(true);
    const t = window.setTimeout(() => {
      setCoolingDown(false);
    }, COOLDOWN_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [cooldownKey]);

  const prompt = draft.trim();
  // Files upload as soon as they're attached; Send waits until they're read.
  const canSend = prompt.length > 0 && !disabled && !running && !coolingDown && !attachments.busy;

  const submit = () => {
    if (!canSend) return;
    onSend(prompt);
  };

  /** The quoted price sits beside the Send button as a caption, never on the button itself. */
  const priceNote = attachments.busy ? 'Reading files…' : quote ? (quote.free ? 'Free' : formatUsd(quote.priceUsd)) : quoting ? 'Pricing…' : null;

  return (
    <form
      className={clsx('rounded-xl bg-bg-1 shadow-hairline-strong transition-[box-shadow] focus-within:shadow-glow-accent', dragging && 'shadow-glow-accent', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      {...(canAttach
        ? {
            onDragOver: (e: React.DragEvent) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              setDragging(true);
            },
            onDragLeave: () => {
              setDragging(false);
            },
            onDrop: (e: React.DragEvent) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              setDragging(false);
              addFiles(Array.from(e.dataTransfer.files));
            },
          }
        : {})}
    >
      {canAttach && <AttachmentChips items={attachments.items} onRemove={attachments.remove} />}
      <textarea
        ref={textareaRef}
        value={draft}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onPaste={(e) => {
          // Pasting files (not text) attaches them.
          if (!canAttach || e.clipboardData.files.length === 0) return;
          e.preventDefault();
          addFiles(Array.from(e.clipboardData.files));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-56 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-base leading-6 text-text-0 outline-none placeholder:text-text-2"
      />

      <div className="flex items-center gap-1 px-2 pb-2">
        {canAttach && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              aria-label="Attach files"
              title={attachments.limits ? `Attach files — ${attachments.limits.accepted}` : 'Attach files'}
              disabled={disabled || running}
              onClick={() => {
                if (!signedIn) {
                  onAttachSignedOut?.();
                  return;
                }
                fileRef.current?.click();
              }}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-text-1 transition-colors hocus:bg-bg-2 hocus:text-text-0 disabled:opacity-40"
            >
              <Paperclip size={18} aria-hidden="true" />
            </button>
          </>
        )}
        <ModelPill label={currentModel?.label ?? null} isFree={currentModel?.isFree ?? false} disabled={disabled} />
        <div className="flex-1" />
        {coolingDown ? (
          <span className="mr-2 text-xs text-warn">Too many requests — one moment</span>
        ) : priceNote && prompt.length > 0 && !running ? (
          <span className={clsx('num mr-2 text-xs', quote?.free ? 'text-free' : 'text-text-2')} aria-live="polite">
            {priceNote}
          </span>
        ) : null}
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-bg-2 px-3 text-sm font-medium text-text-0 transition-colors hocus:bg-bg-3"
          >
            <Square size={14} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}
