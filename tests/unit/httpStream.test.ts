import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Http, HttpStreamRequest } from '../../src/core/ports';
import { FakeHttp } from '../../src/platform/fake';
import { ScenarioSchema } from '../../src/platform/fake/scenario';
import { NodeHttp } from '../../src/platform/node';
import { wiredApp, type TestRig } from '../helpers';

/** `Http.stream`: the scripted fake (as a scenario file writes it) and the real port on a stubbed fetch. */

let rig: TestRig | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await rig?.cleanup();
  rig = undefined;
});

const text = (chunks: Uint8Array[]): string => Buffer.concat(chunks).toString('utf8');

async function collect(http: Http, request: HttpStreamRequest) {
  const chunks: Uint8Array[] = [];
  const result = await http.stream(request, (bytes) => chunks.push(bytes));
  return { result, chunks };
}

/** A fake loaded with the `http:` entries of a scenario file. */
function scripted(http: unknown[]): FakeHttp {
  const fake = new FakeHttp();
  fake.scripts.push(...ScenarioSchema.parse({ description: 'x', rig: 'mark-full', http }).http);
  return fake;
}

const URL_ = 'https://api.example.org/v1/stream';

describe('the scripted http port: streams', () => {
  it('delivers the chunks of a scenario entry in order, text and events, then closes', async () => {
    const http = scripted([
      {
        match: { url: 'api.example.org', method: 'POST', body: 'please' },
        response: {
          headers: { 'X-Request': 'r1' },
          stream: {
            chunks: [
              'retry: 1\n\n',
              { text: ': hello\n\n' },
              { event: 'tick', data: { n: 1 } },
              { data: 'ünïcode ✈' },
            ],
          },
        },
      },
    ]);
    const { result, chunks } = await collect(http, {
      method: 'POST',
      url: URL_,
      headers: { 'x-api-key': 'k' },
      body: 'please stream',
      signal: new AbortController().signal,
    });
    expect(chunks.map((c) => Buffer.from(c).toString('utf8'))).toEqual([
      'retry: 1\n\n',
      ': hello\n\n',
      'event: tick\ndata: {"n":1}\n\n',
      'data: "ünïcode ✈"\n\n',
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-request': 'r1' },
        body: '',
      },
    });
    // The request is recorded like any other, without the signal.
    expect(http.calls).toEqual([
      { method: 'POST', url: URL_, headers: { 'x-api-key': 'k' }, body: 'please stream' },
    ]);
    // The same entry asked for in one piece is the whole body.
    const whole = await http.request({ method: 'POST', url: URL_, body: 'please' });
    expect(whole.ok && whole.value.body).toBe(text(chunks));
    expect(whole.ok && whole.value.headers['content-type']).toBe('text/event-stream');
  });

  it('re-cuts the body into pieces of chunkBytes, through lines and characters', async () => {
    const http = new FakeHttp();
    http.respond('example.org', {
      stream: { chunks: ['data: 日本語\n\n', { event: 'end', data: {} }], chunkBytes: 4 },
    });
    const { chunks } = await collect(http, { url: URL_ });
    expect(chunks.every((c) => c.length <= 4)).toBe(true);
    expect(chunks.length).toBe(Math.ceil(Buffer.byteLength(text(chunks)) / 4));
    expect(text(chunks)).toBe('data: 日本語\n\nevent: end\ndata: {}\n\n');
    // At least one piece on its own is not valid UTF-8: a character was cut.
    expect(chunks.some((c) => Buffer.from(c).toString('utf8').includes('�'))).toBe(true);
  });

  it("paces the chunks in real time: the delay of the entry, or the chunk's own", async () => {
    const http = new FakeHttp();
    http.respond('example.org', {
      stream: { delayMs: 40, chunks: ['a', 'b', { text: 'c', delayMs: 0 }] },
    });
    const at: number[] = [];
    const started = Date.now();
    await http.stream({ url: URL_ }, () => at.push(Date.now() - started));
    expect(at).toHaveLength(3);
    expect(at[0]).toBeGreaterThanOrEqual(35);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(35);
    expect(at[2]! - at[1]!).toBeLessThan(35);
  });

  it('does not stream a status that is not 2xx: the whole body is the result', async () => {
    const http = scripted([
      {
        match: { url: 'example.org' },
        response: { status: 529, headers: { 'Retry-After': '5' }, json: { error: 'busy' } },
      },
    ]);
    const { result, chunks } = await collect(http, { url: URL_ });
    expect(chunks).toEqual([]);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 529,
        headers: { 'content-type': 'application/json', 'retry-after': '5' },
        body: '{"error":"busy"}',
      },
    });
  });

  it('hands a response that was not scripted as a stream over as one chunk', async () => {
    const http = new FakeHttp();
    http.respond('example.org/json', { json: { a: 1 } });
    http.respond('example.org/empty', {});
    const json = await collect(http, { url: 'https://example.org/json' });
    expect(text(json.chunks)).toBe('{"a":1}');
    expect(json.result.ok && json.result.value).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    const empty = await collect(http, { url: 'https://example.org/empty' });
    expect(empty.chunks).toEqual([]);
    expect(empty.result.ok).toBe(true);
  });

  it('fails like the network: unscripted, scripted error, a connection that breaks part-way', async () => {
    const http = scripted([
      { match: { url: 'down.example' }, error: 'ECONNREFUSED' },
      { match: { url: 'flaky.example' }, response: { stream: { chunks: ['half'], end: 'reset' } } },
    ]);
    expect((await collect(http, { url: 'https://nothing.example/' })).result).toMatchObject({
      ok: false,
      error: { code: 'http.unscripted' },
    });
    expect((await collect(http, { url: 'https://down.example/' })).result).toMatchObject({
      ok: false,
      error: { code: 'http.network', detail: 'ECONNREFUSED' },
    });
    const flaky = await collect(http, { url: 'https://flaky.example/' });
    expect(text(flaky.chunks)).toBe('half');
    expect(flaky.result).toMatchObject({ ok: false, error: { code: 'http.network' } });
  });

  it('ends a silent stream by the idle timeout, the total timeout or the scripted stall', async () => {
    const http = new FakeHttp();
    http.respond('example.org/hang', { stream: { chunks: ['a'], end: 'hang' } });
    http.respond('example.org/slow', { stream: { chunks: ['a', { text: 'b', delayMs: 5000 }] } });
    http.respond('example.org/stall', { stream: { chunks: ['a'], end: 'stall' } });
    http.respond('example.org/long', { stream: { chunks: ['a', 'b', 'c', 'd'], delayMs: 30 } });

    const hang = await collect(http, { url: 'https://example.org/hang', idleTimeoutMs: 30 });
    expect(text(hang.chunks)).toBe('a');
    expect(hang.result).toMatchObject({ ok: false, error: { code: 'http.idle' } });

    const slow = await collect(http, { url: 'https://example.org/slow', idleTimeoutMs: 30 });
    expect(text(slow.chunks)).toBe('a');
    expect(slow.result).toMatchObject({ ok: false, error: { code: 'http.idle' } });

    // "stall" does not wait for the (default, one minute) idle timeout.
    const started = Date.now();
    const stall = await collect(http, { url: 'https://example.org/stall' });
    expect(stall.result).toMatchObject({
      ok: false,
      error: { code: 'http.idle', message: 'The server sent nothing for 60 seconds.' },
    });
    expect(Date.now() - started).toBeLessThan(2000);

    const long = await collect(http, { url: 'https://example.org/long', timeoutMs: 75 });
    expect(long.chunks.length).toBeLessThan(4);
    expect(long.result).toMatchObject({ ok: false, error: { code: 'http.timeout' } });
  });

  it('stops at once when the signal is aborted: before the request, between chunks, while hanging', async () => {
    const http = new FakeHttp();
    http.respond('example.org/hang', { stream: { chunks: ['a'], end: 'hang' } });
    http.respond('example.org/paced', { stream: { chunks: ['a', 'b', 'c'], delayMs: 5000 } });

    const already = new AbortController();
    already.abort();
    const before = await collect(http, { url: 'https://example.org/hang', signal: already.signal });
    expect(before.result).toMatchObject({ ok: false, error: { code: 'http.cancelled' } });
    expect(before.chunks).toEqual([]);

    const hanging = new AbortController();
    const started = Date.now();
    const pending = http.stream({ url: 'https://example.org/hang', signal: hanging.signal }, () =>
      // Cancelled from inside the chunk callback, as a caller that has seen enough does.
      hanging.abort()
    );
    expect(await pending).toMatchObject({ ok: false, error: { code: 'http.cancelled' } });

    const paced = new AbortController();
    setTimeout(() => paced.abort(), 20);
    const waiting = await collect(http, { url: 'https://example.org/paced', signal: paced.signal });
    expect(waiting.chunks).toEqual([]);
    expect(waiting.result).toMatchObject({ ok: false, error: { code: 'http.cancelled' } });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('refuses a stream script that is not one', () => {
    const bad = (stream: unknown) =>
      ScenarioSchema.safeParse({
        description: 'x',
        rig: 'mark-full',
        http: [{ response: { stream } }],
      }).success;
    expect(bad({ chunks: ['a'], end: 'explode' })).toBe(false);
    expect(bad({ chunks: [{ text: 'a', delayMs: -1 }] })).toBe(false);
    expect(bad({ chunks: [7] })).toBe(false);
    expect(bad({ chunks: ['a'], chunkBytes: 0 })).toBe(false);
    expect(bad({ chunks: ['a'] })).toBe(true);
  });

  it('reaches a feature through the context the app gives it', async () => {
    // Features get a wrapped copy of the ports; the copy must still stream.
    const app = await wiredApp('flying-fresh', { files: [] });
    rig = app;
    app.ports.http.respond('example.org', { stream: { chunks: ['one', 'two'] } });
    const { result, chunks } = await collect(app.wiring.context.ports.http, { url: URL_ });
    expect(result.ok).toBe(true);
    expect(text(chunks)).toBe('onetwo');
  });
});

