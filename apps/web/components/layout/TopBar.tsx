'use client';

import { clsx } from 'clsx';
import { PanelLeft } from 'lucide-react';

import { useUiStore } from '@/stores/uiStore';

export interface TopBarProps {
  /** Chat title. */
  title?: string | null;
  /** Right-side slot (wallet pill or Sign in). */
  right?: React.ReactNode;
  className?: string;
}

/** Quiet top bar over the main column: sidebar toggle (phones), chat title, wallet slot. */
export function TopBar({ title, right, className }: TopBarProps) {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  return (
    <header className={clsx('sticky top-0 z-content flex h-14 items-center gap-2 border-b border-line bg-bg-0/90 px-3 backdrop-blur-sm sm:px-4', className)}>
      <button
        type="button"
        aria-label="Open chat history"
        onClick={() => {
          setSidebarOpen(true);
        }}
        className="rounded-md p-1.5 text-text-1 hocus:bg-bg-2 hocus:text-text-0 md:hidden"
      >
        <PanelLeft size={18} />
      </button>
      <div className="min-w-0 flex-1 truncate text-sm text-text-1">{title ?? null}</div>
      {right && <div className="flex shrink-0 items-center">{right}</div>}
    </header>
  );
}
