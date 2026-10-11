import { usageSchema } from '@/lib/api/types';

import { selectPaidBlocked, selectVisibleAlert, useUsageStore } from '@/stores/usageStore';

const alert = (level: 'warning' | 'critical' | 'exhausted', usedPct: number) => usageSchema.parse({ alert: { level, meter: 'daily', usedPct, message: 'm', action: 'raise_limit' } });

beforeEach(() => {
  useUsageStore.getState().reset();
});

describe('usageStore', () => {
  it('a dismissed warning stays hidden until the level changes', () => {
    useUsageStore.getState().setUsage(alert('warning', 76));
    useUsageStore.getState().dismiss();
    expect(selectVisibleAlert(useUsageStore.getState())).toBeNull();
    useUsageStore.getState().setUsage(alert('critical', 91));
    expect(selectVisibleAlert(useUsageStore.getState())?.level).toBe('critical');
  });

  it('critical cannot be dismissed; exhausted blocks paid Send', () => {
    useUsageStore.getState().setUsage(alert('critical', 92));
    useUsageStore.getState().dismiss();
    expect(selectVisibleAlert(useUsageStore.getState())).not.toBeNull();
    expect(selectPaidBlocked(useUsageStore.getState())).toBe(false);
    useUsageStore.getState().setUsage(alert('exhausted', 100));
    expect(selectPaidBlocked(useUsageStore.getState())).toBe(true);
  });
});
