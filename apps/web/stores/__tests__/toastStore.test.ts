import { toast, useToastStore } from '../toastStore';

beforeEach(() => {
  useToastStore.getState().clear();
});

describe('toastStore', () => {
  it('queues toasts with tone defaults and caps the visible count', () => {
    const id = toast.success('Deposit received', '$2.00 USDC');
    expect(useToastStore.getState().items[0]).toMatchObject({
      id,
      tone: 'success',
      title: 'Deposit received',
      description: '$2.00 USDC',
      duration: 4000,
    });
    for (let i = 0; i < 6; i += 1) toast.info(`n${String(i)}`);
    expect(useToastStore.getState().items).toHaveLength(4);
  });

  it('errors stay longer and can be dismissed', () => {
    const id = toast.error('Allocation used — Top up $2');
    expect(useToastStore.getState().items[0]?.duration).toBe(6000);
    toast.dismiss(id);
    expect(useToastStore.getState().items).toHaveLength(0);
  });
});
