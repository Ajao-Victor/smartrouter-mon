'use client';

import { clsx } from 'clsx';
import { X } from 'lucide-react';

import { selectVisibleAlert, useUsageStore } from '@/stores/usageStore';

import { resetsAtLabel } from '@/components/wallet/CapBars';

export interface UsageBannerProps {
  /** `raise_limit` (daily or weekly cap): open settings to raise the cap. */
  onRaiseCap: () => void;
  /** `add_funds` (balance): open the Deposit panel. */
  onAddFunds: () => void;
  /** `exhausted`: offer the free model. */
  onUseFree?: (() => void) | undefined;
  className?: string;
}

/**
 * Usage banner (Handover "Usage banners"): the backend computes `usage.alert`; this renders it like
 * Claude's — "{message} · {button}". The button follows `action`: `raise_limit` → "Raise cap",
 * `add_funds` → "Add funds". A daily cap shows its reset time ("Resets at 1:00 AM").
 *
 * | level     | shown at                                   | style                                   |
 * | warning   | 75% of a cap                               | thin bar above the composer, dismissible|
 * | critical  | 90% of a cap, or can't top up the AI balance| same bar, stronger colour, not dismissible|
 * | exhausted | cap reached, or the wallet is empty        | blocks paid Send; offers the free model |
 */
export function UsageBanner({ onRaiseCap, onAddFunds, onUseFree, className }: UsageBannerProps) {
  const alert = useUsageStore(selectVisibleAlert);
  const daily = useUsageStore((s) => s.usage?.daily ?? null);
  const dismiss = useUsageStore((s) => s.dismiss);
  if (!alert) return null;

  const funds = alert.action === 'add_funds' || alert.meter === 'balance';
  const act = funds ? onAddFunds : onRaiseCap;
  const label = funds ? 'Add funds' : 'Raise cap';
  const reset = alert.meter === 'daily' ? resetsAtLabel(daily?.resetsAt ?? null) : null;
  const tone = alert.level === 'warning' ? 'bg-warn/10 text-text-0' : alert.level === 'critical' ? 'bg-warn/20 text-text-0 shadow-hairline-strong' : 'bg-signal/15 text-text-0 shadow-hairline-strong';

  return (
    <div role={alert.level === 'warning' ? 'status' : 'alert'} data-usage-level={alert.level} className={clsx('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-1.5 text-sm', tone, className)}>
      <span className="min-w-0 flex-1">
        {alert.message}
        {reset && <span className="text-text-2"> · {reset}</span>}
        <span className="text-text-2"> · </span>
        <button type="button" onClick={act} className={clsx('font-medium underline-offset-2 hocus:underline', alert.level === 'exhausted' ? 'text-signal' : 'text-warn')}>
          {label}
        </button>
      </span>
      <span className="flex items-center gap-1">
        {alert.level === 'exhausted' && onUseFree && (
          <button type="button" onClick={onUseFree} className="rounded-md bg-free/15 px-2 py-0.5 text-sm font-medium text-free transition-colors hocus:bg-free/25">
            Use the free model
          </button>
        )}
        {alert.level === 'warning' && (
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-md p-1 text-text-2 transition-colors hocus:bg-bg-2 hocus:text-text-0">
            <X size={14} />
          </button>
        )}
      </span>
    </div>
  );
}
