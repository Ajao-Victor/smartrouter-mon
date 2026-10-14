'use client';

import { motion } from 'motion/react';

import { useReducedMotionSafe } from '@/lib/motion/useReducedMotionSafe';
import { fadeUp, floatLoop, revealItem, staggerWords, withReduced } from '@/lib/motion/variants';

import { RouterOrb } from '@/components/fx/RouterOrb';
import { Button } from '@/components/ui/Button';
import { MagneticButton } from '@/components/ui/MagneticButton';

/** PDF pitch, verbatim. */
export const PITCH =
  'Tell SmartRouter what you want done. It picks the best AI for your budget, and you pay per use in USDC on Monad, from anywhere.';

/** The headline is the first sentence; the rest reads as the lead so the pitch fits on a phone. */
const HEADLINE = 'Tell SmartRouter what you want done.';
const LEAD = PITCH.slice(HEADLINE.length).trim();

export interface HeroProps {
  onSignIn: () => void;
  signingIn?: boolean;
  /** Navigate to the app (`/chat`); the page owns the transition so the button can show pending. */
  onStart: () => void;
  starting?: boolean;
}

export function Hero({ onSignIn, signingIn = false, onStart, starting = false }: HeroProps) {
  const reduced = useReducedMotionSafe();
  const words = withReduced(revealItem, reduced);
  const rise = withReduced(fadeUp, reduced);

  return (
    <section className="relative grid items-center gap-8 py-10 sm:py-14 md:grid-cols-[1.3fr_1fr] md:gap-10 md:py-20">
      <div className="space-y-6">
        <motion.p
          variants={rise}
          initial="hidden"
          animate="visible"
          className="num text-2xs tracking-wider-ui text-text-2 uppercase sm:tracking-label"
        >
          AI model marketplace · pay per use in USDC on Monad
        </motion.p>
        <motion.h1
          variants={staggerWords}
          initial="hidden"
          animate="visible"
          className="font-display max-w-[16ch] text-3xl font-semibold tracking-tight text-balance text-text-0 sm:text-display-sm md:text-display"
        >
          {HEADLINE.split(' ').map((w, i) => (
            <motion.span key={`${w}-${String(i)}`} variants={words} className="inline-block">
              {i < 2 ? <span className="text-beam">{w}</span> : w}&nbsp;
            </motion.span>
          ))}
        </motion.h1>
        <motion.p
          variants={rise}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.6 }}
          className="max-w-prose text-base leading-7 text-text-1 sm:text-lg sm:leading-8"
        >
          {LEAD}
        </motion.p>
        <motion.div
          variants={rise}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.8 }}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <MagneticButton
            size="lg"
            className="w-full sm:w-auto"
            onClick={onStart}
            loading={starting}
          >
            Start a task
          </MagneticButton>
          <Button
            variant="secondary"
            size="lg"
            className="w-full sm:w-auto"
            onClick={onSignIn}
            loading={signingIn}
          >
            Sign in with email or Google
          </Button>
        </motion.div>
        <motion.p
          variants={rise}
          initial="hidden"
          animate="visible"
          transition={{ delay: 1 }}
          className="text-sm text-text-2"
        >
          No subscriptions. No API keys. Top up with USDC on Monad; whatever you don&apos;t spend
          returns to your wallet.
        </motion.p>
      </div>
      <motion.div
        className="mx-auto hidden md:block"
        {...(reduced ? {} : { variants: floatLoop, animate: 'float' })}
        aria-hidden="true"
      >
        <RouterOrb size={220} activity={0.25} />
      </motion.div>
    </section>
  );
}
