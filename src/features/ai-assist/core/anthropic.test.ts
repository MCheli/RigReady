import { afterEach, describe, expect, it } from 'vitest';
import {
  messageEvents,
  streamedMessage,
  streamOf,
  type StreamEvent,
} from '../../../../tests/aiStream';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  approximateCost,
  FALLBACK_BETA,
  MAX_RESPONSE_BYTES,
  messageBody,
  scrub,
  sendMessage,
  streamMessage,
  testKey,
  type StreamUpdate,
} from './anthropic';

const KEY = 'sk-ant-test-0123456789abcdefWXYZ';
let rig: TestRig;
afterEach(() => rig?.cleanup());

const body = messageBody({
  model: 'claude-opus-5-5',
  system: 'system text',
  context: 'big stable context',
  task: 'the task',
  schema: { type: 'object' },
  maxTokens: 1000,
});

const ok = (text: string, extra: Record<string, unknown> = {}) => ({
  json: {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 0,
    },
    ...extra,
  },
});

describe('Anthropic Messages API over the Http port', () => {
  it('builds the request: cached context, structured output, refusal fallback, medium effort', () => {
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: { type: 'object' } },
      },
      fallbacks: 'default',
      system: [{ type: 'text', text: 'system text' }],
    });
    const content = (body.messages as { content: unknown[] }[])[0]!.content;
    expect(content).toEqual([
      { type: 'text', text: 'big stable context', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'the task' },
    ]);
    // No key anywhere in the body: it is a header only.
    const plain = messageBody({ model: 'm', system: 's', context: 'c', task: 't', maxTokens: 10 });
    expect(plain.output_config).toEqual({ effort: 'medium' });
  });

  it('sends the key only as the x-api-key header, with the API version and the fallback beta', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    rig.ports.http.respond('api.anthropic.com/v1/messages', ok('hello'));
    const answer = await sendMessage(rig.ports.http, KEY, body);
    expect(answer.ok && answer.value.text).toBe('hello');
    const call = rig.ports.http.calls[0]!;
    expect(call).toMatchObject({ method: 'POST', url: 'https://api.anthropic.com/v1/messages' });
    expect(call.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': FALLBACK_BETA,
    });
    expect(call.body).not.toContain(KEY);
    if (answer.ok) {
      expect(answer.value.usage).toEqual({
        input: 100,
        output: 50,
        cacheWrite: 2000,
        cacheRead: 0,
      });
      expect(answer.value.cost).toBeCloseTo((100 * 4 + 2000 * 5 + 50 * 20) / 1e6, 8);
    }
  });

  it('turns every failure into a plain message: key, rate limit, overload, refusal, cut-off, network', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    const cases: [Parameters<typeof rig.ports.http.respond>[1] | 'network', string, RegExp][] = [
      [
        {
          status: 401,
          json: { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        },
        'ai.key',
        /did not accept/,
      ],
      [{ status: 403, json: { error: { message: 'no' } } }, 'ai.forbidden', /not allowed/],
      [{ status: 404, json: { error: { message: 'model: x' } } }, 'ai.model', /not available/],
      [
        { status: 429, json: { error: { message: 'rate' } } },
        'ai.rateLimited',
        /Try again in a minute/,
      ],
      [
        { status: 529, json: { error: { type: 'overloaded_error' } } },
        'ai.unavailable',
        /busy or down/,
      ],
      [{ status: 400, body: 'not json' }, 'ai.request', /refused the request/],
      [
        ok('', {
          stop_reason: 'refusal',
          stop_details: { category: 'cyber', explanation: 'policy' },
        }),
        'ai.refused',
        /declined/,
      ],
      [ok('{"summary": "half', { stop_reason: 'max_tokens' }), 'ai.truncated', /cut off/],
      [{ status: 200, body: '<html>proxy</html>' }, 'ai.malformed', /could not read/],
      [{ status: 200, body: 'x'.repeat(MAX_RESPONSE_BYTES + 1) }, 'ai.oversized', /far larger/],
      ['network', 'ai.network', /Could not reach/],
    ];
    for (const [response, code, message] of cases) {
      rig.ports.http.scripts.length = 0;
      if (response === 'network')
        rig.ports.http.scripts.push({ match: { url: 'anthropic' }, error: 'ECONNREFUSED' });
      else rig.ports.http.respond('anthropic', response);
      const answer = await sendMessage(rig.ports.http, KEY, body);
      expect(answer.ok, code).toBe(false);
      if (!answer.ok) {
        expect(answer.error.code).toBe(code);
        expect(answer.error.message).toMatch(message);
      }
    }
  });

  it('says how long to wait when rate limited', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    rig.ports.http.scripts.push({
      match: { url: 'anthropic' },
      response: {
        status: 429,
        headers: { 'Retry-After': '17' },
        json: { error: { message: 'slow down' } },
      },
    });
    const answer = await sendMessage(rig.ports.http, KEY, body);
    expect(!answer.ok && answer.error.message).toContain('Try again in 17 seconds');
    expect(!answer.ok && answer.error.detail).toBe('Anthropic said: slow down');
  });

  it('never returns the key, even when a hostile or broken server echoes it back', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    rig.ports.http.respond('anthropic', {
      status: 400,
      json: { error: { message: `bad key ${KEY} here` } },
    });
    const answer = await sendMessage(rig.ports.http, KEY, body);
    expect(JSON.stringify(answer)).not.toContain(KEY);
    expect(!answer.ok && answer.error.detail).toContain('[key]');
    expect(scrub('short', 'abc')).toBe('short');
  });

  it('tests a key with one free request for the model, and says why a key does not work', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    rig.ports.http.respond('/v1/models/claude-opus-5-5', { json: { id: 'claude-opus-5-5' } });
    const good = await testKey(rig.ports.http, KEY, 'claude-opus-5-5');
    expect(good.ok && good.value).toEqual({ valid: true, model: 'claude-opus-5-5' });
    expect(rig.ports.http.calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.anthropic.com/v1/models/claude-opus-5-5',
    });
    expect(rig.ports.http.calls[0]!.body).toBeUndefined();

    rig.ports.http.scripts.length = 0;
    rig.ports.http.respond('/v1/models/', { status: 401, json: { error: { message: 'invalid' } } });
    const bad = await testKey(rig.ports.http, KEY, 'claude-opus-5-5');
    expect(bad.ok && bad.value).toEqual({
      valid: false,
      reason: 'Anthropic did not accept this key.',
    });

    rig.ports.http.scripts.length = 0;
    rig.ports.http.respond('/v1/models/', { status: 404, json: { error: { message: 'nope' } } });
    const model = await testKey(rig.ports.http, KEY, 'claude-sonnet-5-5');
    expect(model.ok && !model.value.valid && model.value.reason).toContain('Claude Sonnet 5.5');

    rig.ports.http.scripts.length = 0;
    rig.ports.http.respond('/v1/models/', { status: 529, json: {} });
    expect((await testKey(rig.ports.http, KEY, 'claude-opus-5-5')).ok).toBe(false);
    rig.ports.http.scripts.length = 0;
    expect((await testKey(rig.ports.http, KEY, 'claude-opus-5-5')).ok).toBe(false);
  });

  it('estimates cost per model, with cache writes and reads priced apart', () => {
    const usage = { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 };
    expect(approximateCost('claude-opus-5-5', usage)).toBeCloseTo(4);
    expect(approximateCost('claude-sonnet-5-5', usage)).toBeCloseTo(2);
    expect(
      approximateCost('claude-sonnet-5-5', { ...usage, input: 0, cacheRead: 1_000_000 })
    ).toBeCloseTo(0.2);
    expect(approximateCost('unknown-model', usage)).toBeCloseTo(4);
  });
});

