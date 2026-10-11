'use client';

import { ExternalLink } from 'lucide-react';

import { env, isTestnet } from '@/lib/env';
import { addressUrl, shortHex } from '@/lib/explorer';

import { useAuth } from '@/hooks/useAuth';
import { useMe } from '@/hooks/useMe';
import { useSettings } from '@/hooks/useSettings';
import { useRevokeSpendingKey, useWallet } from '@/hooks/useWallet';
import { toast } from '@/stores/toastStore';
import { useUiStore } from '@/stores/uiStore';

import { SignInGate } from '@/components/auth/SignInGate';
import { PresetSlider } from '@/components/recommend/Slider';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { CapBars } from '@/components/wallet/CapBars';
import { CapsEditor } from '@/components/wallet/CapsEditor';
import { SpendingKeyStatus } from '@/components/wallet/SpendingKeyStatus';

export default function SettingsPage() {
  return (
    <SignInGate what="your settings">
      <Settings />
    </SignInGate>
  );
}

function Settings() {
  const me = useMe();
  const settings = useSettings();
  const auth = useAuth();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const forceReduced = useUiStore((s) => s.forceReducedMotion);
  const setForceReduced = useUiStore((s) => s.setForceReducedMotion);
  const wallet = useWallet();
  const revoke = useRevokeSpendingKey();

  if (me.isPending || !me.data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-48" pill />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const user = me.data;
  const save = (patch: Parameters<typeof settings.mutate>[0]) => {
    settings.mutate(patch, {
      onSuccess: () => {
        toast.success('Saved');
      },
      onError: (err) => {
        toast.error('Could not save settings', err instanceof Error ? err.message : undefined);
      },
    });
  };
  const explorer = addressUrl(user.address);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text-0">Settings</h1>
        <p className="text-sm text-text-2">Spending caps, defaults and appearance. Saved to your account.</p>
      </header>

      <section id="limits" className="scroll-mt-20 space-y-3 rounded-lg bg-bg-1 p-4 shadow-hairline" aria-label="Spending caps">
        <p className="num text-2xs tracking-wider-ui text-text-2 uppercase">Spending caps</p>
        <CapBars daily={user.usage?.daily ?? null} weekly={user.usage?.weekly ?? null} />
        <CapsEditor dailyLimitUsd={user.dailyLimitUsd} weeklyLimitUsd={user.weeklyLimitUsd} autoFreeFallback={user.autoFreeFallback} saving={settings.isPending} onSave={save} />
      </section>

      {wallet.data && (
        <section className="space-y-2 rounded-lg bg-bg-1 p-4 shadow-hairline" aria-label="Spending key">
          <p className="num text-2xs tracking-wider-ui text-text-2 uppercase">Spending key</p>
          <SpendingKeyStatus wallet={wallet.data} />
          {wallet.data.spendingKey?.status === 'active' && (
            <button
              type="button"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(wallet.data);
              }}
              className="rounded-lg border border-signal/40 px-3 py-1.5 text-sm text-signal transition-colors hocus:bg-signal/10 disabled:opacity-60"
            >
              {revoke.isPending ? 'Revoking…' : 'Revoke spending key'}
            </button>
          )}
          <p className="text-xs text-text-2">The key lives only in this browser and can spend only into Tempo&apos;s payment contract, up to your daily cap. It expires after 7 days.</p>
        </section>
      )}

      <section className="space-y-2 rounded-lg bg-bg-1 p-4 shadow-hairline" aria-label="Default slider">
        <PresetSlider value={user.slider} onChange={(slider) => { save({ slider }); }} disabled={settings.isPending} />
        <p className="text-xs text-text-2">Default for new chats. Each chat can override it.</p>
      </section>

      <section className="space-y-2 rounded-lg bg-bg-1 p-4 shadow-hairline" aria-label="Wallet">
        <p className="num text-2xs tracking-wider-ui text-text-2 uppercase">Wallet</p>
        {user.email && (
          <p className="text-sm text-text-0">
            {user.email}
            {user.loginMethod && <span className="text-text-2"> · signed in with {user.loginMethod === 'google' ? 'Google' : user.loginMethod}</span>}
          </p>
        )}
        <p className="num flex items-center gap-2 text-sm text-text-0">
          {shortHex(user.address, 8, 6)}
          {explorer && (
            <a href={explorer} target="_blank" rel="noopener noreferrer" aria-label="View on explorer" className="text-accent-2">
              <ExternalLink size={14} />
            </a>
          )}
        </p>
        <p className="text-xs text-text-2">
          Your Tempo wallet, created by Privy when you signed in. Tempo {isTestnet ? 'Moderato testnet (pathUSD)' : 'mainnet (USDC.e)'}, chain {String(env.chainId)}.
        </p>
      </section>

      <section className="space-y-2" aria-label="Appearance">
        <p className="num text-2xs tracking-wider-ui text-text-2 uppercase">Appearance</p>
        <Switch label="Light theme" checked={theme === 'light'} onChange={(on) => { setTheme(on ? 'light' : 'dark'); }} className="rounded-lg bg-bg-1 p-3 shadow-hairline" />
        <Switch label="Reduce motion" description="Opacity-only transitions everywhere" checked={forceReduced} onChange={setForceReduced} className="rounded-lg bg-bg-1 p-3 shadow-hairline" />
      </section>

      <section className="space-y-2" aria-label="Account">
        <p className="num text-2xs tracking-wider-ui text-text-2 uppercase">Account</p>
        <button
          type="button"
          disabled={auth.signOut.isPending}
          onClick={() => {
            auth.signOut.mutate(undefined, {
              onSettled: () => {
                window.location.assign('/');
              },
            });
          }}
          className="rounded-lg border border-signal/40 px-3 py-1.5 text-sm text-signal transition-colors hocus:bg-signal/10 disabled:opacity-60"
        >
          {auth.signOut.isPending ? 'Signing out…' : 'Sign out'}
        </button>
        <p className="text-xs text-text-2">Money locked for chats returns to your wallet automatically. To stop this browser from paying, revoke the spending key above before you sign out.</p>
      </section>

      <footer className="space-y-1 text-xs text-text-2">
        <p className="num tracking-wider-ui uppercase">Quality data: LMArena, Artificial Analysis</p>
        <p>LMArena leaderboard data is CC-BY-4.0. Models are available via MPP gateways; SmartRouter is not partnered with the model companies.</p>
      </footer>
    </div>
  );
}
