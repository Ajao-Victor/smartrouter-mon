'use client';

import { useState } from 'react';

import type { SettingsPatch } from '@/lib/api/types';
import { toUsd, type MicroUsd } from '@/lib/money';

import { Switch } from '@/components/ui/Switch';

export interface CapsEditorProps {
  dailyLimitUsd: MicroUsd;
  weeklyLimitUsd: MicroUsd;
  autoFreeFallback: boolean;
  saving?: boolean;
  onSave: (patch: SettingsPatch) => void;
}

/**
 * Edit caps (Handover "Spending caps card"): two number fields saved with
 * `PATCH /me/settings { dailyLimitUsd, weeklyLimitUsd }` — the daily cap can't exceed the weekly
 * one. Saving a new daily cap also moves the spending key's on-chain limit (one Privy signature).
 */
export function CapsEditor({ dailyLimitUsd, weeklyLimitUsd, autoFreeFallback, saving = false, onSave }: CapsEditorProps) {
  const [daily, setDaily] = useState(String(toUsd(dailyLimitUsd)));
  const [weekly, setWeekly] = useState(String(toUsd(weeklyLimitUsd)));
  const d = Number(daily);
  const w = Number(weekly);
  const invalid = !Number.isFinite(d) || !Number.isFinite(w) || d < 0 || w < 0 || w > 1000 ? 'Enter amounts between $0 and $1,000.' : d > w ? "The daily cap can't be more than the weekly cap." : null;
  const changed = d !== toUsd(dailyLimitUsd) || w !== toUsd(weeklyLimitUsd);

  const field = (label: string, hint: string, value: string, set: (v: string) => void) => (
    <label className="block space-y-1 text-sm">
      <span className="text-text-1">{label}</span>
      <span className="num flex h-10 items-center gap-1 rounded-lg bg-bg-1 px-3 text-text-1 shadow-hairline">
        $
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={1000}
          step="0.5"
          aria-label={label}
          value={value}
          onChange={(e) => {
            set(e.target.value);
          }}
          className="w-full bg-transparent text-text-0 outline-none"
        />
      </span>
      <span className="text-xs text-text-2">{hint}</span>
    </label>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid || !changed) return;
        onSave({ dailyLimitUsd: d, weeklyLimitUsd: w });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field('Daily cap', 'Resets at 00:00 UTC', daily, setDaily)}
        {field('Weekly cap', 'Counts the last 7 days', weekly, setWeekly)}
      </div>
      {invalid && <p className="text-sm text-signal">{invalid}</p>}
      <button
        type="submit"
        disabled={Boolean(invalid) || !changed || saving}
        className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save caps'}
      </button>
      <Switch
        label="Auto free fallback"
        description="When a cap is reached, continue on the free model and say so"
        checked={autoFreeFallback}
        disabled={saving}
        onChange={(v) => {
          onSave({ autoFreeFallback: v });
        }}
        className="rounded-lg bg-bg-1 p-3 shadow-hairline"
      />
    </form>
  );
}
