'use client';

import { useMemo, useState } from 'react';

import { clsx } from 'clsx';
import { ArrowLeft, CreditCard } from 'lucide-react';

import { isApiError } from '@/lib/api/client';
import type { Wallet, WalletChainOption } from '@/lib/api/types';
import { fundWithCard } from '@/lib/auth/session';
import { isTestnet } from '@/lib/env';

import { useDepositAddress, useWalletOptions } from '@/hooks/useWallet';
import { toast } from '@/stores/toastStore';

import { CopyAddress } from '@/components/wallet/CopyAddress';
import { QrCode } from '@/components/wallet/QrCode';

type Tab = 'tempo' | 'chain' | 'card';

const keyOf = (o: WalletChainOption) => `${o.chain}:${o.token}`;

/**
 * Deposit (Handover "Deposit", options from `GET /wallet/options` → `deposit[]`):
 * - Tempo: the main wallet address and its QR code; arrives instantly.
 * - Other chain: a personal deposit address on that chain (`POST /wallet/deposit-address`) with its
 *   note; arrives as USDC.e minus the bridge fee.
 * - Card: Privy's card checkout to the Base USDC deposit address.
 * While open, `GET /wallet` is refreshed every 10 s and "Funds arrived" shows when the balance goes up.
 * Testnet: only the Tempo tab exists.
 */
export function DepositPanel({ wallet, onBack, arrived }: { wallet: Wallet; onBack: () => void; arrived: boolean }) {
  const options = useWalletOptions();
  const bridges = useMemo(() => (options.data?.deposit ?? []).filter((o) => o.method === 'bridge' && o.depositAvailable), [options.data]);
  const crossChain = wallet.features.crossChain && bridges.length > 0;
  const card = wallet.features.card && options.data?.card;
  const [tab, setTab] = useState<Tab>('tempo');
  const [picked, setPicked] = useState<string | null>(null);
  const [refund, setRefund] = useState('');
  const [cardAmount, setCardAmount] = useState('20');
  const [cardBusy, setCardBusy] = useState(false);

  const option = bridges.find((o) => keyOf(o) === picked) ?? null;
  const needsRefund = option?.vmType === 'svm' || option?.chain === 'solana';
  const addr = useDepositAddress(tab === 'chain' && option ? option.chain : null, option?.token ?? null, needsRefund && refund ? refund : undefined);
  const baseAddr = useDepositAddress(tab === 'card' ? 'base' : null, tab === 'card' ? 'USDC' : null);

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'tempo', label: 'Tempo', show: true },
    { id: 'chain', label: 'Other chain', show: crossChain },
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

      {tab === 'tempo' && (
        <section className="space-y-3" aria-label="Deposit on Tempo">
          <div className="flex justify-center">
            <QrCode value={wallet.address} label="Your Tempo wallet address" />
          </div>
          <div className="flex justify-center">
            <CopyAddress address={wallet.address} full />
          </div>
          <p className="text-center text-xs text-text-2">
            Send {wallet.token.symbol} on {wallet.network?.name ?? 'Tempo'} to this address. It arrives instantly.
            {isTestnet && ' On testnet you can also use Get test funds.'}
          </p>
        </section>
      )}

      {tab === 'chain' && (
        <section className="space-y-3" aria-label="Deposit from another chain">
          <label className="block space-y-1 text-sm">
            <span className="text-text-1">Network and token</span>
            <select
              value={picked ?? ''}
              onChange={(e) => {
                setPicked(e.target.value || null);
              }}
              className="h-10 w-full rounded-lg bg-bg-1 px-3 text-text-0 shadow-hairline outline-none"
            >
              <option value="">Choose…</option>
              {bridges.map((o) => (
                <option key={keyOf(o)} value={keyOf(o)}>
                  {o.token} on {o.chainName || o.chain}
                </option>
              ))}
            </select>
          </label>
          {needsRefund && (
            <label className="block space-y-1 text-sm">
              <span className="text-text-1">Your {option.chainName || 'Solana'} address (optional, for refunds)</span>
              <input
                value={refund}
                onChange={(e) => {
                  setRefund(e.target.value.trim());
                }}
                placeholder="Where a too-small deposit is refunded"
                className="h-10 w-full rounded-lg bg-bg-1 px-3 text-text-0 shadow-hairline outline-none placeholder:text-text-2"
              />
            </label>
          )}
          {option && addr.isPending && <p className="text-sm text-text-2">Getting your deposit address…</p>}
          {option && addr.isError && <p className="text-sm text-signal">{isApiError(addr.error) ? addr.error.message : 'Could not get a deposit address.'}</p>}
          {addr.data && (
            <div className="space-y-3">
              <div className="flex justify-center">
                <QrCode value={addr.data.address} label={`Deposit address on ${addr.data.chainName ?? addr.data.chain}`} />
              </div>
              <div className="flex justify-center">
                <CopyAddress address={addr.data.address} explorer={false} full />
              </div>
              {addr.data.note && <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-text-0">{addr.data.note}</p>}
              {addr.data.estimate && (
                <p className="text-xs text-text-2">
                  Bridge fee about ${addr.data.estimate.feeUsd.toFixed(2)}
                  {addr.data.estimate.etaSeconds ? ` · usually under ${String(Math.max(1, Math.round(addr.data.estimate.etaSeconds / 60)))} min` : ''}.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {tab === 'card' && (
        <section className="space-y-3" aria-label="Deposit by card">
          <p className="text-sm text-text-1">Pay by card, Apple Pay or Google Pay. It arrives in your wallet as USDC.e a few minutes after the payment.</p>
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
            disabled={!baseAddr.data || cardBusy || !(Number(cardAmount) > 0)}
            onClick={() => {
              if (!baseAddr.data) return;
              setCardBusy(true);
              fundWithCard({ address: baseAddr.data.address, amountUsd: Number(cardAmount) })
                .catch((err: unknown) => {
                  toast.error('Card checkout failed', err instanceof Error ? err.message : undefined);
                })
                .finally(() => {
                  setCardBusy(false);
                });
            }}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
          >
            <CreditCard size={16} /> {cardBusy ? 'Opening checkout…' : baseAddr.isPending ? 'Preparing…' : 'Continue to card checkout'}
          </button>
          {baseAddr.isError && <p className="text-sm text-signal">{isApiError(baseAddr.error) ? baseAddr.error.message : 'Card deposits are unavailable right now.'}</p>}
          {options.data?.card?.note && <p className="text-xs text-text-2">{options.data.card.note}</p>}
        </section>
      )}
    </div>
  );
}
