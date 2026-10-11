'use client';

import { useMemo, useState } from 'react';

import { ArrowLeft } from 'lucide-react';

import { isApiError } from '@/lib/api/client';
import type { SendInput, SendQuote, Wallet, WalletChainOption } from '@/lib/api/types';
import { formatUsd } from '@/lib/money';

import { useSend, useSendQuote, useWalletOptions } from '@/hooks/useWallet';

const keyOf = (o: WalletChainOption) => `${o.chain}:${o.token}`;

/**
 * Send (Handover "Send", options from `GET /wallet/options` → `send[]`): pick a network, paste an
 * address, enter an amount → `POST /wallet/send/quote` shows what arrives, the bridge fee and the
 * time → on confirm, one Tempo transaction signed with Privy, fee paid by SmartRouter (`/relay`).
 */
export function SendPanel({ wallet, onBack, onDone }: { wallet: Wallet; onBack: () => void; onDone: () => void }) {
  const options = useWalletOptions();
  const list = useMemo(() => (options.data?.send.length ? options.data.send : [{ chain: 'tempo', chainName: wallet.network?.name ?? 'Tempo', token: wallet.token.symbol, method: 'direct', vmType: 'evm', depositAvailable: true }]), [options.data, wallet]);
  const [picked, setPicked] = useState<string>('tempo:' + wallet.token.symbol);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ input: SendInput; data: SendQuote } | null>(null);
  const quoteMut = useSendQuote();
  const send = useSend();

  const option = list.find((o) => keyOf(o) === picked) ?? list[0];
  const amountUsd = Number(amount);
  const input: SendInput | null = option && to.trim() && amountUsd > 0 ? { chain: option.chain, token: option.chain === 'tempo' ? 'USDC' : option.token, to: to.trim(), amountUsd } : null;
  const quoteFresh = quote && input && JSON.stringify(quote.input) === JSON.stringify(input);
  const tooMuch = amountUsd * 1_000_000 > wallet.main.balanceUsd;

  return (
    <div className="space-y-5 pb-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-text-1 hocus:text-text-0">
        <ArrowLeft size={14} /> Wallet
      </button>
      <h3 className="font-display text-lg text-text-0">Send</h3>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input) return;
          if (!quoteFresh) {
            quoteMut.mutate(input, {
              onSuccess: (data) => {
                setQuote({ input, data });
              },
            });
            return;
          }
          send.mutate(input, { onSuccess: onDone });
        }}
      >
        <label className="block space-y-1 text-sm">
          <span className="text-text-1">Network</span>
          <select
            value={picked}
            onChange={(e) => {
              setPicked(e.target.value);
            }}
            className="h-10 w-full rounded-lg bg-bg-1 px-3 text-text-0 shadow-hairline outline-none"
          >
            {list.map((o) => (
              <option key={keyOf(o)} value={keyOf(o)}>
                {o.chain === 'tempo' ? `${wallet.token.symbol} on ${o.chainName || 'Tempo'}` : `${o.token} on ${o.chainName || o.chain}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-text-1">To address</span>
          <input
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            placeholder={option?.vmType === 'svm' ? 'Solana address' : '0x…'}
            className="num h-10 w-full rounded-lg bg-bg-1 px-3 text-text-0 shadow-hairline outline-none placeholder:text-text-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-text-1">Amount</span>
          <span className="num flex h-10 items-center gap-1 rounded-lg bg-bg-1 px-3 text-text-1 shadow-hairline">
            $
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              className="w-full bg-transparent text-text-0 outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setAmount((wallet.main.balanceUsd / 1_000_000).toFixed(2));
              }}
              className="text-xs text-accent-2"
            >
              Max
            </button>
          </span>
          <span className="text-xs text-text-2">Balance {formatUsd(wallet.main.balanceUsd)}</span>
        </label>

        {quoteFresh && (
          <dl className="space-y-1 rounded-lg bg-bg-1 p-3 text-sm shadow-hairline">
            <div className="flex justify-between">
              <dt className="text-text-2">They receive</dt>
              <dd className="num text-text-0">
                ${quote.data.receiveUsd.toFixed(2)}
                {quote.data.receiveMinUsd !== null && <span className="text-text-2"> (at least ${quote.data.receiveMinUsd.toFixed(2)})</span>}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-2">Bridge fee</dt>
              <dd className="num text-text-0">${quote.data.bridgeFeeUsd.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-2">Network fee</dt>
              <dd className="text-free">Paid by SmartRouter</dd>
            </div>
            {quote.data.etaSeconds !== null && (
              <div className="flex justify-between">
                <dt className="text-text-2">Time</dt>
                <dd className="num text-text-0">{quote.data.etaSeconds < 60 ? `${String(quote.data.etaSeconds)} s` : `${String(Math.round(quote.data.etaSeconds / 60))} min`}</dd>
              </div>
            )}
          </dl>
        )}
        {tooMuch && <p className="text-sm text-signal">That&apos;s more than your balance.</p>}
        {quoteMut.isError && <p className="text-sm text-signal">{isApiError(quoteMut.error) ? quoteMut.error.message : 'Could not get a quote.'}</p>}
        <button
          type="submit"
          disabled={!input || tooMuch || quoteMut.isPending || send.isPending}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
        >
          {send.isPending ? 'Sending…' : quoteMut.isPending ? 'Getting a quote…' : quoteFresh ? `Send $${amountUsd.toFixed(2)}` : 'Review'}
        </button>
        <p className="text-xs text-text-2">One signature. SmartRouter pays the Tempo network fee; you only pay the bridge fee for other chains, shown above.</p>
      </form>
    </div>
  );
}
