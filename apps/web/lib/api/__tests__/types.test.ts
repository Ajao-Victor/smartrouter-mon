import { sendPlanSchema, sessionsCurrentSchema, settingsSchema, setupRequestSchema, userSchema, voucherChallengeSchema, walletSchema } from '@/lib/api/types';

describe('live contract shapes (Handover "API reference")', () => {
  it('GET /me: settings are nested and flattened onto the user; usage and email come through', () => {
    const me = userSchema.parse({
      id: 'u1',
      address: '0xabc',
      email: 'a@b.co',
      loginMethod: 'google',
      country: null,
      usage: { weekly: { spentUsd: 9.2, limitUsd: 10, usedPct: 92 }, deposit: null, alert: { level: 'critical', meter: 'weekly', usedPct: 92, message: "You've used 92% of your weekly limit", action: 'raise_limit' } },
      settings: { slider: 'cheapest', dailyLimitUsd: 5, weeklyLimitUsd: 10, autoFreeFallback: false },
    });
    expect(me.slider).toBe('cheapest');
    expect(me.dailyLimitUsd).toBe(5_000_000);
    expect(me.autoFreeFallback).toBe(false);
    expect(me.email).toBe('a@b.co');
    expect(me.usage?.alert?.level).toBe('critical');
    expect(me.usage?.weekly?.spentUsd).toBe(9_200_000);
  });

  it('PATCH /me/settings returns the settings object (+ vaultSetupNeeded after a cap change)', () => {
    const s = settingsSchema.parse({ slider: 'balanced', dailyLimitUsd: 0.5, weeklyLimitUsd: 0, autoFreeFallback: true, country: 'NG', vaultSetupNeeded: true });
    expect(s.dailyLimitUsd).toBe(500_000);
    expect(s.vaultSetupNeeded).toBe(true);
    expect(s.weeklyLimitUsd).toBe(0);
  });

  it('GET /sessions/current: paidRunsEnabled, Monad network (vault, ledger, explorer), usage, session', () => {
    const c = sessionsCurrentSchema.parse({
      paidRunsEnabled: false,
      network: { chainId: 143, name: 'Monad', token: '0x754704bc059f8c67012fed69bc8a327a5aafb603', vault: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c', ledger: '0xdc28d25a044da278ae82cbf91cdf1c5997aa2163', operator: '0x2', explorer: 'https://monadscan.com' },
      suggestedDepositUsd: 2,
      usage: { weekly: { spentUsd: 0, limitUsd: 10, usedPct: 0 }, deposit: null, alert: null },
      session: null,
    });
    expect(c.paidRunsEnabled).toBe(false);
    expect(c.network?.chainId).toBe(143);
    expect(c.network?.vault).toBe('0x88191be828c5ce6bda1c7796fb32450a10c3e54c');
    expect(c.network?.explorer).toBe('https://monadscan.com');
    expect(c.usage?.alert).toBeNull();
  });

  it('GET /me for an empty wallet (alert meter "balance", action "add_funds") parses — this once looped the app on a skeleton', () => {
    const me = userSchema.parse({
      id: 'u', address: '0xabc', email: null, loginMethod: 'email', country: null,
      usage: { daily: { spentUsd: 0, limitUsd: 2, usedPct: 0, remainingUsd: 2, resetsAt: '2026-10-12T00:00:00.000Z' }, weekly: { spentUsd: 0, limitUsd: 10, usedPct: 0, remainingUsd: 10 }, deposit: null, nextDepositUsd: 1, alert: { level: 'exhausted', meter: 'balance', usedPct: 100, action: 'add_funds', message: 'Your wallet is empty' } },
      settings: { slider: 'balanced', dailyLimitUsd: 2, weeklyLimitUsd: 10, autoFreeFallback: true },
      allocation: null,
    });
    expect(me.usage?.alert?.action).toBe('add_funds');
    expect(me.usage?.daily?.resetsAt).toBe('2026-10-12T00:00:00.000Z');
  });

  it('GET /wallet on Monad: AI balance, vault, on-chain caps and features.card as an object', () => {
    const w = walletSchema.parse({
      address: '0x00000000000000000000000000000000000000a1',
      network: { chainId: 143, name: 'Monad', explorer: 'https://monadscan.com' },
      token: { address: '0x754704bc059f8c67012fed69bc8a327a5aafb603', symbol: 'USDC', decimals: 6 },
      main: { balanceUsd: 3.5 },
      ai: { channelId: '0xcd', depositUsd: 2, spentUsd: 0.1, remainingUsd: 1.9 },
      locked: { channelId: '0xcd', depositUsd: 2, spentUsd: 0.1, remainingUsd: 1.9 },
      vault: { address: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c', ledger: '0xdc28d25a044da278ae82cbf91cdf1c5997aa2163' },
      caps: null,
      spendingKey: { status: 'active', address: '0x00000000000000000000000000000000000000b2', expiresAt: '2026-10-21T00:00:00.000Z', onChainCaps: { dailyUsd: 2, weeklyUsd: 10 } },
      networkFees: { paidBy: 'smartrouter', sponsoredPerDay: 20, usedToday: 1 },
      features: { crossChain: false, card: { via: 'privy', chain: 'monad', token: 'USDC' }, cashOut: false, sendCode: { required: false, sentTo: null, ttlMinutes: 10 } },
    });
    expect(w.ai?.remainingUsd).toBe(1_900_000);
    expect(w.vault?.address).toBe('0x88191be828c5ce6bda1c7796fb32450a10c3e54c');
    expect(w.spendingKey?.onChainCaps?.dailyUsd).toBe(2_000_000);
    expect(w.features.card).toBe(true);
    expect(w.network?.explorer).toBe('https://monadscan.com');
  });

  it('GET /me reports the Monad network and the vault setup', () => {
    const me = userSchema.parse({ id: 'u', address: '0xabc', network: { chainId: 143, name: 'Monad' }, spendingKey: { setupDone: true, address: '0xkey', expiresAt: null }, settings: {} });
    expect(me.network?.chainId).toBe(143);
    expect(me.spendingKey?.setupDone).toBe(true);
  });

  it('parses the Setup, Voucher and TransferWithAuthorization typed data the API hands over', () => {
    const vault = { name: 'SmartRouterVault', version: '1', chainId: 143, verifyingContract: '0x88191be828c5ce6bda1c7796fb32450a10c3e54c' };
    const setup = setupRequestSchema.parse({
      domain: vault,
      types: { Setup: [{ name: 'user', type: 'address' }] },
      primaryType: 'Setup',
      message: { user: '0xa1', signer: null, signerExpiry: '1760000000', dailyCap: '2000000', weeklyCap: '10000000', nonce: '0', deadline: '1760000900' },
      submit: 'POST /wallet/setup { ...message, signature }',
    });
    expect(setup.message.dailyCap).toBe('2000000');
    const voucher = voucherChallengeSchema.parse({ domain: vault, types: { Voucher: [] }, primaryType: 'Voucher', message: { user: '0xa1', cumulativeAmount: 12000 }, header: 'x-smartrouter-voucher' });
    expect(voucher.message.cumulativeAmount).toBe('12000');
    const plan = sendPlanSchema.parse({ sendId: 's1', chainId: 143, typedData: { domain: { ...vault, name: 'USDC', version: '2' }, types: {}, primaryType: 'TransferWithAuthorization', message: { from: '0xa1', to: '0xb2', value: '1000000' } } });
    expect(plan.typedData.message.value).toBe('1000000');
  });
});
