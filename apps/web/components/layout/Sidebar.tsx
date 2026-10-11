'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { clsx } from 'clsx';
import { Activity, MessageSquare, PanelLeftClose, Plus, Settings, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useArchiveChat, useChats } from '@/hooks/useChats';
import { useComposerStore } from '@/stores/composerStore';
import { useUiStore } from '@/stores/uiStore';

import { Skeleton } from '@/components/ui/Skeleton';

function dayGroup(iso: string | null): string {
  if (!iso) return 'Earlier';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Earlier';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday.getTime() - t) / 86_400_000);
  if (t >= startOfToday.getTime()) return 'Today';
  if (diffDays < 1) return 'Yesterday';
  if (diffDays < 7) return 'Previous 7 days';
  if (diffDays < 30) return 'Previous 30 days';
  return 'Earlier';
}

/**
 * Left sidebar with the chat history, like other chat apps: New chat at the top, chats grouped by
 * day (`GET /chats`), Activity and Settings at the bottom. On phones it is a drawer.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const chats = useChats();
  const archive = useArchiveChat();
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);

  const close = () => {
    setOpen(false);
  };
  const list = chats.data?.chats ?? [];
  const groups: { label: string; items: typeof list }[] = [];
  for (const c of list) {
    const label = dayGroup(c.updatedAt ?? c.createdAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(c);
    else groups.push({ label, items: [c] });
  }

  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-3">
        <Link href="/" className="flex items-center gap-2 rounded-md px-1 text-base font-semibold text-text-0" aria-label="SmartRouter home" onClick={close}>
          <span className="h-2.5 w-2.5 rounded-full bg-accent-2" aria-hidden="true" />
          <span className="font-display">SmartRouter</span>
        </Link>
        <button type="button" aria-label="Close sidebar" onClick={close} className="rounded-md p-1.5 text-text-2 hocus:bg-bg-2 hocus:text-text-0 md:hidden">
          <PanelLeftClose size={18} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => {
            const c = useComposerStore.getState();
            c.setDraft('');
            c.setCategory(null);
            c.selectModel(null);
            c.setPendingOptions(null);
            close();
            router.push('/chat');
          }}
          className="inline-flex h-9 w-full items-center gap-2 rounded-lg bg-bg-2 px-3 text-sm font-medium text-text-0 transition-colors hocus:bg-bg-3"
        >
          <Plus size={16} aria-hidden="true" /> New chat
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Chat history">
        {!auth.isSignedIn ? (
          <p className="px-2 pt-2 text-xs text-text-2">
            {auth.status === 'unknown' ? '' : 'Sign in to keep your chats. The same email brings them back on any device.'}
          </p>
        ) : chats.isPending ? (
          <div className="space-y-2 px-1 pt-2" aria-busy="true">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-5/6" />
            <Skeleton className="h-7 w-4/6" />
          </div>
        ) : list.length === 0 ? (
          <p className="px-2 pt-2 text-xs text-text-2">No chats yet.</p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="pt-3">
              <p className="px-2 pb-1 text-2xs font-medium tracking-wider-ui text-text-2 uppercase">{g.label}</p>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const href = `/chat/${c.id}`;
                  const active = pathname === href;
                  return (
                    <li key={c.id} className="group relative">
                      <Link
                        href={href}
                        onClick={close}
                        aria-current={active ? 'page' : undefined}
                        className={clsx('flex h-8 items-center gap-2 rounded-md pr-8 pl-2 text-sm transition-colors', active ? 'bg-bg-2 text-text-0' : 'text-text-1 hocus:bg-bg-2/60 hocus:text-text-0')}
                      >
                        <MessageSquare size={14} className="shrink-0 text-text-2" aria-hidden="true" />
                        <span className="truncate">{c.title ?? 'New chat'}</span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`Delete ${c.title ?? 'chat'}`}
                        onClick={() => {
                          archive.mutate(c.id);
                          if (active) router.push('/chat');
                        }}
                        className="absolute top-1 right-1 hidden rounded p-1 text-text-2 group-hover:block hocus:block hocus:text-signal"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      <div className="space-y-0.5 border-t border-line p-2">
        {[
          { href: '/activity', label: 'Activity', icon: Activity },
          { href: '/settings', label: 'Settings', icon: Settings },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            aria-current={pathname === href ? 'page' : undefined}
            className={clsx('flex h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors', pathname === href ? 'bg-bg-2 text-text-0' : 'text-text-1 hocus:bg-bg-2/60 hocus:text-text-0')}
          >
            <Icon size={16} aria-hidden="true" /> {label}
          </Link>
        ))}
        {auth.account?.email && <p className="truncate px-2 pt-1 text-2xs text-text-2">{auth.account.email}</p>}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-line bg-bg-1/40 md:sticky md:top-0 md:block md:h-dvh">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-sheet md:hidden">
          <button type="button" aria-label="Close sidebar" className="absolute inset-0 bg-black/50" onClick={close} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-bg-1 shadow-hairline-strong">{nav}</aside>
        </div>
      )}
    </>
  );
}
