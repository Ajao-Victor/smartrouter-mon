'use client';

export interface PaidBlockBarProps {
  /** `daily` / `weekly` = a spending cap is reached; `balance` = the wallet can't fund the answer. */
  meter: 'daily' | 'weekly' | 'balance';
  message: string;
  /** Server-side `details.freeFallback.available` — never decided on the client. */
  freeAvailable: boolean;
  freeRemaining?: number | null;
  onRaiseCap: () => void;
  onAddFunds: () => void;
  onContinueFree: () => void;
}

/**
 * Shown when a paid answer can't go out (Handover "Usage banners" / "Errors"): the message is kept.
 * A cap reached → "Raise cap" (settings); an empty wallet → "Add funds" (Deposit panel) — never
 * "Allocation used". The free model is offered either way.
 */
export function PaidBlockBar({ meter, message, freeAvailable, freeRemaining = null, onRaiseCap, onAddFunds, onContinueFree }: PaidBlockBarProps) {
  const funds = meter === 'balance';
  const title = message || (funds ? 'Your wallet is empty' : meter === 'weekly' ? "You've reached this week's spending cap" : "You've reached today's spending cap");
  return (
    <section role="alert" aria-label={funds ? 'Add funds' : 'Spending cap reached'} className="space-y-3 rounded-xl bg-bg-1 p-4 shadow-hairline-strong">
      <div>
        <h3 className="text-base font-medium text-text-0">{title}</h3>
        <p className="mt-0.5 text-sm text-text-2">
          {funds ? 'Your message is kept. Add funds to your wallet, or continue on the free model.' : 'Your message is kept. Raise your cap, or continue on the free model.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={funds ? onAddFunds : onRaiseCap}
          className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-text-inverse transition-colors hocus:bg-accent-hi"
        >
          {funds ? 'Add funds' : 'Raise cap'}
        </button>
        <button
          type="button"
          onClick={onContinueFree}
          disabled={!freeAvailable}
          className="inline-flex h-10 items-center rounded-lg bg-free/15 px-4 text-sm font-medium text-free transition-colors hocus:bg-free/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue free
        </button>
      </div>
      {!freeAvailable ? (
        <p className="text-xs text-text-2">Free messages for today are used up. They reset at 00:00 UTC.</p>
      ) : freeRemaining !== null ? (
        <p className="text-xs text-text-2">{String(freeRemaining)} free messages left today.</p>
      ) : null}
    </section>
  );
}
