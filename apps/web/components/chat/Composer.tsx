'use client';

import { useEffect, useRef, useState } from 'react';

import { clsx } from 'clsx';
import { ArrowUp, Square } from 'lucide-react';

import { formatUsd, type MicroUsd } from '@/lib/money';

import { useComposerStore } from '@/stores/composerStore';

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
}: ComposerProps) {
  const draft = useComposerStore((s) => s.draft);
  const setDraft = useComposerStore((s) => s.setDraft);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);

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
  const canSend = prompt.length > 0 && !disabled && !running && !coolingDown;

  const submit = () => {
    if (!canSend) return;
    onSend(prompt);
  };

  /** The quoted price sits beside the Send button as a caption, never on the button itself. */
  const priceNote = quote ? (quote.free ? 'Free' : formatUsd(quote.priceUsd)) : quoting ? 'Pricing…' : null;

  return (
    <form
      className={clsx('rounded-xl bg-bg-1 shadow-hairline-strong transition-[box-shadow] focus-within:shadow-glow-accent', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-56 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-base leading-6 text-text-0 outline-none placeholder:text-text-2"
      />

      <div className="flex items-center gap-1 px-2 pb-2">
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
