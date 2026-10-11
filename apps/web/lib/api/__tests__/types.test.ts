import { sessionsCurrentSchema, settingsSchema, userSchema } from '@/lib/api/types';

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

  it('PATCH /me/settings returns the settings object only', () => {
    const s = settingsSchema.parse({ slider: 'balanced', dailyLimitUsd: 0.5, weeklyLimitUsd: 0, autoFreeFallback: true, country: 'NG', spendingKeyLimitUsd: 1.5 });
    expect(s.dailyLimitUsd).toBe(500_000);
    expect(s.spendingKeyLimitUsd).toBe(1.5);
    expect(s.weeklyLimitUsd).toBe(0);
  });

  it('GET /sessions/current: paidRunsEnabled, network object, usage, session', () => {
    const c = sessionsCurrentSchema.parse({
      paidRunsEnabled: false,
      network: { chainId: 4217, token: '0x20c0', recipient: '0x1', operator: '0x2' },
      suggestedDepositUsd: 2,
      usage: { weekly: { spentUsd: 0, limitUsd: 10, usedPct: 0 }, deposit: null, alert: null },
      session: null,
    });
    expect(c.paidRunsEnabled).toBe(false);
    expect(c.network?.chainId).toBe(4217);
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
});
