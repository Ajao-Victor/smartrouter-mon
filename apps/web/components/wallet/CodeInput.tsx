'use client';

import { useEffect, useRef } from 'react';

const LENGTH = 6;

export interface CodeInputProps {
  /** Digits typed so far (0–6). */
  value: string;
  onChange: (value: string) => void;
  /** Called once the sixth digit is in (auto-submit). */
  onComplete: (code: string) => void;
  disabled?: boolean;
  /** Focus the first empty box (on mount and whenever this changes). */
  focusKey?: unknown;
}

/**
 * Six single-digit boxes for the emailed send code: numeric keyboard on phones, paste fills all
 * six, Backspace steps back, and the sixth digit submits.
 */
export function CodeInput({ value, onChange, onComplete, disabled = false, focusKey }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (disabled) return;
    refs.current[Math.min(value.length, LENGTH - 1)]?.focus();
    // Only when asked to (mount, cleared after a wrong code), not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, disabled]);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, LENGTH);
    onChange(clean);
    refs.current[Math.min(clean.length, LENGTH - 1)]?.focus();
    if (clean.length === LENGTH) onComplete(clean);
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? LENGTH : 1}
          aria-label={`Digit ${String(i + 1)}`}
          onFocus={(e) => {
            e.target.select();
          }}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return;
            // A paste or one-time-code autofill lands in one box: spread it from here.
            set(value.slice(0, i) + typed);
          }}
          onPaste={(e) => {
            e.preventDefault();
            set(value.slice(0, i) + e.clipboardData.getData('text'));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              const cut = d ? i : Math.max(0, i - 1);
              onChange(value.slice(0, cut));
              refs.current[cut]?.focus();
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && i < LENGTH - 1) refs.current[i + 1]?.focus();
          }}
          className="num h-12 w-full min-w-0 rounded-lg bg-bg-1 text-center text-xl text-text-0 shadow-hairline outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
        />
      ))}
    </div>
  );
}
