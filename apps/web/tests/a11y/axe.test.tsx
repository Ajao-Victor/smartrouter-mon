import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import axe from 'axe-core';

import { micro } from '@/lib/money';

import HomePage from '@/app/page';

import { PaidBlockBar } from '@/components/allocation/PaidBlockBar';
import { Composer } from '@/components/chat/Composer';
import { ModelOptions } from '@/components/chat/ModelOptions';
import { ReducedMotionProvider } from '@/components/layout/ReducedMotionProvider';
import { CapsEditor } from '@/components/wallet/CapsEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/' }));
vi.mock('@/lib/api/endpoints', () => ({ api: { catalog: { list: vi.fn().mockResolvedValue([]) }, auth: { challenge: vi.fn(), verify: vi.fn(), logout: vi.fn() } } }));
vi.mock('@/components/landing/LandingFx', () => ({ LandingFx: () => null }));

async function serious(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout; contrast is checked manually (UI_UX_Brief §2)
  });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReducedMotionProvider forceReduced>{ui}</ReducedMotionProvider>
    </QueryClientProvider>,
  );
}

describe('accessibility (axe, serious/critical only)', () => {
  it('landing page', async () => {
    const { container } = wrap(<HomePage />);
    expect(await serious(container)).toEqual([]);
  }, 20_000);

  it('chat money components: options, composer, top-up bar, allocation controls', async () => {
    const { container } = wrap(
      <main>
        <ModelOptions
          options={[
            { modelId: 'a', label: 'GLM 5.3 Flash', provider: 'OpenRouter', quoteId: 'q', priceUsd: micro(900), speed: 'fast', reason: 'r', free: false, quality: 0.8, bestQuality: false, expiresAt: null },
            { modelId: 'f', label: 'Free · Llama 3.1 8B', provider: 'CF', quoteId: null, priceUsd: micro(0), speed: 'fast', reason: 'r', free: true, quality: 0.5, bestQuality: false, expiresAt: null },
          ]}
          onPick={vi.fn()}
        />
        <Composer quote={{ priceUsd: micro(900), free: false }} currentModel={{ label: 'GLM 5.3 Flash', isFree: false }} onSend={vi.fn()} />
        <PaidBlockBar meter="daily" message="You've reached today's spending cap" freeAvailable onRaiseCap={vi.fn()} onAddFunds={vi.fn()} onContinueFree={vi.fn()} />
        <CapsEditor dailyLimitUsd={micro(2_000_000)} weeklyLimitUsd={micro(10_000_000)} autoFreeFallback onSave={vi.fn()} />
      </main>,
    );
    expect(await serious(container)).toEqual([]);
  }, 20_000);
});
