import { useAllocationStore } from '@/stores/allocationStore';
import { useAuthStore } from '@/stores/authStore';
import { useComposerStore } from '@/stores/composerStore';
import { useDepositStore } from '@/stores/depositStore';
import { useStreamStore } from '@/stores/streamStore';
import { useUiStore } from '@/stores/uiStore';
import { useUsageStore } from '@/stores/usageStore';

export { useAllocationStore } from '@/stores/allocationStore';
export { useComposerStore } from '@/stores/composerStore';
export { useDepositStore } from '@/stores/depositStore';
export { useStreamStore } from '@/stores/streamStore';
export { useUiStore } from '@/stores/uiStore';
export { useAuthStore } from '@/stores/authStore';
export { useUsageStore } from '@/stores/usageStore';

/** Logout: clear every client store (rules.md §4.7). Persisted preferences survive. */
export function resetAllStores(): void {
  useStreamStore.getState().clearAll();
  useComposerStore.getState().reset();
  useAllocationStore.getState().reset();
  useDepositStore.getState().reset();
  useAuthStore.getState().reset();
  useUsageStore.getState().reset();
  useUiStore.getState().reset();
}
