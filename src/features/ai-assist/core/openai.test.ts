import { describe, expect, it } from 'vitest';
import { chatAnswer, chatEvents, chatStream } from '../../../../tests/aiStream';
import { FakeHttp } from '../../../platform/fake';
import type { StreamUpdate } from './anthropic';
import {
  chatBody,
  jsonInstruction,
  jsonText,
  sendChat,
  streamChat,
  testChat,
  type ChatTarget,
} from './openai';
import { checkBaseUrl, providerFor, DEFAULT_SETTINGS, type ProviderSettings } from './providers';

/** OpenAI's Chat Completions and the servers that copy it, over the scripted Http port. */

const KEY = 'sk-proj-test-0123456789abcdefWXYZ';
const SCHEMA = { type: 'object', properties: { a: { type: 'string' } } };

const OPENAI: ChatTarget = {
  root: 'https://api.openai.com/v1',
  label: 'OpenAI',
  tokenField: 'max_completion_tokens',
  streamUsage: true,
  structured: 'schema',
  prices: { 'gpt-6.1-terra': { input: 1, output: 5, cacheRead: 0.05 } },
};
const LOCAL: ChatTarget = {
  root: 'http://localhost:11434/v1',
  label: 'the server at localhost:11434',
  tokenField: 'max_tokens',
  streamUsage: true,
  structured: 'prompt',
};

const request = (stream = false, schema: Record<string, unknown> | null = SCHEMA) => ({
  model: 'gpt-6.1-terra',
  system: 'system text',
  context: 'big stable context',
  task: 'the task',
  ...(schema ? { schema } : {}),
  maxTokens: 1000,
  ...(stream ? { stream: true } : {}),
});

const settings = (change: Partial<ProviderSettings>): ProviderSettings => ({
  ...DEFAULT_SETTINGS,
  ...change,
});

