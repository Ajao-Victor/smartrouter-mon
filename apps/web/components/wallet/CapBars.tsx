'use client';

import { clsx } from 'clsx';

import type { CapMeter } from '@/lib/api/types';
import { formatUsd } from '@/lib/money';

/** "Resets at 1:00 AM" from `daily.resetsAt` (shown in the user's own time). */
export function resetsAtLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return `Resets at ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function Bar({ label, meter, note }: { label: string; meter: CapMeter; note?: string | null }) {
  const pct = Math.min(100, Math.max(0, meter.usedPct));
  const tone = pct >= 100 ? 'bg-signal' : pct >= 90 ? 'bg-warn' : pct >= 75 ? 'bg-warn/70' : 'bg-accent-2';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-text-1">{label}</span>
        <span className="num text-text-0">
          {formatUsd(meter.spentUsd)} <span className="text-text-2">of {formatUsd(meter.limitUsd, { min: 0 })}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-bg-3" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={clsx('h-full rounded-pill transition-[width]', tone)} style={{ width: `${String(pct)}%` }} />
      </div>
      {note && <p className="text-2xs text-text-2">{note}</p>}
    </div>
  );
}

/** The two spending-cap bars: today (with its reset time) and this week. */
export function CapBars({ daily, weekly }: { daily: CapMeter | null; weekly: CapMeter | null }) {
  return (
    <div className="space-y-3">
      {daily && <Bar label="Today" meter={daily} note={resetsAtLabel(daily.resetsAt)} />}
      {weekly && <Bar label="This week" meter={weekly} note="Counts the last 7 days" />}
    </div>
  );
}
