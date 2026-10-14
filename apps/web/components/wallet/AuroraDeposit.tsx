'use client';

import { clsx } from 'clsx';
import { CheckCircle2, Globe2, Loader2, TriangleAlert } from 'lucide-react';

import type { AuroraRecipe, Wallet } from '@/lib/api/types';
import { auroraSourceChains } from '@/lib/monad/aurora';

import { useAuroraDeposit } from '@/hooks/useAuroraDeposit';
import { useDepositStore } from '@/stores/depositStore';

import { CopyAddress } from '@/components/wallet/CopyAddress';
import { QrCode } from '@/components/wallet/QrCode';

const MIN_USD = 1;

function minutesLeft(iso: string | null): string {
  if (!iso) return '';
  const m = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  return Number.isFinite(m) && m > 0 ? ` within ${String(m)} min` : '';
}

/** Not configured on this backend (or still loading): a calm dashed placeholder. */
export function AuroraUnavailable({ note }: { note?: string }) {
  return (
    <div className="dashed-card space-y-1 rounded-xl p-4 text-center">
      <p className="text-sm text-text-0">Other chains: coming soon</p>
      <p className="text-xs text-text-2">{note || 'Deposits from Base, Arbitrum and other chains are not switched on yet. Use Monad or Card for now.'}</p>
    </div>
  );
}

/**
 * Other chains (Aurora Intents Connect): pick the source chain and amount, sign once with the
 * SmartRouter wallet, then send USDC on that chain to the one-time deposit address. Aurora bridges
 * it to Monad and its intermediary runs `approve` + `vault.depositFor`, so it lands in the AI
 * balance directly.
 */
export function AuroraDeposit({ wallet, recipe }: { wallet: Wallet; recipe: AuroraRecipe }) {
  const chains = auroraSourceChains(recipe);
  const { auroraChain, auroraAmount, aurora, setAuroraChain, setAuroraAmount } = useDepositStore();
  const { start, cancel } = useAuroraDeposit();
  const chain = chains.find((c) => c.chain === auroraChain) ?? chains[0];
  const amountUsd = Number(auroraAmount);
  const busy = aurora.phase !== 'idle' && aurora.phase !== 'failed' && aurora.phase !== 'success';

  if (!recipe.available || chains.length === 0) return <AuroraUnavailable note={recipe.note} />;

  if (aurora.phase === 'success') {
    return (
      <div role="status" className="space-y-3 rounded-xl bg-free/10 p-4 text-center">
        <CheckCircle2 size={24} className="mx-auto text-free" aria-hidden="true" />
        <p className="text-sm text-text-0">Bridged and added to your AI balance.</p>
        <button type="button" onClick={cancel} className="text-xs text-accent-2">
          Make another deposit
        </button>
      </div>
    );
  }

  if (aurora.depositAddress && (aurora.phase === 'awaiting-deposit' || aurora.phase === 'settling' || aurora.phase === 'expired')) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-text-0">
          Send <span className="num">${amountUsd.toFixed(2)}</span> USDC on {chain?.name ?? 'the chosen chain'} to this address{minutesLeft(aurora.deadline)}.
        </p>
        <div className="flex justify-center">
          <QrCode value={aurora.depositAddress} label={`One-time deposit address on ${chain?.name ?? 'the source chain'}`} />
        </div>
        <div className="flex justify-center">
          <CopyAddress address={aurora.depositAddress} full />
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
          Only USDC on {chain?.name ?? 'this chain'}, and only to this one-time address. It is not your Monad address.
        </p>
        <p role="status" className="flex items-center justify-center gap-2 text-xs text-text-2">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          {aurora.phase === 'settling' ? 'Deposit received. Bridging to Monad and adding it to your AI balance…' : aurora.phase === 'expired' ? 'The deposit window passed. A late deposit is still picked up.' : 'Waiting for your deposit…'}
        </p>
        <button type="button" onClick={cancel} className="mx-auto block text-xs text-text-2 hocus:text-text-0">
          Start over
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chain || !(amountUsd >= MIN_USD) || busy) return;
        void start({ recipe, address: wallet.address, chain: chain.chain, amountUsd });
      }}
    >
      <p className="flex items-start gap-2 text-sm text-text-1">
        <Globe2 size={16} className="mt-0.5 shrink-0 text-accent-2" aria-hidden="true" />
        Deposit USDC from another chain. It is bridged to Monad and added to your AI balance in one go.
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Source chain">
        {chains.map((c) => (
          <button
            key={c.chain}
            type="button"
            role="radio"
            aria-checked={chain?.chain === c.chain}
            disabled={busy}
            onClick={() => {
              setAuroraChain(c.chain);
            }}
            className={clsx('h-8 rounded-pill px-3 text-xs transition-colors', chain?.chain === c.chain ? 'bg-accent/20 text-text-0 shadow-hairline' : 'bg-bg-1 text-text-1 hocus:text-text-0')}
          >
            {c.name}
          </button>
        ))}
      </div>
      <label className="num flex h-10 items-center gap-1 rounded-lg bg-bg-1 px-3 text-sm text-text-1 shadow-hairline">
        $
        <input
          type="number"
          inputMode="decimal"
          min={MIN_USD}
          step="1"
          aria-label="Amount in USD"
          value={auroraAmount}
          disabled={busy}
          onChange={(e) => {
            setAuroraAmount(e.target.value);
          }}
          className="w-full bg-transparent text-text-0 outline-none"
        />
      </label>
      {aurora.phase === 'failed' && aurora.error && (
        <p role="alert" className="text-sm text-signal">
          {aurora.error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !chain || !(amountUsd >= MIN_USD)}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
      >
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
        {aurora.phase === 'preparing' ? 'Preparing…' : aurora.phase === 'signing' ? 'Confirm in your wallet…' : `Get ${chain?.name ?? ''} deposit address`}
      </button>
      <p className="text-xs text-text-2">One signature to authorize the deposit (no gas). Powered by Aurora Intents. Network fees come out of the bridged amount.</p>
    </form>
  );
}
