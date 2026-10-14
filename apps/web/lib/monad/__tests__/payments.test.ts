import { privateKeyToAccount } from 'viem/accounts';

import { micro } from '@/lib/money';

import { getContracts } from '../contracts';
import { encodeVoucher, paidFetch } from '../payments';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const key = privateKeyToAccount(PK);
const USER = '0x00000000000000000000000000000000000000a1';

const loadSpendingKey = vi.fn<() => Promise<typeof key | null>>();
vi.mock('../spendingKey', async () => {
  const { toSignable } = await import('../typedData');
  return {
    signWithSpendingKey: async (_address: string, typed: import('@/lib/api/types').TypedData) => {
      const k = await loadSpendingKey();
      return k ? k.signTypedData({ domain: typed.domain as never, types: typed.types, primaryType: typed.primaryType, message: toSignable(typed) } as never) : null;
    },
  };
});

const apiRequest = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), apiRequest: (p: string, i?: RequestInit) => apiRequest(p, i) }));
vi.mock('@/lib/env', async (orig) => {
  const real = await orig<typeof import('@/lib/env')>();
  return { ...real, env: { ...real.env, mock: false } };
});

const challenge = (over: { user?: string; chainId?: number; priceUsd?: number } = {}) =>
  new Response(
    JSON.stringify({
      code: 'PAYMENT_REQUIRED',
      message: 'Sign the voucher',
      details: {
        priceUsd: over.priceUsd ?? 0.012,
        voucher: {
          domain: { name: 'SmartRouterVault', version: '1', chainId: over.chainId ?? 143, verifyingContract: getContracts().vault },
          types: { Voucher: [{ name: 'user', type: 'address' }, { name: 'cumulativeAmount', type: 'uint256' }] },
          primaryType: 'Voucher',
          message: { user: over.user ?? USER, cumulativeAmount: '12000' },
          header: 'x-smartrouter-voucher',
        },
      },
    }),
    { status: 402, headers: { 'content-type': 'application/json' } },
  );
const init = { method: 'POST', body: JSON.stringify({ quoteId: 'q', prompt: 'p' }) };

beforeEach(() => {
  apiRequest.mockReset();
  loadSpendingKey.mockResolvedValue(key);
});

describe('paid /run: the Monad voucher challenge', () => {
  it('signs the challenge with the spending key and retries once with X-SmartRouter-Voucher', async () => {
    apiRequest.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(new Response('event: done\ndata: {}\n\n', { status: 200 }));
    const res = await paidFetch('/run', init, USER, micro(12_000));
    expect(res.status).toBe(200);
    expect(apiRequest).toHaveBeenCalledTimes(2);
    const header = new Headers(apiRequest.mock.calls[1]?.[1]?.headers).get('X-SmartRouter-Voucher');
    const decoded = JSON.parse(atob(header ?? '')) as { cumulativeAmount: string; signature: string };
    expect(decoded.cumulativeAmount).toBe('12000');
    expect(decoded.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(apiRequest.mock.calls[1]?.[1]?.body).toBe(init.body);
  });

  it('hands other errors (409 SETUP_REQUIRED, 402 ALLOCATION_EXHAUSTED) back untouched', async () => {
    const setup = new Response(JSON.stringify({ code: 'SETUP_REQUIRED', message: 'Set up' }), { status: 409 });
    apiRequest.mockResolvedValueOnce(setup);
    expect((await paidFetch('/run', init, USER)).status).toBe(409);
    const exhausted = new Response(JSON.stringify({ code: 'ALLOCATION_EXHAUSTED', message: 'low' }), { status: 402 });
    apiRequest.mockResolvedValueOnce(exhausted);
    expect((await paidFetch('/run', init, USER)).status).toBe(402);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('refuses to sign a voucher for another user, another chain or a higher price', async () => {
    apiRequest.mockResolvedValueOnce(challenge({ user: '0x00000000000000000000000000000000000000b2' }));
    await expect(paidFetch('/run', init, USER)).rejects.toMatchObject({ code: 'PAYMENT_FAILED' });
    apiRequest.mockResolvedValueOnce(challenge({ chainId: 1 }));
    await expect(paidFetch('/run', init, USER)).rejects.toMatchObject({ code: 'PAYMENT_FAILED' });
    apiRequest.mockResolvedValueOnce(challenge({ priceUsd: 0.5 }));
    await expect(paidFetch('/run', init, USER, micro(12_000))).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it('asks for setup when this browser has no spending key', async () => {
    loadSpendingKey.mockResolvedValue(null);
    apiRequest.mockResolvedValueOnce(challenge());
    await expect(paidFetch('/run', init, USER)).rejects.toMatchObject({ code: 'SPENDING_KEY_MISSING' });
  });

  it('encodes the header as base64 JSON { cumulativeAmount, signature }', () => {
    expect(JSON.parse(atob(encodeVoucher('5', '0xab')))).toEqual({ cumulativeAmount: '5', signature: '0xab' });
  });
});
