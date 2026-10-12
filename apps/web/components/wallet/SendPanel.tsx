'use client';

import { useEffect, useMemo, useState } from 'react';

import { ArrowLeft } from 'lucide-react';

import { isApiError } from '@/lib/api/client';
import type { SendCode, SendInput, SendQuote, Wallet, WalletChainOption } from '@/lib/api/types';
import { linkEmail } from '@/lib/auth/session';
import { formatUsd } from '@/lib/money';

import { useSend, useSendCode, useSendQuote, useWalletOptions } from '@/hooks/useWallet';

import { CodeInput } from '@/components/wallet/CodeInput';

const keyOf = (o: WalletChainOption) => `${o.chain}:${o.token}`;
const RESEND_SECONDS = 30;
const same = (a: SendInput, b: SendInput) => JSON.stringify(a) === JSON.stringify(b);
const short = (to: string) => (to.length > 14 ? `${to.slice(0, 6)}…${to.slice(-4)}` : to);

/** The emailed code for one exact send (chain, token, recipient, amount). */
interface Pending {
  input: SendInput;
  code: SendCode;
  sentAt: number;
}

function codeErrorText(err: unknown): string {
  if (!isApiError(err)) return err instanceof Error ? err.message : 'Something went wrong.';
  switch (err.code) {
    case 'SEND_CODE_INVALID': {
      const left = (err.details as { attemptsLeft?: unknown } | undefined)?.attemptsLeft;
      return typeof left === 'number' ? `Wrong code — ${String(left)} ${left === 1 ? 'try' : 'tries'} left` : err.message;
    }
    case 'SEND_CODE_EXPIRED':
      return "This code has expired. We'll send a new one.";
    case 'EMAIL_REQUIRED':
      return 'Add an email to your account to send money out.';
    case 'PROVIDER_UNAVAILABLE':
      return "We couldn't send the email. Try again in a minute.";
    default:
      return err.message;
  }
}

function AddEmail() {
  return (
    <div role="alert" className="space-y-2 rounded-lg bg-bg-2 p-3 text-sm">
      <p className="text-text-0">Add an email to your account to send money out.</p>
      <button
        type="button"
        onClick={() => {
          linkEmail();
        }}
        className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi"
      >
        Add an email
      </button>
    </div>
  );
}

/**
 * Send (Handover "Send", options from `GET /wallet/options` → `send[]`): pick a network, paste an
 * address, enter an amount → `POST /wallet/send/quote` shows what arrives, the bridge fee and the
 * time → Continue emails a 6-digit code (`POST /wallet/send/code`) → the code screen → one Tempo
 * transaction signed with Privy, fee paid by SmartRouter (`/relay`).
 */
