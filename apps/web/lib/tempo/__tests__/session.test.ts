/**
 * Paid answers (Handover "Paying for runs → Paid answers"), with the network faked:
 * the manager is built on the spending key, sized to `suggestedDepositUsd`; 0 means a cap is
 * reached; when the locked amount runs out a NEW manager is created (the old one is not closed).
 */
const current = vi.fn();
vi.mock('@/lib/api/endpoints', () => ({ api: { sessions: { current: () => current() as Promise<unknown> } } }));
vi.mock('@/lib/env', async (orig) => {
  const real = await orig<typeof import('@/lib/env')>();
  return { ...real, env: { ...real.env, mock: false } };
});
const loadKeyPair = vi.fn();
vi.mock('../spendingKey', () => ({ loadKeyPair: (a: string) => loadKeyPair(a) as Promise<unknown>, keyAccount: () => ({ address: '0xabc', accessKeyAddress: '0xkey' }) }));
const managers: { maxDeposit: string; fetch: ReturnType<typeof vi.fn> }[] = [];
vi.mock('mppx/client', () => ({
  sessionManager: (p: { maxDeposit: string }) => {
    const m = { maxDeposit: p.maxDeposit, fetch: vi.fn() };
    managers.push(m);
    return m;
  },
}));

import { paidFetch, resetSession } from '../session';

const ok = () => new Response('event: done\ndata: {}\n\n', { status: 200 });

beforeEach(() => {
  managers.length = 0;
  current.mockReset();
  loadKeyPair.mockReset();
  resetSession();
});

describe('paid answers on the spending key', () => {
  it('no key in this browser → SPENDING_KEY_MISSING (run the one-time setup)', async () => {
    loadKeyPair.mockResolvedValue(null);
    await expect(paidFetch('/run', { method: 'POST' }, '0xabc')).rejects.toMatchObject({ code: 'SPENDING_KEY_MISSING' });
  });

  it('suggestedDepositUsd 0 → SPENDING_CAP_REACHED, nothing is paid', async () => {
    loadKeyPair.mockResolvedValue({});
    current.mockResolvedValue({ suggestedDepositUsd: 0, network: { chainId: 42431 }, usage: null });
    await expect(paidFetch('/run', { method: 'POST' }, '0xabc')).rejects.toMatchObject({ code: 'SPENDING_CAP_REACHED' });
    expect(managers).toHaveLength(0);
  });

  it('maxDeposit = suggestedDepositUsd; "exceeds local maxDeposit" → a new manager with the new amount, then retry', async () => {
    loadKeyPair.mockResolvedValue({});
    current.mockResolvedValueOnce({ suggestedDepositUsd: 1_000_000, network: { chainId: 42431 } }).mockResolvedValueOnce({ suggestedDepositUsd: 400_000, network: { chainId: 42431 } });
    const realPush = managers.push.bind(managers);
    managers.push = (...items) => {
      for (const m of items) {
        if (m.maxDeposit === '1') m.fetch.mockRejectedValueOnce(new Error('requested voucher amount 1000001 exceeds local maxDeposit 1000000'));
        else m.fetch.mockResolvedValueOnce(ok());
      }
      return realPush(...items);
    };
    const res = await paidFetch('/run', { method: 'POST' }, '0xabc');
    expect(res.status).toBe(200);
    expect(managers.map((m) => m.maxDeposit)).toEqual(['1', '0.4']);
  });
});
