import { env } from '@/lib/env';

/** Flags a fully mocked API (`NEXT_PUBLIC_MOCK=1`). SmartRouter runs on Monad mainnet only. */
export function TestnetBanner() {
  if (!env.mock) return null;
  return (
    <div role="status" className="relative z-content flex h-7 items-center justify-center border-b border-warn/30 bg-warn/10 text-center">
      <span className="num text-2xs tracking-wider-ui text-warn uppercase">Mock API — nothing here is on-chain</span>
    </div>
  );
}
