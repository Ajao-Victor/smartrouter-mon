'use client';

import { useId } from 'react';

import { clsx } from 'clsx';
import { motion } from 'motion/react';

import { instant, springs } from '@/lib/motion/springs';
import { useReducedMotionSafe } from '@/lib/motion/useReducedMotionSafe';

import type { DepositTab } from '@/stores/depositStore';

export const DEPOSIT_TABS: { id: DepositTab; label: string }[] = [
  { id: 'monad', label: 'Monad' },
  { id: 'aurora', label: 'Other chains' },
  { id: 'card', label: 'Card' },
];

/** Segmented control for the deposit method; the active pill glides between tabs on the snappy spring. */
export function DepositTabs({ value, onChange }: { value: DepositTab; onChange: (tab: DepositTab) => void }) {
  const reduced = useReducedMotionSafe();
  const layoutId = useId();
  return (
    <div className="relative flex gap-1 rounded-lg bg-bg-1 p-1 shadow-hairline" role="tablist" aria-label="Deposit method">
      {DEPOSIT_TABS.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`deposit-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`deposit-panel-${t.id}`}
            onClick={() => {
              onChange(t.id);
            }}
            className={clsx('relative h-8 flex-1 rounded-md text-sm transition-colors', active ? 'text-text-0' : 'text-text-1 hocus:text-text-0')}
          >
            {active && <motion.span layoutId={layoutId} transition={reduced ? instant : springs.snappy} className="absolute inset-0 rounded-md bg-bg-3 shadow-hairline" aria-hidden="true" />}
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
