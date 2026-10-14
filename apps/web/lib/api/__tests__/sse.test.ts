import { parseFrames, runStream, WATCHDOG_MS } from '../sse';

const fetchSpy = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/monad/payments', () => ({
  paidFetch: (input: string | URL, init?: RequestInit) => fetchSpy(input, init),
}));

/** A stream that never closes but errors when the fetch signal aborts (like a real fetch). */
function neverStream(signal?: AbortSignal | null): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        signal?.addEventListener('abort', () => {
          c.error(new DOMException('The operation was aborted.', 'AbortError'));
        });
      },
    }),
  );
}

function streamOf(chunks: string[], delayMs = 0): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      for (const ch of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        c.enqueue(enc.encode(ch));
      }
      c.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

const body = { quoteId: 'q', prompt: 'hi' };

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseFrames', () => {
  it('splits complete frames, keeps the partial tail and marks comment heartbeats', () => {
    const { frames, rest } = parseFrames('event: delta\ndata: {"text":"a"}\n\n: keep-alive\n\nevent: hea');
    expect(frames).toEqual([
      { event: 'delta', data: '{"text":"a"}', comment: false },
      { event: 'heartbeat', data: '', comment: true },
    ]);
    expect(rest).toBe('event: hea');
  });
});

describe('runStream', () => {
  it('dispatches meta, delta, heartbeat, fallback and done (PDF events)', async () => {
    fetchSpy.mockResolvedValue(
      streamOf([
        'event: meta\ndata: {"requestId":"r1","modelId":"m","label":"M","priceUsd":"0.0009","free":false,"remainingUsd":"1.99"}\n\n',
        'event: delta\ndata: {"text":"Hel"}\n\nevent: del',
        'ta\ndata: {"text":"lo"}\n\n: heartbeat\n\n',
        'event: fallback\ndata: {"fromModelId":"m","toModelId":"m2","label":"M2","reason":"timeout"}\n\n',
        'event: done\ndata: {"requestId":"r1","modelId":"m2","text":"Hello","files":[],"chargedUsd":0.0009,"latencyMs":1200}\n\n',
      ]),
    );
    const h = { onMeta: vi.fn(), onDelta: vi.fn(), onHeartbeat: vi.fn(), onFallback: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    const out = await runStream(body, { free: true }, h);
    expect(out.kind).toBe('done');
    expect(h.onMeta).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', priceUsd: 900, remainingUsd: 1_990_000 }));
    expect((h.onDelta.mock.calls as [string][]).map((c) => c[0])).toEqual(['Hel', 'lo']);
    expect(h.onHeartbeat).toHaveBeenCalledTimes(1);
    expect(h.onFallback).toHaveBeenCalledWith(expect.objectContaining({ toModelId: 'm2' }));
    expect(h.onDone).toHaveBeenCalledWith(expect.objectContaining({ chargedUsd: 900, latencyMs: 1200 }));
    expect(h.onError).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/run');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('resolves pending and error events', async () => {
    // Paid runs need the signing wallet's address (the voucher's `user`).
    const ADDRESS = `0x${'ab'.repeat(20)}`;
    fetchSpy.mockResolvedValueOnce(streamOf(['event: pending\ndata: {"requestId":"r2","pollUrl":"/requests/r2"}\n\n']));
    expect(await runStream(body, { free: false, address: ADDRESS }, {})).toEqual({ kind: 'pending', data: { requestId: 'r2', pollUrl: '/requests/r2' } });

    fetchSpy.mockResolvedValueOnce(streamOf(['event: error\ndata: {"code":"PROVIDER_UNAVAILABLE","message":"twice","refunded":true,"refundedUsd":0.0009,"freeRerun":{"available":true,"modelId":"free:llama-3.1-8b"}}\n\n']));
    const onError = vi.fn();
    const out = await runStream(body, { free: false, address: ADDRESS }, { onError });
    expect(out.kind).toBe('error');
    expect((out as { data: { code: string; refundedUsd: number } }).data).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', refundedUsd: 900 });
    expect(onError).toHaveBeenCalled();
  });

  it('maps a non-OK response to its error code before any stream', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ code: 'QUOTE_EXPIRED', message: 'old' }), { status: 410 }));
    const out = await runStream(body, { free: true }, {});
    expect(out).toMatchObject({ kind: 'error', data: { code: 'QUOTE_EXPIRED' } });
  });

  it('times out after 60 s of silence', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((_u, init) => Promise.resolve(neverStream(init?.signal)));
    const p = runStream(body, { free: true }, {});
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 10);
    const out = await p;
    vi.useRealTimers();
    expect(out).toMatchObject({ kind: 'error', data: { code: 'TIMEOUT' } });
  });

  it('reports abort when the caller cancels', async () => {
    fetchSpy.mockImplementation((_u, init) => Promise.resolve(neverStream(init?.signal)));
    const ac = new AbortController();
    const p = runStream(body, { free: true }, {}, ac.signal);
    ac.abort();
    expect((await p).kind).toBe('aborted');
  });
});
