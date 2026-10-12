/**
 * Spending-key setup saves the key in this browser only once Tempo accepted it; a failed attempt
 * leaves nothing behind (and drops any older saved key).
 */
const store = new Map<string, unknown>();
vi.mock('@/lib/idb', () => ({
  idb: {
    get: (k: string) => Promise.resolve(store.get(k)),
    set: (k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    },
    del: (k: string) => {
      store.delete(k);
      return Promise.resolve();
    },
  },
}));
vi.mock('@/lib/env', async (orig) => {
  const real = await orig<typeof import('@/lib/env')>();
  return { ...real, env: { ...real.env, mock: false } };
});
vi.mock('../relay', () => ({ rootRelayClient: () => Promise.resolve({}) }));
const authorizeSync = vi.fn();
vi.mock('viem/tempo', async (orig) => {
  const real = await orig<typeof import('viem/tempo')>();
  return { ...real, Actions: { ...real.Actions, accessKey: { ...real.Actions.accessKey, authorizeSync: (...a: unknown[]) => authorizeSync(...a) as Promise<unknown> } } };
});

import { authorizeSpendingKey, localKeyAddress } from '../spendingKey';

const ADDRESS = '0x5b9da9fa5d210691948de6f9cf6bf97fa4e8cf5b';
const setup = { token: '0x20c0000000000000000000000000000000000000', limitUsd: 3, periodSeconds: 86400, expiryDays: 7, scopes: [{ address: '0x4d50500000000000000000000000000000000000' }] };

beforeEach(() => {
  store.clear();
  authorizeSync.mockReset();
});

describe('authorizeSpendingKey', () => {
  it('saves the key only after Tempo accepted it, and returns its address', async () => {
    authorizeSync.mockImplementation(() => {
      // Nothing saved while the transaction is in flight.
      expect(store.size).toBe(0);
      return Promise.resolve({ receipt: { status: 'success' } });
    });
    const address = await authorizeSpendingKey({ address: ADDRESS, setup, chainId: 42431 });
    expect(await localKeyAddress(ADDRESS)).toBe(address);
  });

  it('a failed setup leaves no key saved, and drops an older stale one', async () => {
    authorizeSync.mockResolvedValueOnce({ receipt: { status: 'success' } });
    await authorizeSpendingKey({ address: ADDRESS, setup, chainId: 42431 });
    expect(store.size).toBe(1);
    authorizeSync.mockRejectedValueOnce(new Error('insufficient funds for gas * price + value: have 0'));
    await expect(authorizeSpendingKey({ address: ADDRESS, setup, chainId: 42431 })).rejects.toThrow('have 0');
    expect(store.size).toBe(0);
    expect(await localKeyAddress(ADDRESS)).toBeNull();
  });

  it('every attempt uses a fresh key', async () => {
    authorizeSync.mockResolvedValue({ receipt: { status: 'success' } });
    const a = await authorizeSpendingKey({ address: ADDRESS, setup, chainId: 42431 });
    const b = await authorizeSpendingKey({ address: ADDRESS, setup, chainId: 42431 });
    expect(a).not.toBe(b);
  });
});
