'use client';

import { useEffect, useState } from 'react';

import { clsx } from 'clsx';
import { ArrowLeft, CreditCard, Sparkles } from 'lucide-react';

import type { Wallet } from '@/lib/api/types';
import { fundWithCard } from '@/lib/auth/session';
import { formatUsd, micro } from '@/lib/money';

import { useDepositToAi, useWalletOptions } from '@/hooks/useWallet';
import { useAllocationStore } from '@/stores/allocationStore';
import { toast } from '@/stores/toastStore';

import { CopyAddress } from '@/components/wallet/CopyAddress';
import { QrCode } from '@/components/wallet/QrCode';

type Tab = 'monad' | 'card';

const usd = (micro: number) => micro / 1_000_000;

/**
 * Deposit on Monad (Monad handoff §5.4, `GET /wallet/options`):
 *
 * 1. Get Circle USDC on Monad into the wallet — send it to the wallet address (QR code), or buy it
 *    by card through Privy (it lands in the same wallet).
 * 2. Move it into the AI balance — one Privy signature (ERC-3009 ReceiveWithAuthorization) that
 *    SmartRouter relays into the vault, paying the MON gas.
 *
 * While open, `GET /wallet` is refreshed every 10 s and "Funds arrived" shows when the balance goes up.
 */
export function DepositPanel({ wallet, onBack, arrived }: { wallet: Wallet; onBack: () => void; arrived: boolean }) {
  const options = useWalletOptions();
  const card = wallet.features.card ? options.data?.card : null;
  const suggested = useAllocationStore((s) => s.suggestedDepositUsd);
  const deposit = useDepositToAi();
  const [tab, setTab] = useState<Tab>('monad');
  const [cardAmount, setCardAmount] = useState('20');
  const [cardBusy, setCardBusy] = useState(false);

  const main = wallet.main.balanceUsd;
  const [moveAmount, setMoveAmount] = useState('');
  // Prefill: the suggested top-up, never more than what the wallet holds.
  useEffect(() => {
    if (moveAmount !== '' || main <= 0) return;
    const pick = Math.min(main, suggested > 0 ? suggested : main);
    setMoveAmount(usd(pick).toFixed(2));
  }, [main, suggested, moveAmount]);
  const moveUsd = Number(moveAmount);
  const moveTooMuch = moveUsd * 1_000_000 > main;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'monad', label: 'Monad', show: true },
    { id: 'card', label: 'Card', show: Boolean(card) },
  ];

  return (
    <div className="space-y-5 pb-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-text-1 hocus:text-text-0">
        <ArrowLeft size={14} /> Wallet
      </button>
      <h3 className="font-display text-lg text-text-0">Deposit</h3>
      {arrived && (
        <p role="status" className="rounded-lg bg-free/15 px-3 py-2 text-sm text-free">
          Funds arrived.
        </p>
      )}

      {/* Step 2 first when there's something to move: that's what unlocks paid answers. */}
      <section className="space-y-3 rounded-xl bg-bg-1 p-4 shadow-hairline" aria-label="Move to AI balance">
        <div className="flex items-start gap-2">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-accent-2" aria-hidden="true" />
          <div>
            <p className="text-sm text-text-0">Move USDC to your AI balance</p>
            <p className="text-xs text-text-2">
              Wallet <span className="num text-text-1">{formatUsd(main)}</span> · AI balance <span className="num text-text-1">{formatUsd(wallet.ai?.remainingUsd ?? micro(0))}</span>
            </p>
          </div>
        </div>
        {main > 0 ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!(moveUsd > 0) || moveTooMuch) return;
              deposit.mutate({ wallet, amountUsd: moveUsd });
            }}
          >
            <label className="num flex h-10 items-center gap-1 rounded-lg bg-bg-2 px-3 text-sm text-text-1">
              $
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                aria-label="Amount to move, in USD"
                value={moveAmount}
                onChange={(e) => {
                  setMoveAmount(e.target.value);
                }}
                className="w-full bg-transparent text-text-0 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setMoveAmount(usd(main).toFixed(2));
                }}
                className="text-xs text-accent-2"
              >
                Max
              </button>
            </label>
            {moveTooMuch && <p className="text-sm text-signal">That&apos;s more than your wallet holds.</p>}
            <button
              type="submit"
              disabled={deposit.isPending || !(moveUsd > 0) || moveTooMuch}
              className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
            >
              {deposit.isPending ? 'Confirm in your wallet…' : moveUsd > 0 ? `Move $${moveUsd.toFixed(2)} to AI balance` : 'Move to AI balance'}
            </button>
            <p className="text-xs text-text-2">One signature. SmartRouter submits it on Monad and pays the gas. Return it to your wallet any time.</p>
          </form>
        ) : (
          <p className="text-xs text-text-2">Add USDC on Monad to your wallet below first.</p>
        )}
      </section>

      <div className="flex gap-1 rounded-lg bg-bg-1 p-1" role="tablist" aria-label="Deposit method">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={clsx('h-8 flex-1 rounded-md text-sm transition-colors', tab === t.id ? 'bg-bg-3 text-text-0' : 'text-text-1 hocus:text-text-0')}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === 'monad' && (
        <section className="space-y-3" aria-label="Deposit on Monad">
          <div className="flex justify-center">
            <QrCode value={wallet.address} label="Your Monad wallet address" />
          </div>
          <div className="flex justify-center">
            <CopyAddress address={wallet.address} full />
          </div>
          <p className="text-center text-xs text-text-2">
            Send {wallet.token.symbol} on {wallet.network?.name ?? 'Monad'} to this address. Only Circle USDC on Monad counts:
          </p>
          <p className="num text-center text-2xs break-all text-text-2">{wallet.token.address}</p>
          <p className="text-center text-xs text-text-2">You don&apos;t need MON: SmartRouter pays the gas for everything you do here.</p>
        </section>
      )}

      {tab === 'card' && card && (
        <section className="space-y-3" aria-label="Deposit by card">
          <p className="text-sm text-text-1">Pay by card, Apple Pay or Google Pay. It arrives in your wallet as USDC on Monad a few minutes after the payment.</p>
          <label className="num flex h-10 items-center gap-1 rounded-lg bg-bg-1 px-3 text-sm text-text-1 shadow-hairline">
            $
            <input
              type="number"
              inputMode="decimal"
              min={5}
              step="1"
              aria-label="Amount in USD"
              value={cardAmount}
              onChange={(e) => {
                setCardAmount(e.target.value);
              }}
              className="w-full bg-transparent text-text-0 outline-none"
            />
          </label>
          <button
            type="button"
            disabled={cardBusy || !(Number(cardAmount) > 0)}
            onClick={() => {
              setCardBusy(true);
              fundWithCard({ address: wallet.address, amountUsd: Number(cardAmount) })
                .catch((err: unknown) => {
                  toast.error('Card checkout failed', err instanceof Error ? err.message : undefined);
                })
                .finally(() => {
                  setCardBusy(false);
                });
            }}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
          >
            <CreditCard size={16} /> {cardBusy ? 'Opening checkout…' : 'Continue to card checkout'}
          </button>
          {card.note && <p className="text-xs text-text-2">{card.note}</p>}
        </section>
      )}
    </div>
  );
}
