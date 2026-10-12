/**
 * File uploads into chats (backend "File uploads"): `POST /uploads` → PUT the bytes straight to
 * storage at `putUrl` (never through the API) → `POST /uploads/:id/complete`, which pulls the
 * text out. The ready `uploadId`s then go on the quote as `attachmentIds`.
 */
import { api } from '@/lib/api/endpoints';
import type { Upload } from '@/lib/api/types';

/** Same rule as the backend: documents only (PDF, Word, text, Markdown, CSV, JSON, code). */
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql|toml|ini|log)$/i;

/** `accept` for the file picker. */
export const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cs,.php,.sh,.sql,.toml,.ini,.log,application/pdf,text/*,application/json';

export function isAccepted(file: { name: string; type: string }): boolean {
  const mime = file.type.toLowerCase();
  if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) return true;
  if (/\.docx$/i.test(file.name)) return true;
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return true;
  return TEXT_EXT.test(file.name);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${String(Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** PUT with progress (XHR: fetch can't report upload progress). */
function put(url: string, headers: Record<string, string>, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${String(xhr.status)})`));
    };
    xhr.onerror = () => {
      reject(new Error('Upload failed — check your connection and try again.'));
    };
    xhr.onabort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', () => {
      xhr.abort();
    });
    xhr.send(file);
  });
}

/** Upload one file end to end. `onUploadId` fires as soon as the server has an id for it. */
export async function uploadFile(file: File, opts: { onProgress: (fraction: number) => void; onUploadId?: (id: string) => void; signal?: AbortSignal }): Promise<Upload> {
  const ticket = await api.uploads.create({ filename: file.name, mime: file.type, sizeBytes: file.size });
  opts.onUploadId?.(ticket.uploadId);
  await put(ticket.putUrl, ticket.headers, file, opts.onProgress, opts.signal);
  opts.onProgress(1);
  return api.uploads.complete(ticket.uploadId);
}
