'use client';

import { isOfflineError } from '@/lib/api/client';
import { apiUnreachableHint } from '@/lib/api/errors';

import { useAuth } from '@/hooks/useAuth';
import { useMe } from '@/hooks/useMe';
import { useSession } from '@/hooks/useSession';
import { useSettings } from '@/hooks/useSettings';
import { useWallet } from '@/hooks/useWallet';
import { toast } from '@/stores/toastStore';
import { useUiStore } from '@/stores/uiStore';

import { AllocationHUD } from '@/components/allocation/AllocationHUD';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ReceiptDrawer } from '@/components/receipt/ReceiptDrawer';
import { Skeleton } from '@/components/ui/Skeleton';
import { WalletSheet } from '@/components/wallet/WalletSheet';

export interface AppShellProps {
  children: React.ReactNode;
  title?: string | null;
}

/**
 * App shell: chat history on the left, the page on the right. Signed-out visitors get the normal
 * chat screens (Handover "Guest mode"); the sign-in modal appears only when they send. Signed in:
 * `GET /me` on load (seeds the usage banner), `GET /wallet` and `GET /sessions/current`.
 *
 * The page is never unmounted while `/me` refetches: a refetch loop there once left the app stuck
 * on a skeleton.
 */
export function AppShell({ children, title }: AppShellProps) {
  const me = useMe();
  const settings = useSettings();
  const auth = useAuth();
  const pageTitle = useUiStore((s) => s.pageTitle);
  useSession(auth.isSignedIn);
  useWallet({ enabled: auth.isSignedIn });

  const right = auth.isSignedIn ? (
    <AllocationHUD />
  ) : auth.status === 'unknown' ? null : (
    <button
      type="button"
      onClick={() => {
        auth.signIn();
      }}
      disabled={auth.signingIn}
      className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
    >
      {auth.signingIn ? 'Signing in…' : 'Sign in'}
    </button>
  );

  return (
    <div className="flex min-h-dvh bg-bg-0">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title ?? pageTitle} right={right} />
        {me.data && (
          <WalletSheet
            user={me.data}
            busy={{ settings: settings.isPending, signOut: auth.signOut.isPending }}
            onSettings={(patch) => {
              settings.mutate(patch, {
                onSuccess: () => {
                  toast.success('Saved');
                },
                onError: (err) => {
                  toast.error('Could not save settings', err instanceof Error ? err.message : undefined);
                },
              });
            }}
            onSignOut={() => {
              auth.signOut.mutate(undefined, {
                onSettled: () => {
                  window.location.assign('/');
                },
              });
            }}
          />
        )}
        <ReceiptDrawer />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-4">
          {auth.status === 'unknown' ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-6 w-40" pill />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : me.isOffline && !me.data ? (
            <div role="alert" className="space-y-2 rounded-lg bg-bg-1 p-4 text-sm shadow-hairline">
              {isOfflineError(me.error) ? (
                <>
                  <p className="text-signal">Could not reach SmartRouter.</p>
                  <p className="text-text-2">{apiUnreachableHint()}</p>
                </>
              ) : (
                <>
                  <p className="text-signal">Could not load your account.</p>
                  <p className="text-text-2">{me.error?.message ?? 'Something went wrong.'}</p>
                </>
              )}
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
