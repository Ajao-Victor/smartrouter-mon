'use client';

import { useEffect, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/useAuth';

import { ComingSoonTeasers } from '@/components/landing/ComingSoonTeasers';
import { Hero } from '@/components/landing/Hero';
import { LandingFx } from '@/components/landing/LandingFx';
import { ProofStrip } from '@/components/landing/ProofStrip';
import { SavingProof } from '@/components/landing/SavingProof';
import { TaskChips } from '@/components/landing/TaskChips';
import { Attribution } from '@/components/ui/Attribution';
import { Button } from '@/components/ui/Button';

export default function HomePage() {
  const router = useRouter();
  const auth = useAuth();
  // `/chat` is a heavy route (R3F, markdown): prefetch it and show a pending state while it loads
  // so "Start a task" / "Open app" never look dead (dev compiles it on first navigation).
  const [navigating, startNavigation] = useTransition();
  useEffect(() => {
    router.prefetch('/chat');
  }, [router]);
  // Signed in (including on return from Google's redirect, where no callback survives): go
  // straight to the chat.
  const signedIn = auth.isSignedIn;
  useEffect(() => {
    if (signedIn) router.replace('/chat');
  }, [signedIn, router]);
  const openApp = () => {
    startNavigation(() => {
      router.push('/chat');
    });
  };
  // Privy (email or Google) → POST /auth/privy → session token → app. Signed in already: straight in.
  const onSignIn = () => {
    if (auth.isSignedIn) {
      openApp();
      return;
    }
    auth.signIn(() => {
      router.replace('/chat');
    });
  };

  return (
    <>
      <LandingFx />
      {/* The field layers are fixed at z-field (0); the content sits above them. */}
      <div className="relative z-content mx-auto max-w-5xl px-4">
        <header className="flex h-14 items-center justify-between">
          <span className="font-display text-base font-semibold text-text-0">
            Smart<span className="text-beam">Router</span>
          </span>
          <div className="flex items-center gap-2">
            {!auth.isSignedIn && (
              <Button variant="ghost" size="sm" onClick={onSignIn} loading={auth.signingIn}>
                Sign in
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={openApp} loading={navigating}>
              Open app
            </Button>
          </div>
        </header>
        <main className="space-y-20 pb-24">
          <Hero
            onSignIn={onSignIn}
            signingIn={auth.signingIn}
            onStart={openApp}
            starting={navigating}
          />
          <TaskChips />
          <SavingProof />
          <ProofStrip />
          <ComingSoonTeasers />
        </main>
        <footer className="flex flex-col gap-2 border-t border-line py-8 text-xs text-text-2 sm:flex-row sm:items-center sm:justify-between">
          <Attribution />
          <p>Pay per answer in USDC on Monad · Gas sponsored · AI providers paid via MPP</p>
        </footer>
      </div>
    </>
  );
}
