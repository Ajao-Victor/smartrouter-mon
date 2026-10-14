'use client';

import { useState } from 'react';

import { notFound } from 'next/navigation';

import { micro } from '@/lib/money';

import { toast } from '@/stores/toastStore';

import { Attribution } from '@/components/ui/Attribution';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dialog } from '@/components/ui/Dialog';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Textarea } from '@/components/ui/Input';
import { MagneticButton } from '@/components/ui/MagneticButton';
import { PriceTag } from '@/components/ui/PriceTag';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { Tooltip } from '@/components/ui/Tooltip';

const DETENTS = [
  { label: 'Cheapest' },
  { label: 'Balanced' },
  { label: 'Best quality' },
] as const;

const PRICES = [800, 26_000, 2_000_000, 0] as const;

/** Dev-only primitives gallery (Task 6 acceptance). 404 in production. */
export default function PrimitivesPage() {
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [detent, setDetent] = useState(1);
  const [priceIdx, setPriceIdx] = useState(0);
  const [chip, setChip] = useState('writing');
  const [err, setErr] = useState<string | undefined>(undefined);

  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto max-w-4xl space-y-12 px-4 py-12">
      <header className="space-y-2">
        <p className="num text-2xs tracking-label text-text-2 uppercase">dev · primitives</p>
        <h1 className="font-display text-display-sm text-text-0">
          Building <span className="text-beam">blocks</span>
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-text-0">Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <MagneticButton>Run · $0.0008</MagneticButton>
          <Button variant="secondary">Switch model</Button>
          <Button variant="ghost">Dismiss</Button>
          <Button variant="free">Continue free</Button>
          <Button variant="danger">Revoke</Button>
          <Button loading>Signing…</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button size="lg">Open allocation</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-text-0">Chips</h2>
        <div className="flex flex-wrap gap-2">
          {['chat', 'writing', 'coding', 'research', 'translation', 'image', 'music'].map((c) => (
            <Chip key={c} selected={chip === c} onClick={() => { setChip(c); }}>
              {c}
            </Chip>
          ))}
          <Chip tone="free" selected>
            Free · Llama 3.1 8B
          </Chip>
          <Chip tone="quality">Best quality</Chip>
          <Chip tone="teal">Searches the web</Chip>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-text-0">Price tags (tick on change)</h2>
        <div className="flex flex-wrap items-end gap-6">
          <PriceTag micro={micro(PRICES[priceIdx] ?? 0)} size="xl" freeLabel />
          <PriceTag micro={micro(26_000)} size="lg" tone="neutral" />
          <PriceTag micro={micro(2_000_000)} size="md" />
          <PriceTag micro={micro(0)} size="md" freeLabel />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setPriceIdx((i) => (i + 1) % PRICES.length); }}
          >
            Next price
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-text-0">Slider (mechanical detents)</h2>
        <div className="glass max-w-lg rounded-lg p-5">
          <Slider detents={DETENTS} value={detent} onChange={setDetent} aria-label="Price vs quality" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-text-0">Fields</h2>
        <div className="grid max-w-lg gap-4">
          <Input label="Email" placeholder="you@example.com" hint="For the naira waitlist" />
          <Input
            label="Allocation"
            placeholder="2"
            {...(err ? { error: err } : {})}
            onChange={(e) => { setErr(e.target.value === '0' ? 'Allocation must be above $0' : undefined); }}
          />
          <Textarea label="Describe the task" placeholder="Write a cover letter for…" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-text-0">Overlays &amp; feedback</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => { setSheet(true); }}>
            Open sheet
          </Button>
          <Button variant="secondary" onClick={() => { setDialog(true); }}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => { setDrawer(true); }}>
            Open drawer
          </Button>
          <Button variant="secondary" onClick={() => toast.success('Deposit received', '$2.00 USDC')}>
            Toast success
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Allocation used — Top up $2')}>
            Toast error
          </Button>
          <Tooltip content="Quality 0.45 · Price 0.4 · Speed 0.15">
            <Button variant="ghost">Hover me</Button>
          </Tooltip>
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-11 w-40" pill />
          <Skeleton className="h-24 w-full max-w-sm" />
        </div>
        <Attribution />
      </section>

      <Sheet open={sheet} onClose={() => { setSheet(false); }} title="Wallet">
        <p className="text-sm text-text-1">Drag down (or right on desktop) to dismiss.</p>
        <div className="mt-4 flex gap-3">
          <Button>Deposit</Button>
          <Button variant="secondary">Swap to USDC</Button>
        </div>
      </Sheet>
      <Dialog
        open={dialog}
        onClose={() => { setDialog(false); }}
        title="Spend permission"
        description="USDC on Monad only · payee SmartRouter vault · spending key expires in 7 days"
      >
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => { setDialog(false); }}>
            Cancel
          </Button>
          <MagneticButton onClick={() => { setDialog(false); }}>Approve with passkey</MagneticButton>
        </div>
      </Dialog>
      <Drawer open={drawer} onClose={() => { setDrawer(false); }} title="Receipt">
        <dl className="num space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-text-2">Price</dt><dd className="text-price">$0.0009</dd></div>
          <div className="flex justify-between"><dt className="text-text-2">Session</dt><dd>ch_01…9f</dd></div>
        </dl>
      </Drawer>
    </main>
  );
}
