'use client';

import { useCallback, useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { isApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/keys';
import { formatBytes, isAccepted, uploadFile } from '@/lib/uploads';

import { readyAttachmentIds, useAttachmentStore } from '@/stores/attachmentStore';
import { selectIsSignedIn, useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

const controllers = new Map<string, AbortController>();

const errorText = (err: unknown) => (isApiError(err) ? err.message : err instanceof Error ? err.message : 'Upload failed');

/**
 * The attach button's state: `GET /uploads/limits` (enabled, size, files per message), the files
 * on the draft, and add / remove. Each file uploads straight away so it's ready by Send.
 */
export function useAttachments() {
  const signedIn = useAuthStore(selectIsSignedIn);
  const items = useAttachmentStore((s) => s.items);
  const limits = useQuery({
    queryKey: queryKeys.uploadLimits(),
    queryFn: ({ signal }) => api.uploads.limits(signal),
    enabled: signedIn,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const add = useCallback(
    (files: File[]) => {
      const store = useAttachmentStore.getState();
      const lim = limits.data;
      const max = lim?.maxPerMessage ?? 5;
      const maxBytes = lim?.maxBytes ?? 20 * 1024 * 1024;
      let room = max - store.items.length;
      for (const file of files) {
        if (room <= 0) {
          toast.warn(`Attach up to ${String(max)} files per message`);
          break;
        }
        if (!isAccepted(file)) {
          toast.warn(`"${file.name}" isn't supported yet`, `Attach ${lim?.accepted ?? 'PDF, Word (.docx), text, Markdown, CSV, JSON or code files'}.`);
          continue;
        }
        if (file.size > maxBytes) {
          toast.warn(`"${file.name}" is too large`, `Files can be up to ${formatBytes(maxBytes)}.`);
          continue;
        }
        if (file.size === 0) {
          toast.warn(`"${file.name}" is empty`);
          continue;
        }
        room -= 1;
        const id = `att_${String(Date.now())}_${Math.random().toString(36).slice(2, 7)}`;
        const controller = new AbortController();
        controllers.set(id, controller);
        store.add({ id, name: file.name, sizeBytes: file.size, mime: file.type, status: 'uploading', progress: 0, uploadId: null, error: null, tokens: null, truncated: false });
        const patch = useAttachmentStore.getState().patch;
        void uploadFile(file, {
          signal: controller.signal,
          onUploadId: (uploadId) => {
            patch(id, { uploadId });
          },
          onProgress: (progress) => {
            patch(id, progress >= 1 ? { progress, status: 'processing' } : { progress });
          },
        })
          .then((u) => {
            patch(id, { status: 'ready', progress: 1, tokens: u.tokens, truncated: u.truncated, uploadId: u.uploadId });
          })
          .catch((err: unknown) => {
            if (controller.signal.aborted) return;
            patch(id, { status: 'failed', error: errorText(err) });
          })
          .finally(() => {
            controllers.delete(id);
          });
      }
    },
    [limits.data],
  );

  const remove = useCallback((id: string) => {
    const store = useAttachmentStore.getState();
    const item = store.items.find((a) => a.id === id);
    controllers.get(id)?.abort();
    controllers.delete(id);
    store.remove(id);
    // Removed before sending: delete it from storage too (it was never used).
    if (item?.uploadId) api.uploads.remove(item.uploadId).catch(() => undefined);
  }, []);

  const readyIds = useMemo(() => readyAttachmentIds(items), [items]);

  return {
    items,
    add,
    remove,
    readyIds,
    /** Still uploading or reading a file: Send waits. */
    busy: items.some((a) => a.status === 'uploading' || a.status === 'processing'),
    hasFailed: items.some((a) => a.status === 'failed'),
    /** False when the backend says uploads are off (or doesn't have them yet). */
    enabled: limits.data?.enabled ?? !(limits.isError && isApiError(limits.error) && limits.error.code === 'NOT_FOUND'),
    limits: limits.data ?? null,
  };
}
