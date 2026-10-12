'use client';

import { useEffect, useRef, useState } from 'react';

import { motion, useInView } from 'motion/react';

import { micro } from '@/lib/money';
import { useReducedMotionSafe } from '@/lib/motion/useReducedMotionSafe';
import { fadeUp, stagger, withReduced } from '@/lib/motion/variants';

import { useGlowTrail } from '@/components/fx/GlowTrail';
import { HoloCard } from '@/components/fx/HoloCard';
import { Attribution } from '@/components/ui/Attribution';
import { PriceTag } from '@/components/ui/PriceTag';

/** Live testnet catalogue on Oct 12, writing task: GPT-5.6 Sol scores 0.815 to Opus's 1.0 at $0.012 vs $0.024. */
const CHEAP = { label: 'GPT-5.6 Sol', provider: 'OpenAI', price: micro(12_000) };
const BEST = { label: 'Claude Opus 5.5', provider: 'Anthropic', price: micro(24_000) };
export const SAVING_LINE = '82% of the best quality at half the price';

export function SavingProof() {
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLDivElement | null>(null);
  const cheapRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLParagraphElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '-20% 0px' });
  const drawTrail = useGlowTrail();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!inView || shown) return;
    setShown(true);
    const t = window.setTimeout(() => {
      drawTrail(cheapRef.current, [lineRef.current], 'teal');
    }, 500);
    return () => {
      window.clearTimeout(t);
    };
  }, [inView, shown, drawTrail]);

  return (
    <motion.section
      ref={ref}
      variants={withReduced(stagger({ each: 0.12 }), reduced)}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className="space-y-6"
    >
      <motion.p variants={withReduced(fadeUp, reduced)} className="num text-2xs tracking-label text-text-2 uppercase">
        Writing task · live prices · Oct 12
      </motion.p>
      <div className="grid gap-4 sm:grid-cols-2">
        <HoloCard ref={cheapRef} tone="teal" interactive className="p-5">
          <p className="text-sm text-text-2">{CHEAP.provider} · via MPP</p>
          <p className="font-display mt-1 text-xl text-text-0">{CHEAP.label}</p>
          <div className="mt-4">
            <PriceTag micro={shown ? CHEAP.price : micro(0)} size="xl" />
          </div>
          <p className="mt-1 text-xs text-text-2">per request</p>
        </HoloCard>
        <HoloCard tone="accent" interactive className="p-5">
          <p className="text-sm text-text-2">{BEST.provider} · via MPP</p>
          <p className="font-display mt-1 text-xl text-text-0">{BEST.label}</p>
          <div className="mt-4">
            <PriceTag micro={shown ? BEST.price : micro(0)} size="xl" tone="neutral" />
          </div>
          <p className="mt-1 text-xs text-text-2">per request · best quality</p>
        </HoloCard>
      </div>
      <motion.p ref={lineRef} variants={withReduced(fadeUp, reduced)} className="font-display text-2xl text-text-0 md:text-3xl">
        <span className="text-beam">{SAVING_LINE}</span>
      </motion.p>
      <Attribution />
    </motion.section>
  );
}
