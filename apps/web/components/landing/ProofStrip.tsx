'use client';

import { motion } from 'motion/react';

import { useReducedMotionSafe } from '@/lib/motion/useReducedMotionSafe';

/** PDF: ten MPP providers at launch; listings are "available via MPP", never "partnered with". */
const PROVIDERS = ['OpenAI', 'Anthropic', 'OpenRouter', 'DeepSeek', 'Mistral AI', 'Groq', 'Perplexity', 'fal.ai', 'StableStudio', 'Suno'];

export function ProofStrip() {
  const reduced = useReducedMotionSafe();
  const items = [...PROVIDERS, ...PROVIDERS];
  return (
    <section className="space-y-3">
      <p className="num text-center text-sm text-text-1">
        <span className="text-text-0">10 providers</span> · <span className="text-text-0">~40 models</span> · paid per use in USDC on Monad
      </p>
      <div className="glass scrollbar-none relative overflow-hidden rounded-pill py-2" aria-label="Providers available via MPP">
        <motion.ul
          className="flex w-max gap-8 px-4"
          {...(reduced ? {} : { animate: { x: ['0%', '-50%'] }, transition: { duration: 28, repeat: Infinity, ease: 'linear' } })}
        >
          {items.map((p, i) => (
            <li key={`${p}-${String(i)}`} className="num flex shrink-0 items-center gap-2 text-xs text-text-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-2" aria-hidden="true" />
              {p}
              <span className="text-text-2">· available via MPP</span>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