describe('the real http port: streams', () => {
  /** A fetch that answers with a body the test feeds by hand. */
  function stubFetch(init: { status?: number; headers?: Record<string, string> } = {}) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const calls: { url: string; init: RequestInit }[] = [];
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    vi.stubGlobal('fetch', async (url: URL, request: RequestInit) => {
      calls.push({ url: String(url), init: request });
      const signal = request.signal!;
      if (signal.aborted) throw signal.reason;
      // Like the real one: an abort breaks the body that is being read.
      signal.addEventListener('abort', () => {
        try {
          controller.error(signal.reason);
        } catch {
          // The body was already closed or broken; there is nothing left to break.
        }
      });
      return new Response(body, { status: init.status ?? 200, headers: init.headers ?? {} });
    });
    const send = (s: string): void => controller.enqueue(new TextEncoder().encode(s));
    return {
      calls,
      send,
      close: () => controller.close(),
      fail: (e: Error) => controller.error(e),
    };
  }
  const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('refuses anything but https, and a request that is already cancelled, without a request', async () => {
    const fetched = stubFetch();
    const http = new NodeHttp();
    expect((await collect(http, { url: 'http://example.org/' })).result).toMatchObject({
      ok: false,
      error: { code: 'http.url', message: 'Only https addresses are allowed.' },
    });
    expect((await collect(http, { url: 'not a url' })).result).toMatchObject({
      ok: false,
      error: { code: 'http.url' },
    });
    const gone = new AbortController();
    gone.abort();
    expect((await collect(http, { url: URL_, signal: gone.signal })).result).toMatchObject({
      ok: false,
      error: { code: 'http.cancelled' },
    });
    expect(fetched.calls).toEqual([]);
  });

  it('hands the body over as it arrives and resolves when the server closes it', async () => {
    const fetched = stubFetch({ headers: { 'Content-Type': 'text/event-stream', 'X-A': 'b' } });
    const chunks: string[] = [];
    const pending = new NodeHttp().stream(
      { method: 'POST', url: URL_, headers: { 'x-api-key': 'k' }, body: '{"stream":true}' },
      (bytes) => chunks.push(Buffer.from(bytes).toString('utf8'))
    );
    await tick();
    fetched.send('data: one\n\n');
    await tick();
    // Delivered while the request is still open.
    expect(chunks).toEqual(['data: one\n\n']);
    fetched.send('data: two\n\n');
    fetched.close();
    expect(await pending).toEqual({
      ok: true,
      value: {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-a': 'b' },
        body: '',
      },
    });
    expect(chunks).toEqual(['data: one\n\n', 'data: two\n\n']);
    expect(fetched.calls[0]).toMatchObject({
      url: URL_,
      init: { method: 'POST', headers: { 'x-api-key': 'k' }, body: '{"stream":true}' },
    });
  });

  it('returns the whole body of a status that is not 2xx instead of streaming it', async () => {
    const fetched = stubFetch({ status: 429, headers: { 'Retry-After': '9' } });
    const pending = collect(new NodeHttp(), { url: URL_ });
    await tick();
    fetched.send('{"error":');
    fetched.send('"slow down"}');
    fetched.close();
    const { result, chunks } = await pending;
    expect(chunks).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      value: { status: 429, headers: { 'retry-after': '9' }, body: '{"error":"slow down"}' },
    });
  });

  it('gives up when nothing arrives for the idle timeout, counted from the last chunk', async () => {
    const fetched = stubFetch();
    const pending = collect(new NodeHttp(), { url: URL_, idleTimeoutMs: 120 });
    // Chunks that keep coming, each well inside the idle timeout, for longer than it in total.
    for (let i = 0; i < 4; i++) {
      await tick(50);
      fetched.send(`${i}`);
    }
    const { result, chunks } = await pending;
    expect(text(chunks)).toBe('0123');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'http.idle', message: 'api.example.org sent nothing for 0 seconds.' },
    });

    const never = stubFetch();
    const silent = await collect(new NodeHttp(), { url: URL_, idleTimeoutMs: 30 });
    expect(silent.result).toMatchObject({ ok: false, error: { code: 'http.idle' } });
    expect(never.calls).toHaveLength(1);
  });

  it('ends on the total timeout however steadily the stream arrives, and on cancellation at once', async () => {
    const fetched = stubFetch();
    const pending = collect(new NodeHttp(), { url: URL_, idleTimeoutMs: 5000, timeoutMs: 120 });
    await tick(20);
    fetched.send('a');
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'http.timeout' } });

    const again = stubFetch();
    const cancel = new AbortController();
    const started = Date.now();
    const cancelled = collect(new NodeHttp(), { url: URL_, signal: cancel.signal });
    await tick(20);
    again.send('a');
    await tick(20);
    cancel.abort();
    const { result, chunks } = await cancelled;
    expect(text(chunks)).toBe('a');
    expect(result).toEqual({
      ok: false,
      error: { code: 'http.cancelled', message: 'The request was cancelled.' },
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('reports a connection that breaks, before the response or in the middle of the body', async () => {
    const fetched = stubFetch();
    const pending = collect(new NodeHttp(), { url: URL_ });
    await tick();
    fetched.send('half');
    await tick();
    fetched.fail(new TypeError('terminated'));
    const { result, chunks } = await pending;
    expect(text(chunks)).toBe('half');
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'http.network',
        message: 'Could not reach api.example.org.',
        detail: 'terminated',
      },
    });

    vi.stubGlobal('fetch', async () => {
      throw 'refused';
    });
    expect((await collect(new NodeHttp(), { url: URL_ })).result).toMatchObject({
      ok: false,
      error: { code: 'http.network', detail: 'refused' },
    });
  });
});