export function SendPanel({ wallet, onBack, onDone }: { wallet: Wallet; onBack: () => void; onDone: () => void }) {
  const options = useWalletOptions();
  const list = useMemo(() => (options.data?.send.length ? options.data.send : [{ chain: 'tempo', chainName: wallet.network?.name ?? 'Tempo', token: wallet.token.symbol, method: 'direct', vmType: 'evm', depositAvailable: true }]), [options.data, wallet]);
  const [picked, setPicked] = useState<string>('tempo:' + wallet.token.symbol);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ input: SendInput; data: SendQuote } | null>(null);
  const quoteMut = useSendQuote();
  const codeMut = useSendCode();
  const send = useSend();
  const [pending, setPending] = useState<Pending | null>(null);
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<unknown>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const sendCode = wallet.features.sendCode;
  const noEmail = sendCode !== null && sendCode.required && sendCode.sentTo === null;

  // Resend countdown.
  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [step]);

  const option = list.find((o) => keyOf(o) === picked) ?? list[0];
  const amountUsd = Number(amount);
  const input: SendInput | null = option && to.trim() && amountUsd > 0 ? { chain: option.chain, token: option.chain === 'tempo' ? 'USDC' : option.token, to: to.trim(), amountUsd } : null;
  const quoteFresh = quote && input && JSON.stringify(quote.input) === JSON.stringify(input);
  const tooMuch = amountUsd * 1_000_000 > wallet.main.balanceUsd;

  // A changed amount, token or recipient needs a new code: drop the old error with it.
  const inputKey = input ? JSON.stringify(input) : '';
  useEffect(() => {
    setCodeError((e: unknown) => (isApiError(e) && e.code === 'EMAIL_REQUIRED' ? e : null));
  }, [inputKey]);

  /** Email a (new) code for `target`; a new code cancels the previous one. */
  const requestCode = (target: SendInput) => {
    setCodeError(null);
    codeMut.mutate(target, {
      onSuccess: (data) => {
        setPending({ input: target, code: data, sentAt: Date.now() });
        setNow(Date.now());
        setCode('');
        setFocusKey((k) => k + 1);
        setStep('code');
      },
      onError: (err) => {
        setCodeError(err);
      },
    });
  };

  const submitCode = (digits: string) => {
    if (!pending || send.isPending) return;
    setCodeError(null);
    send.mutate(
      { ...pending.input, verificationId: pending.code.verificationId, code: digits },
      {
        onSuccess: () => {
          setPending(null);
          onDone();
        },
        onError: (err) => {
          if (isApiError(err) && err.code === 'SEND_CODE_INVALID') {
            setCodeError(err);
            setCode('');
            setFocusKey((k) => k + 1);
            return;
          }
          if (isApiError(err) && (err.code === 'SEND_CODE_EXPIRED' || err.code === 'EMAIL_REQUIRED')) {
            setCodeError(err);
            return;
          }
          // Anything after the code was accepted (e.g. the signature was rejected) used it up:
          // the next attempt starts again from Continue with a new code.
          setPending(null);
          setStep('form');
        },
      },
    );
  };

  if (step === 'code' && pending) {
    const wait = Math.max(0, RESEND_SECONDS - Math.floor((now - pending.sentAt) / 1000));
    const expired = isApiError(codeError) && codeError.code === 'SEND_CODE_EXPIRED';
    const needsEmail = isApiError(codeError) && codeError.code === 'EMAIL_REQUIRED';
    return (
      <div className="space-y-5 pb-4">
        <button
          type="button"
          onClick={() => {
            setStep('form');
            setCodeError(null);
          }}
          className="inline-flex items-center gap-1 text-sm text-text-1 hocus:text-text-0"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <h3 className="font-display text-lg text-text-0">Check your email</h3>
        <p className="text-sm text-text-1">
          Sending <span className="num text-text-0">${pending.input.amountUsd.toFixed(2)}</span> to <span className="num text-text-0">{short(pending.input.to)}</span>
        </p>
        <p className="text-sm text-text-1">Enter the 6-digit code we sent to {pending.code.sentTo ?? 'your email'}.</p>
        <CodeInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (v.length < 6 && isApiError(codeError) && codeError.code === 'SEND_CODE_INVALID') setCodeError(null);
          }}
          onComplete={submitCode}
          disabled={send.isPending || expired || needsEmail}
          focusKey={focusKey}
        />
        {pending.code.devCode && <p className="num text-xs text-text-2">Test code: {pending.code.devCode}</p>}
        {send.isPending && <p className="text-sm text-text-1">Confirm in your wallet… sending</p>}
        {needsEmail ? (
          <AddEmail />
        ) : codeError ? (
          <div role="alert" className="space-y-2 text-sm text-signal">
            <p>{codeErrorText(codeError)}</p>
            {expired && (
              <button
                type="button"
                disabled={codeMut.isPending}
                onClick={() => {
                  requestCode(pending.input);
                }}
                className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
              >
                {codeMut.isPending ? 'Sending…' : 'Send new code'}
              </button>
            )}
          </div>
        ) : null}
        {!expired && (
          <button
            type="button"
            disabled={wait > 0 || codeMut.isPending || send.isPending}
            onClick={() => {
              requestCode(pending.input);
            }}
            className="text-sm text-accent-2 hocus:underline disabled:text-text-2 disabled:no-underline"
          >
            {codeMut.isPending ? 'Sending a new code…' : wait > 0 ? `Resend code in ${String(wait)} s` : 'Resend code'}
          </button>
        )}
        <p className="text-xs text-text-2">The code works once, for this amount and recipient only, and lasts {String(sendCode?.ttlMinutes ?? 10)} minutes.</p>
      </div>
    );
  }

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
          // Same send and its code is still usable: back to the code screen without a new email.
          const live = pending && same(pending.input, input) && (!pending.code.expiresAt || Date.parse(pending.code.expiresAt) > Date.now());
          if (live) {
            setStep('code');
            return;
          }
          requestCode(input);
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
        {noEmail || (isApiError(codeError) && codeError.code === 'EMAIL_REQUIRED') ? (
          <AddEmail />
        ) : codeError ? (
          <p role="alert" className="text-sm text-signal">
            {codeErrorText(codeError)}
          </p>
        ) : quoteFresh && sendCode?.sentTo ? (
          <p className="text-xs text-text-2">We&apos;ll email a code to {sendCode.sentTo} to confirm.</p>
        ) : null}
        <button
          type="submit"
          disabled={!input || tooMuch || noEmail || quoteMut.isPending || codeMut.isPending}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi disabled:opacity-60"
        >
          {codeMut.isPending ? 'Emailing your code…' : quoteMut.isPending ? 'Getting a quote…' : quoteFresh ? 'Continue' : 'Review'}
        </button>
        <p className="text-xs text-text-2">An emailed code, then one signature. SmartRouter pays the Tempo network fee; you only pay the bridge fee for other chains, shown above.</p>
      </form>
    </div>
  );
}