describe('the Chat Completions request', () => {
  it('puts the schema in response_format, strict, with the context first and the key nowhere in it', () => {
    const body = chatBody(OPENAI, request(true));
    expect(body).toEqual({
      model: 'gpt-6.1-terra',
      max_completion_tokens: 1000,
      stream: true,
      stream_options: { include_usage: true },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'rigready_answer', strict: true, schema: SCHEMA },
      },
      messages: [
        { role: 'system', content: 'system text' },
        { role: 'user', content: 'big stable context\n\nthe task' },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('asks for JSON in the text when the server takes no schema, and uses max_tokens', () => {
    const body = chatBody(LOCAL, request());
    expect(body).not.toHaveProperty('response_format');
    expect(body['max_tokens']).toBe(1000);
    const user = (body['messages'] as { content: string }[])[1]!.content;
    expect(user).toBe(`big stable context\n\nthe task\n\n${jsonInstruction(SCHEMA)}`);
    expect(user).toContain('"properties":{"a":{"type":"string"}}');
    // A plain question has no schema at all.
    expect(chatBody(LOCAL, request(false, null))['messages']).toEqual([
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'big stable context\n\nthe task' },
    ]);
  });

  it('takes the JSON object out of an answer wrapped in fences or words', () => {
    expect(jsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(jsonText('Here it is: {"a":{"b":2}} Hope it helps.')).toBe('{"a":{"b":2}}');
    expect(jsonText('no json')).toBe('no json');
  });
});

describe('a whole answer', () => {
  it('sends the key only as a Bearer header, never follows a redirect, and reads text and usage', async () => {
    const http = new FakeHttp();
    http.respond(
      'api.openai.com/v1/chat/completions',
      chatAnswer('hello', {
        usage: { prompt_tokens: 1000, completion_tokens: 200, cached: 800 },
      })
    );
    const answer = await sendChat(http, OPENAI, KEY, chatBody(OPENAI, request()));
    expect(answer).toMatchObject({ ok: true, value: { text: 'hello', model: 'gpt-6.1-terra' } });
    const call = http.calls[0]!;
    expect(call).toMatchObject({
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      noRedirects: true,
    });
    expect(call.headers).toEqual({
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
    });
    expect(call.body).not.toContain(KEY);
    if (answer.ok) {
      expect(answer.value.usage).toEqual({
        input: 200,
        output: 200,
        cacheWrite: 0,
        cacheRead: 800,
      });
      expect(answer.value.cost).toBeCloseTo((200 * 1 + 800 * 0.05 + 200 * 5) / 1e6, 10);
    }
  });

  it('sends no Authorization header to a local server without a key, and has no price for it', async () => {
    const http = new FakeHttp();
    http.respond('localhost:11434/v1/chat/completions', chatAnswer('hi', { model: 'qwen3:8b' }));
    const answer = await sendChat(http, LOCAL, undefined, chatBody(LOCAL, request()));
    expect(answer.ok && answer.value.cost).toBeNull();
    expect(http.calls[0]!.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('turns every failure into a plain message: 401, 429, quota, 5xx, schema refused, redirect, refusal, cut off, bad JSON, timeout', async () => {
    // The scripted port passes headers through; its shorthand type does not list them.
    type Reply = Parameters<FakeHttp['respond']>[1] & { headers?: Record<string, string> };
    const cases: [Reply, string, RegExp][] = [
      [
        { status: 401, json: { error: { message: `Incorrect API key ${KEY}` } } },
        'ai.key',
        /OpenAI did not accept the API key/,
      ],
      [
        {
          status: 429,
          headers: { 'retry-after': '12' },
          json: { error: { message: 'slow down' } },
        },
        'ai.rateLimited',
        /Try again in 12 seconds/,
      ],
      [
        { status: 429, json: { error: { message: 'no money', code: 'insufficient_quota' } } },
        'ai.quota',
        /no credit left/,
      ],
      [{ status: 503, body: '<html>busy</html>' }, 'ai.unavailable', /busy or down/],
      [
        {
          status: 400,
          json: [
            { error: { message: 'Invalid JSON payload: response_format.json_schema unknown' } },
          ],
        },
        'ai.schemaUnsupported',
        /Ask for JSON/,
      ],
      [{ status: 400, json: { message: 'bad thing' } }, 'ai.request', /refused the request/],
      [
        { status: 404, json: { error: { message: 'model not found' } } },
        'ai.model',
        /does not offer that model/,
      ],
      [
        { status: 302, headers: { location: 'https://evil.example/' }, body: '' },
        'ai.redirect',
        /does not follow it with your key/,
      ],
      [chatAnswer(null, { refusal: 'I cannot help with that.' }), 'ai.refused', /declined/],
      [chatAnswer('{"a":', { finishReason: 'length' }), 'ai.truncated', /cut off/],
      [chatAnswer('x', { finishReason: 'content_filter' }), 'ai.refused', /declined/],
      [{ body: 'not json at all' }, 'ai.malformed', /could not read/],
      [{ json: { choices: [] } }, 'ai.malformed', /could not read/],
    ];
    for (const [response, code, message] of cases) {
      const http = new FakeHttp();
      http.respond('/chat/completions', response);
      const answer = await sendChat(http, OPENAI, KEY, chatBody(OPENAI, request()));
      expect(answer.ok, code).toBe(false);
      if (!answer.ok) {
        expect(answer.error.code, code).toBe(code);
        expect(answer.error.message, code).toMatch(message);
        expect(JSON.stringify(answer), code).not.toContain(KEY);
      }
    }
    const down = new FakeHttp();
    down.scripts.push({ match: { url: '/chat' }, error: 'boom' });
    const unreachable = await sendChat(down, LOCAL, undefined, chatBody(LOCAL, request()));
    expect(!unreachable.ok && unreachable.error).toMatchObject({
      code: 'ai.network',
      message:
        'Could not reach the server at localhost:11434. Check the address and the connection.',
    });
    const slow = new FakeHttp();
    slow.request = async () => ({ ok: false, error: { code: 'http.timeout', message: 'slow' } });
    const timedOut = await sendChat(slow, OPENAI, KEY, chatBody(OPENAI, request()));
    expect(!timedOut.ok && timedOut.error.code).toBe('ai.timeout');
  });
});

describe('a streamed answer', () => {
  const TEXT = '{"summary":"Größe ✈ 日本語","items":[{"actionId":"a"},{"actionId":"b"}]}';

  async function run(
    response: Parameters<FakeHttp['respond']>[1],
    target: ChatTarget = OPENAI,
    signal?: AbortSignal
  ) {
    const http = new FakeHttp();
    http.respond('/chat/completions', response);
    const updates: StreamUpdate[] = [];
    const answer = await streamChat(http, target, KEY, chatBody(target, request(true)), {
      onUpdate: (u) => updates.push(u),
      idleTimeoutMs: 200,
      ...(signal ? { signal } : {}),
    });
    return { answer, updates, http };
  }

  it('puts the answer together from content deltas, cut anywhere, with the usage chunk at the end', async () => {
    const { answer, updates, http } = await run(
      chatStream(TEXT, {
        pieceChars: 7,
        chunkBytes: 5,
        usage: { prompt_tokens: 900, completion_tokens: 80, cached: 500 },
      })
    );
    expect(answer).toMatchObject({ ok: true, value: { text: TEXT, model: 'gpt-6.1-terra' } });
    expect(answer.ok && answer.value.usage).toEqual({
      input: 400,
      output: 80,
      cacheWrite: 0,
      cacheRead: 500,
    });
    expect(updates[0]).toEqual({ kind: 'started' });
    const last = updates.at(-1)!;
    expect(last.kind === 'text' && last.chars).toBe(TEXT.length);
    expect(http.calls[0]!.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      accept: 'text/event-stream',
    });
  });

  it('ignores comment lines, and takes a server that sends no usage and no [DONE] but a finish_reason', async () => {
    const { answer } = await run({
      stream: {
        chunks: [': OPENROUTER PROCESSING\n\n', ...chatEvents('{"a":"b"}', { withoutDone: true })],
      },
    });
    expect(answer).toMatchObject({
      ok: true,
      value: { text: '{"a":"b"}', usage: { input: 0, output: 0 } },
    });
  });

  it('reads a server that ignored "stream" and answered in one piece', async () => {
    const { answer, updates } = await run(chatAnswer('whole'), LOCAL);
    expect(answer).toMatchObject({ ok: true, value: { text: 'whole' } });
    expect(updates).toEqual([{ kind: 'started' }]);
  });

  it('uses nothing from a stream that ends early, is cut off, sends an error chunk, or is not JSON', async () => {
    const early = await run(chatStream(TEXT, { finishReason: null, withoutDone: true }));
    expect(!early.answer.ok && early.answer.error.code).toBe('ai.incomplete');
    const cut = await run(chatStream(TEXT, { finishReason: 'length' }));
    expect(!cut.answer.ok && cut.answer.error.code).toBe('ai.truncated');
    const failing = await run({
      stream: {
        chunks: [
          ...chatEvents('{"a"', { finishReason: null, withoutDone: true }),
          {
            data: {
              error: { code: 429, message: `slow ${KEY}` },
              choices: [{ finish_reason: 'error' }],
            },
          },
        ],
      },
    });
    expect(!failing.answer.ok && failing.answer.error.code).toBe('ai.rateLimited');
    expect(JSON.stringify(failing.answer)).not.toContain(KEY);
    const garbage = await run({ stream: { chunks: [{ data: 'not an object' }] } });
    expect(!garbage.answer.ok && garbage.answer.error.code).toBe('ai.malformed');
  });

  it('keeps the plain messages for a status before the stream: 401 and 429', async () => {
    const denied = await run({ status: 401, json: { error: { message: 'bad key' } } });
    expect(!denied.answer.ok && denied.answer.error.code).toBe('ai.key');
    const limited = await run({ status: 429, json: { error: { message: 'slow' } } });
    expect(!limited.answer.ok && limited.answer.error.code).toBe('ai.rateLimited');
  });

  it('says so when the stream stalls, breaks, or is cancelled', async () => {
    const stalled = await run(
      chatStream(TEXT, { finishReason: null, withoutDone: true, end: 'stall' })
    );
    expect(!stalled.answer.ok && stalled.answer.error.code).toBe('ai.stalled');
    const broken = await run(
      chatStream(TEXT, { finishReason: null, withoutDone: true, end: 'reset' })
    );
    expect(!broken.answer.ok && broken.answer.error.code).toBe('ai.interrupted');
    const gone = new AbortController();
    gone.abort();
    const cancelled = await run(chatStream(TEXT), OPENAI, gone.signal);
    expect(!cancelled.answer.ok && cancelled.answer.error.code).toBe('ai.cancelled');
  });
});

describe('"Test" and the providers', () => {
  it('checks OpenAI with the free model description, and other servers with the smallest request', async () => {
    const http = new FakeHttp();
    http.respond('/v1/models/gpt-6.1-terra', { json: { id: 'gpt-6.1-terra' } });
    expect(await testChat(http, OPENAI, KEY, 'gpt-6.1-terra', true)).toEqual({
      ok: true,
      value: { valid: true, model: 'gpt-6.1-terra' },
    });
    expect(http.calls[0]).toMatchObject({ method: 'GET', noRedirects: true });

    const local = new FakeHttp();
    local.respond('localhost:11434/v1/chat/completions', chatAnswer('OK'));
    expect((await testChat(local, LOCAL, undefined, 'qwen3:8b', false)).ok).toBe(true);
    expect(JSON.parse(local.calls[0]!.body!)).toEqual({
      model: 'qwen3:8b',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the word OK.' }],
    });

    const denied = new FakeHttp();
    denied.respond('/models/', { status: 401, json: {} });
    expect(await testChat(denied, OPENAI, KEY, 'gpt-6.1-terra', true)).toEqual({
      ok: true,
      value: { valid: false, reason: 'OpenAI did not accept this key.' },
    });
  });

  it('accepts https anywhere and plain http only to this PC, and never a key in the address', () => {
    expect(checkBaseUrl('https://openrouter.ai/api/v1/')).toEqual({
      ok: true,
      value: 'https://openrouter.ai/api/v1',
    });
    expect(checkBaseUrl('http://localhost:11434/v1')).toEqual({
      ok: true,
      value: 'http://localhost:11434/v1',
    });
    expect(checkBaseUrl('http://127.0.0.1:1234/v1').ok).toBe(true);
    expect(checkBaseUrl('http://[::1]:8080/v1').ok).toBe(true);
    for (const bad of [
      'http://api.example.com/v1',
      'http://192.168.1.20:11434/v1',
      'ftp://example.com',
      'https://user:pass@example.com/v1',
      'https://example.com/v1?key=abc',
      'not a url',
      '',
    ]) {
      expect(checkBaseUrl(bad).ok, bad).toBe(false);
    }
  });

  it('builds each provider for one host, and says what is missing', () => {
    const anthropic = providerFor(settings({}));
    expect(anthropic.ok && [anthropic.value.host, anthropic.value.label]).toEqual([
      'api.anthropic.com',
      'Anthropic',
    ]);
    const openai = providerFor(settings({ provider: 'openai' }));
    expect(openai.ok && [openai.value.host, openai.value.model]).toEqual([
      'api.openai.com',
      'gpt-6.1-terra',
    ]);
    const gemini = providerFor(
      settings({
        provider: 'compatible',
        compatible: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3.6-flash',
          structured: 'schema',
        },
      })
    );
    expect(gemini.ok && [gemini.value.host, gemini.value.keyNeeded, gemini.value.local]).toEqual([
      'generativelanguage.googleapis.com',
      true,
      false,
    ]);
    const ollama = providerFor(
      settings({
        provider: 'compatible',
        compatible: {
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3:8b',
          structured: 'prompt',
        },
      })
    );
    expect(ollama.ok && [ollama.value.keyNeeded, ollama.value.local, ollama.value.label]).toEqual([
      false,
      true,
      'the server at localhost:11434',
    ]);
    expect(providerFor(settings({ provider: 'compatible' }))).toMatchObject({
      ok: false,
      error: { code: 'ai.baseUrl' },
    });
    expect(
      providerFor(
        settings({
          provider: 'compatible',
          compatible: { baseUrl: 'http://localhost:1234/v1', model: '', structured: 'schema' },
        })
      )
    ).toMatchObject({ ok: false, error: { code: 'ai.model' } });
  });
});
