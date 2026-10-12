import { create } from 'zustand';

/** A file attached to the draft. `uploadId` once the server knows it; `ready` once its text is in. */
export interface DraftAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mime: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  /** 0–1 while the bytes go up. */
  progress: number;
  uploadId: string | null;
  error: string | null;
  tokens: number | null;
  truncated: boolean;
}

interface AttachmentState {
  items: DraftAttachment[];
  add: (item: DraftAttachment) => void;
  patch: (id: string, over: Partial<DraftAttachment>) => void;
  remove: (id: string) => void;
  clear: () => void;
}

/** Files attached to the message being written. In-memory only; cleared once the message runs. */
export const useAttachmentStore = create<AttachmentState>()((set) => ({
  items: [],
  add: (item) => {
    set((s) => ({ items: [...s.items, item] }));
  },
  patch: (id, over) => {
    set((s) => ({ items: s.items.map((a) => (a.id === id ? { ...a, ...over } : a)) }));
  },
  remove: (id) => {
    set((s) => ({ items: s.items.filter((a) => a.id !== id) }));
  },
  clear: () => {
    set({ items: [] });
  },
}));

/** Upload ids of the ready attachments, in order (what goes on the quote). */
export const readyAttachmentIds = (items: DraftAttachment[]): string[] => items.flatMap((a) => (a.status === 'ready' && a.uploadId ? [a.uploadId] : []));
