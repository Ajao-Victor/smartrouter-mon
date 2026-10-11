import { fireEvent, render, screen } from '@testing-library/react';

import { usageSchema } from '@/lib/api/types';

import { useUsageStore } from '@/stores/usageStore';

import { PaidBlockBar } from '../PaidBlockBar';
import { UsageBanner } from '../UsageBanner';

const usageAt = (level: 'warning' | 'critical' | 'exhausted', meter: 'daily' | 'weekly' | 'balance', usedPct: number, message: string) =>
  usageSchema.parse({
    daily: { spentUsd: 1.6, limitUsd: 2, usedPct: 80, remainingUsd: 0.4, resetsAt: '2026-10-12T00:00:00.000Z' },
    weekly: { spentUsd: 4.1, limitUsd: 10, usedPct: 41, remainingUsd: 5.9 },
    deposit: null,
    nextDepositUsd: 0.4,
    alert: { level, meter, usedPct, message, action: meter === 'balance' ? 'add_funds' : 'raise_limit' },
  });

describe('UsageBanner (Handover "Usage banners")', () => {
  beforeEach(() => {
    useUsageStore.getState().reset();
  });

  it('renders nothing below 75% (alert: null)', () => {
    useUsageStore.getState().setUsage(usageSchema.parse({ alert: null }));
    const { container } = render(<UsageBanner onRaiseCap={vi.fn()} onAddFunds={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('warning: "{message} · Resets at … · Raise cap", dismissible', () => {
    useUsageStore.getState().setUsage(usageAt('warning', 'daily', 80, "You've used 80% of today's spending cap"));
    const onRaise = vi.fn();
    render(<UsageBanner onRaiseCap={onRaise} onAddFunds={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent("You've used 80% of today's spending cap · Resets at");
    fireEvent.click(screen.getByRole('button', { name: 'Raise cap' }));
    expect(onRaise).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('critical is not dismissible', () => {
    useUsageStore.getState().setUsage(usageAt('critical', 'weekly', 92, "You've used 92% of this week's spending cap"));
    render(<UsageBanner onRaiseCap={vi.fn()} onAddFunds={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('an empty wallet says "Add funds" (never "Allocation used") and offers the free model', () => {
    useUsageStore.getState().setUsage(usageAt('exhausted', 'balance', 100, 'Your wallet is empty'));
    const onFunds = vi.fn();
    const onFree = vi.fn();
    render(<UsageBanner onRaiseCap={vi.fn()} onAddFunds={onFunds} onUseFree={onFree} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Your wallet is empty');
    fireEvent.click(screen.getByRole('button', { name: 'Add funds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use the free model' }));
    expect(onFunds).toHaveBeenCalled();
    expect(onFree).toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('Allocation used');
  });

  it('an unknown meter or action from a newer backend never breaks parsing', () => {
    const u = usageSchema.parse({ alert: { level: 'warning', meter: 'monthly', usedPct: 76, message: 'x', action: 'something_new' } });
    expect(u.alert?.meter).toBe('monthly');
  });
});

describe('PaidBlockBar', () => {
  it('cap reached: Raise cap + Continue free', () => {
    const onRaise = vi.fn();
    const onFree = vi.fn();
    render(<PaidBlockBar meter="daily" message="You've reached today's spending cap" freeAvailable onRaiseCap={onRaise} onAddFunds={vi.fn()} onContinueFree={onFree} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise cap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue free' }));
    expect(onRaise).toHaveBeenCalled();
    expect(onFree).toHaveBeenCalled();
  });

  it('empty wallet: Add funds; free is disabled only when the server says so', () => {
    render(<PaidBlockBar meter="balance" message="" freeAvailable={false} onRaiseCap={vi.fn()} onAddFunds={vi.fn()} onContinueFree={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add funds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue free' })).toBeDisabled();
  });
});
