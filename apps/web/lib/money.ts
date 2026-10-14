/**
 * Money helpers.
 *
 * The live API speaks **USD decimals** (`priceUsd`, `depositUsd`, `chargedUsd` …). The app
 * converts those at the API boundary into **integer micro-USD** (1 USD = 1_000_000 micro) so all
 * arithmetic stays in integers; floats appear only at the formatting and serialisation boundary.
 * Prices are rounded **up** to $0.0001 (PDF pricing rule).
 */

/** Branded integer micro-USD. Create with `micro()` or `fromUsd()`. */
export type MicroUsd = number & { readonly __brand: 'MicroUsd' };

export const MICRO_PER_USD = 1_000_000;

/** $0.0001 expressed in micro-USD — the PDF's price rounding step. */
export const PRICE_STEP_MICRO = 100;

/** PDF: SmartRouter's fee, e.g. 10%. Display hint only; the API's quote is authoritative. */
export const DEFAULT_FEE_BPS = 1000;

/** Brand a raw integer as micro-USD. Throws on non-integers or non-finite values. */
export function micro(n: number): MicroUsd {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new TypeError(`micro(): expected an integer, got ${String(n)}`);
  }
  return n as MicroUsd;
}

/** Convert a USD float (e.g. user input "2") to micro-USD, rounding to the nearest micro. */
export function fromUsd(usd: number): MicroUsd {
  if (!Number.isFinite(usd)) throw new TypeError('fromUsd(): expected a finite number');
  return micro(Math.round(usd * MICRO_PER_USD));
}

/** Convert micro-USD to a USD float. Use only for display or charts, never for logic. */
export function toUsd(m: MicroUsd): number {
  return m / MICRO_PER_USD;
}

/**
 * Serialise micro-USD for the API as a plain decimal string without float noise
 * (`2_000_000` → "2", `900` → "0.0009").
 */
export function toUsdString(m: MicroUsd): string {
  const negative = m < 0;
  const abs = Math.abs(m);
  const whole = Math.floor(abs / MICRO_PER_USD);
  const frac = String(abs % MICRO_PER_USD).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${String(whole)}${frac ? `.${frac}` : ''}`;
}

/** Parse a USD value the API sent (number or decimal string) into micro-USD. */
export function parseUsd(value: number | string): MicroUsd {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) throw new TypeError(`parseUsd(): expected a finite USD amount, got ${String(value)}`);
  return fromUsd(n);
}

/** Round up to the next $0.0001 (PDF: "rounded up to $0.0001"). */
export function roundUpToTenThousandth(m: MicroUsd): MicroUsd {
  return micro(Math.ceil(m / PRICE_STEP_MICRO) * PRICE_STEP_MICRO);
}

/**
 * Apply SmartRouter's fee to a provider cost and round up to $0.0001.
 * Mirrors the PDF rule: user price = provider 402 charge + fee (10%), rounded up.
 */
export function applyFee(providerCost: MicroUsd, feeBps = DEFAULT_FEE_BPS): MicroUsd {
  const withFee = Math.ceil((providerCost * (10_000 + feeBps)) / 10_000);
  return roundUpToTenThousandth(micro(withFee));
}

export interface FormatUsdOptions {
  /** Minimum fraction digits (default 2 → "$2.00"). */
  min?: number;
  /** Maximum fraction digits (default 4 → "$0.0008"). */
  max?: number;
  /** Prefix (default "$"). */
  symbol?: string;
}

/**
 * Format micro-USD for display: "$0.0008", "$0.026", "$2.00".
 * Shows up to `max` decimals, trimming trailing zeros down to `min`.
 */
export function formatUsd(m: MicroUsd, options: FormatUsdOptions = {}): string {
  const min = options.min ?? 2;
  const max = options.max ?? 4;
  const symbol = options.symbol ?? '$';
  if (max < min) throw new RangeError('formatUsd(): max must be >= min');

  const negative = m < 0;
  const abs = Math.abs(m);
  const whole = Math.floor(abs / MICRO_PER_USD);
  const fracMicro = abs % MICRO_PER_USD;

  // Six-digit fraction, then cut to `max` with round-half-up on the dropped digits.
  const scale = 10 ** (6 - max);
  let fracScaled = Math.round(fracMicro / scale);
  let wholeAdj = whole;
  if (fracScaled >= 10 ** max) {
    fracScaled = 0;
    wholeAdj += 1;
  }
  let frac = fracScaled.toString().padStart(max, '0');
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);

  const body = frac.length > 0 ? `${String(wholeAdj)}.${frac}` : String(wholeAdj);
  return `${negative ? '-' : ''}${symbol}${body}`;
}

/** Percentage of `part` over `whole`, rounded to an integer. Returns 0 when whole is 0. */
export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * "1/34"-style price ratio between a cheaper and a pricier option.
 * Floors the ratio so the claim is never overstated. Free options return "free".
 */
export function ratioLabel(cheap: MicroUsd, best: MicroUsd): string {
  if (cheap <= 0) return 'free';
  const n = Math.max(1, Math.floor(best / cheap));
  return `1/${String(n)}`;
}

/**
 * PDF pattern: "80% of the best quality at 1/34 of the price".
 * Prefer the API's own `reason` string when present; this is a fallback for mocks and demos.
 */
export function savingLine(qualityPct: number, ratio: string): string {
  return `${String(qualityPct)}% of the best quality at ${ratio} of the price`;
}

/** Sum a list of micro-USD amounts safely. */
export function sumMicro(values: readonly MicroUsd[]): MicroUsd {
  return micro(values.reduce<number>((acc, v) => acc + v, 0));
}

/** Clamp a micro-USD amount into [0, max]. */
export function clampMicro(value: MicroUsd, max: MicroUsd): MicroUsd {
  return micro(Math.min(Math.max(value, 0), max));
}