describe('a streamed answer from the Messages API', () => {
  const streamBody = messageBody({
    model: 'claude-opus-5-5',
    system: 'system text',
    context: 'big stable context',
    task: 'the task',
    schema: { type: 'object' },
    maxTokens: 1000,
    stream: true,
  });
  const TEXT = '{"summary":"Größe ✈ 日本語 🛩️","items":[{"actionId":"a"},{"actionId":"b"}]}';
  const USAGE = {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 7,
  };
  const event = (type: string, data: Record<string, unknown> = {}): StreamEvent => ({
    event: type,
    data: { type, ...data },
  });
  /** The events of a message up to and including its first pieces of text. */
  const opening = (): StreamEvent[] => messageEvents(TEXT, { pieceChars: 10 }).slice(0, 8);

  async function run(
    response: Parameters<typeof rig.ports.http.respond>[1],
    options: Parameters<typeof streamMessage>[3] = {}
  ) {
    rig ??= await scenarioRig('flying-fresh', { files: [] });
    rig.ports.http.scripts.length = 0;
    rig.ports.http.calls.length = 0;
    rig.ports.http.respond('api.anthropic.com/v1/messages', response);
    const updates: StreamUpdate[] = [];
    const answer = await streamMessage(rig.ports.http, KEY, streamBody, {
      onUpdate: (u) => updates.push(u),
      ...options,
    });
    return { answer, updates };
  }

  it('asks for a stream with the same headers, and puts the answer together from the events', async () => {
    expect(streamBody.stream).toBe(true);
    expect('stream' in body).toBe(false);
    // Cut every 7 bytes: events, lines and characters all arrive in pieces.
    const { answer, updates } = await run(
      streamedMessage(TEXT, { usage: USAGE, pieceChars: 9, chunkBytes: 7 })
    );
    expect(answer).toEqual({
      ok: true,
      value: {
        text: TEXT,
        model: 'claude-opus-5-5',
        usage: { input: 100, output: 50, cacheWrite: 2000, cacheRead: 7 },
        cost: expect.closeTo((100 * 4 + 2000 * 5 + 7 * 0.2 + 50 * 20) / 1e6, 8),
      },
    });
    const call = rig.ports.http.calls[0]!;
    expect(call).toMatchObject({ method: 'POST', url: 'https://api.anthropic.com/v1/messages' });
    expect(call.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': FALLBACK_BETA,
      accept: 'text/event-stream',
    });
    expect(JSON.parse(call.body!)).toMatchObject({ stream: true, model: 'claude-opus-5-5' });
    expect(call.body).not.toContain(KEY);
    // Progress: the start, then text whose pieces add up to the answer.
    expect(updates[0]).toEqual({ kind: 'started' });
    const text = updates.filter((u) => u.kind === 'text');
    expect(text.map((u) => u.delta).join('')).toBe(TEXT);
    expect(text.at(-1)!.chars).toBe(TEXT.length);
    expect(text.length).toBeGreaterThan(3);
  });

  it('reads CRLF line ends and ignores pings, thinking, and event types it does not know', async () => {
    const raw = messageEvents('Hello there.', { usage: USAGE, pieceChars: 5 })
      .flatMap((e) => [e, event('some_future_event', { anything: [1, 2] })])
      .map((e) => `event: ${e.event}\r\ndata: ${JSON.stringify(e.data)}\r\n\r\n`);
    const { answer } = await run({ stream: streamOf(raw, { chunkBytes: 11 }) });
    expect(answer.ok && answer.value.text).toBe('Hello there.');
    expect(answer.ok && answer.value.usage.output).toBe(50);
  });

  it('keeps the plain messages when the stream fails before the first byte: key, rate limit, overload, network', async () => {
    const cases: [Parameters<typeof rig.ports.http.respond>[1] | 'network', string, RegExp][] = [
      [
        { status: 401, json: { error: { type: 'authentication_error', message: 'invalid' } } },
        'ai.key',
        /did not accept/,
      ],
      [{ status: 404, json: { error: { message: 'model: x' } } }, 'ai.model', /not available/],
      [{ status: 429, json: { error: { message: 'rate' } } }, 'ai.rateLimited', /in a minute/],
      [
        { status: 529, json: { error: { type: 'overloaded_error', message: 'Overloaded' } } },
        'ai.unavailable',
        /busy or down/,
      ],
      [{ status: 400, body: 'not json' }, 'ai.request', /refused the request/],
      [{ status: 500, body: 'x'.repeat(MAX_RESPONSE_BYTES + 1) }, 'ai.oversized', /far larger/],
      ['network', 'ai.network', /Could not reach/],
    ];
    for (const [response, code, message] of cases) {
      rig ??= await scenarioRig('flying-fresh', { files: [] });
      rig.ports.http.scripts.length = 0;
      let updates = 0;
      if (response === 'network')
        rig.ports.http.scripts.push({ match: { url: 'anthropic' }, error: 'ECONNREFUSED' });
      else rig.ports.http.respond('anthropic', response);
      const answer = await streamMessage(rig.ports.http, KEY, streamBody, {
        onUpdate: () => updates++,
      });
      expect(!answer.ok && answer.error.code, code).toBe(code);
      expect(!answer.ok && answer.error.message).toMatch(message);
      expect(updates).toBe(0);
    }
    rig.ports.http.scripts.length = 0;
    rig.ports.http.scripts.push({
      match: { url: 'anthropic' },
      response: { status: 429, headers: { 'Retry-After': '17' }, json: { error: {} } },
    });
    const limited = await streamMessage(rig.ports.http, KEY, streamBody);
    expect(!limited.ok && limited.error.message).toContain('Try again in 17 seconds');
  });

  it('turns an error event in the middle of a stream into the same plain messages, and stops reading', async () => {
    const cases: [string, string, RegExp][] = [
      ['overloaded_error', 'ai.unavailable', /busy or down/],
      ['rate_limit_error', 'ai.rateLimited', /limiting requests/],
      ['authentication_error', 'ai.key', /did not accept/],
      ['api_error', 'ai.unavailable', /busy or down/],
      ['invalid_request_error', 'ai.request', /refused the request/],
      ['an_error_type_added_later', 'ai.unavailable', /busy or down/],
    ];
    for (const [type, code, message] of cases) {
      // The server would close the stream after the error; this one never does, and the
      // request must still end at once instead of waiting for the idle timeout.
      const { answer, updates } = await run({
        stream: streamOf(
          [...opening(), event('error', { error: { type, message: `Problem with ${KEY}` } })],
          { end: 'hang' }
        ),
      });
      expect(!answer.ok && answer.error.code, type).toBe(code);
      expect(!answer.ok && answer.error.message).toMatch(message);
      expect(!answer.ok && answer.error.detail).toBe('Anthropic said: Problem with [key]');
      expect(JSON.stringify(answer)).not.toContain(KEY);
      expect(updates.some((u) => u.kind === 'text')).toBe(true);
    }
    // An error event before anything else, and one that says nothing.
    const first = await run({ stream: streamOf([event('error', {})]) });
    expect(!first.answer.ok && first.answer.error.code).toBe('ai.unavailable');
    expect(first.updates).toEqual([]);
  });

  it('uses nothing from a stream that ends without message_stop, runs out of tokens, or is refused', async () => {
    const cut = await run(streamedMessage(TEXT, { withoutStop: true }));
    expect(!cut.answer.ok && cut.answer.error).toMatchObject({
      code: 'ai.incomplete',
      message: expect.stringMatching(/ended before it was complete, so nothing from it was used/),
    });
    // Closed in the middle of the text, and in the middle of an event.
    const early = await run({ stream: streamOf(opening()) });
    expect(!early.answer.ok && early.answer.error.code).toBe('ai.incomplete');
    const whole = messageEvents(TEXT)
      .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
      .join('');
    const midEvent = await run({ stream: streamOf([whole.slice(0, whole.length - 20)]) });
    expect(!midEvent.answer.ok && midEvent.answer.error.code).toBe('ai.incomplete');

    const tokens = await run(streamedMessage('{"summary":"half', { stopReason: 'max_tokens' }));
    expect(!tokens.answer.ok && tokens.answer.error).toMatchObject({
      code: 'ai.truncated',
      message: expect.stringMatching(/cut off/),
    });

    const events = messageEvents('', {});
    const delta = events.find((e) => e.event === 'message_delta')!;
    delta.data.delta = {
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'policy' },
    };
    const refused = await run({ stream: streamOf(events) });
    expect(!refused.answer.ok && refused.answer.error).toMatchObject({
      code: 'ai.refused',
      detail: 'policy',
    });
  });

  it('refuses what is not an event stream: a proxy page, unreadable data, far too much of it', async () => {
    const page = await run({ status: 200, body: '<html>proxy</html>' });
    expect(!page.answer.ok && page.answer.error.code).toBe('ai.malformed');
    const plain = await run({ json: { content: [{ type: 'text', text: 'not streamed' }] } });
    expect(!plain.answer.ok && plain.answer.error.code).toBe('ai.malformed');
    const garbage = await run({
      stream: streamOf([...opening(), 'data: {not json\n\n'], { end: 'hang' }),
    });
    expect(!garbage.answer.ok && garbage.answer.error.code).toBe('ai.malformed');
    const untyped = await run({ stream: streamOf(['data: {"no":"type"}\n\n']) });
    expect(!untyped.answer.ok && untyped.answer.error.code).toBe('ai.malformed');

    const huge = await run({
      stream: streamOf(
        [...opening(), `: ${'x'.repeat(MAX_RESPONSE_BYTES)}\n`, ...messageEvents(TEXT).slice(8)],
        { end: 'hang' }
      ),
    });
    expect(!huge.answer.ok && huge.answer.error).toMatchObject({
      code: 'ai.oversized',
      message: expect.stringMatching(/far larger/),
    });
  });

  it('ends a stream that stalls or breaks with a plain message that says nothing was used', async () => {
    const silent = await run({ stream: streamOf([], { end: 'hang' }) }, { idleTimeoutMs: 30 });
    expect(!silent.answer.ok && silent.answer.error).toMatchObject({
      code: 'ai.stalled',
      message: 'The Anthropic API did not start answering within 0 seconds. Try again.',
    });
    const stalled = await run({ stream: streamOf(opening(), { end: 'stall' }) });
    expect(!stalled.answer.ok && stalled.answer.error).toMatchObject({
      code: 'ai.stalled',
      message:
        'The answer stopped arriving: nothing came for 90 seconds, so nothing from it was used. Try again.',
    });
    expect(stalled.updates.some((u) => u.kind === 'text')).toBe(true);
    // A pause between two chunks that is longer than the idle timeout.
    const paused = await run(
      { stream: { chunks: [...opening(), { text: ': late\n\n', delayMs: 500 }] } },
      { idleTimeoutMs: 40 }
    );
    expect(!paused.answer.ok && paused.answer.error.code).toBe('ai.stalled');

    const broken = await run({ stream: streamOf(opening(), { end: 'reset' }) });
    expect(!broken.answer.ok && broken.answer.error).toMatchObject({
      code: 'ai.interrupted',
      message: expect.stringMatching(/broke before the answer was complete/),
    });
    const slow = await run(streamedMessage(TEXT, { delayMs: 30 }), { timeoutMs: 50 });
    expect(!slow.answer.ok && slow.answer.error.code).toBe('ai.timeout');
  });

  it('stops at once when cancelled, before or during the answer', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const { answer } = await run(
      { stream: streamOf(opening(), { end: 'hang' }) },
      {
        signal: controller.signal,
        onUpdate: (u) => {
          if (u.kind === 'text') controller.abort();
        },
      }
    );
    expect(answer).toEqual({
      ok: false,
      error: { code: 'ai.cancelled', message: 'Cancelled. Nothing from the answer was used.' },
    });
    expect(Date.now() - started).toBeLessThan(5000);

    const already = new AbortController();
    already.abort();
    const before = await run(streamedMessage(TEXT), { signal: already.signal });
    expect(!before.answer.ok && before.answer.error.code).toBe('ai.cancelled');
  });

  it('reports the model that finished the answer when a refusal fallback took over mid-stream', async () => {
    const events = messageEvents('second half', { usage: USAGE });
    events.splice(
      5,
      0,
      event('content_block_start', {
        index: 1,
        content_block: { type: 'text', text: 'first half, ' },
      }),
      event('content_block_stop', { index: 1 }),
      event('content_block_start', {
        index: 2,
        content_block: {
          type: 'fallback',
          from: { model: 'claude-opus-5-5' },
          to: { model: 'claude-sonnet-5-5' },
        },
      }),
      event('content_block_stop', { index: 2 })
    );
    const { answer } = await run({ stream: streamOf(events) });
    expect(answer.ok && answer.value).toMatchObject({
      text: 'first half, second half',
      model: 'claude-sonnet-5-5',
      cost: expect.closeTo((100 * 2 + 2000 * 2.5 + 7 * 0.2 + 50 * 10) / 1e6, 8),
    });
  });
});
