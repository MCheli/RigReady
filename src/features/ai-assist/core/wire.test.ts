import { describe, expect, it } from 'vitest';
import type { Http, HttpStreamRequest } from '../../../core/ports';
import { err, ok } from '../../../core/result';
import { requestBody, sendTurn, type Message, type Wire } from './wire';

/**
 * The built-in assistant's conversation over both wires: Anthropic's Messages API and the
 * Chat Completions of OpenAI and every OpenAI-compatible server (a local one here).
 */

const tools = [
  {
    name: 'programs_find',
    description: 'Finds where programs are installed.',
    schema: { type: 'object', properties: { names: { type: 'array' } } },
  },
];

const conversation: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Find TrackIR' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Looking.' },
      { type: 'tool_use', id: 'call_1', name: 'programs_find', input: { names: ['TrackIR'] } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'call_1', content: '{"programs":[]}' },
      { type: 'text', text: 'And SRS?' },
    ],
  },
];

type Recorded = Http & { calls: HttpStreamRequest[] };

/**
 * A provider that answers `json`: a 200 arrives in two pieces through `onChunk`, as the port
 * says it does, and any other status comes whole in the result.
 */
function fakeHttp(json: unknown, status = 200): Recorded {
  const calls: HttpStreamRequest[] = [];
  return {
    calls,
    // The assistant reads its answer as it arrives, so that Stop ends the wait: never this.
    request: async () => ok({ status: 500, headers: {}, body: '' }),
    stream: async (request: HttpStreamRequest, onChunk: (bytes: Uint8Array) => void) => {
      calls.push(request);
      if (request.signal?.aborted) return err('http.cancelled', 'The request was cancelled.');
      const text = JSON.stringify(json);
      if (status !== 200) return ok({ status, headers: {}, body: text });
      const bytes = new TextEncoder().encode(text);
      const half = Math.ceil(bytes.length / 2);
      onChunk(bytes.subarray(0, half));
      onChunk(bytes.subarray(half));
      return ok({ status, headers: {}, body: '' });
    },
  } as unknown as Recorded;
}

const local: Wire = { kind: 'chat', root: 'http://localhost:11434/v1', model: 'qwen3:8b' };

describe('ASSIST-005 the assistant speaks to the provider chosen in Settings', () => {
  it('turns the conversation into Chat Completions: system first, functions, tool calls and tool messages', () => {
    const body = requestBody(local, 'Be brief.', tools, conversation, 800) as {
      messages: Record<string, unknown>[];
      tools: { type: string; function: { name: string } }[];
      max_tokens: number;
    };
    expect(body.max_tokens).toBe(800);
    expect(body.tools[0]).toMatchObject({ type: 'function', function: { name: 'programs_find' } });
    expect(body.messages.map((m) => m['role'])).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'user',
    ]);
    expect(body.messages[2]).toMatchObject({
      content: 'Looking.',
      tool_calls: [
        { id: 'call_1', function: { name: 'programs_find', arguments: '{"names":["TrackIR"]}' } },
      ],
    });
    expect(body.messages[3]).toMatchObject({ tool_call_id: 'call_1', content: '{"programs":[]}' });
    const openai = requestBody(
      { ...local, tokenField: 'max_completion_tokens' },
      's',
      tools,
      [],
      9
    );
    expect(openai).toHaveProperty('max_completion_tokens', 9);
  });

  it('reads tool calls from a local server, which needs no key, at its own address only', async () => {
    const http = fakeHttp({
      model: 'qwen3:8b',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'programs_find', arguments: '{"names":["SRS"]}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 12 },
    });
    const body = requestBody(local, 's', tools, conversation, 100);
    const answer = await sendTurn(http, local, undefined, body, 'the server at localhost:11434');
    expect(answer.ok && answer.value.stopReason).toBe('tool_use');
    expect(answer.ok && answer.value.blocks).toEqual([
      { type: 'tool_use', id: 'call_2', name: 'programs_find', input: { names: ['SRS'] } },
    ]);
    expect(http.calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(http.calls[0]!.headers).not.toHaveProperty('authorization');
  });

  it('sends a key only in the header, and the Anthropic wire to api.anthropic.com', async () => {
    const http = fakeHttp({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Done.' }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const wire: Wire = { kind: 'anthropic', root: 'https://api.anthropic.com/v1', model: 'm' };
    const body = requestBody(wire, 's', tools, conversation, 100);
    const key = 'sk-ant-unit-NOT-A-REAL-KEY-1234';
    const answer = await sendTurn(http, wire, key, body, 'Anthropic');
    expect(answer.ok && answer.value.blocks).toEqual([{ type: 'text', text: 'Done.' }]);
    expect(http.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(http.calls[0]!.headers!['x-api-key']).toBe(key);
    expect(http.calls[0]!.body).not.toContain(key);

    const chat = fakeHttp({ choices: [{ finish_reason: 'stop', message: { content: 'Hi' } }] });
    const openai: Wire = { kind: 'chat', root: 'https://api.openai.com/v1', model: 'g' };
    await sendTurn(chat, openai, 'sk-unit-NOT-REAL', requestBody(openai, 's', [], [], 5), 'OpenAI');
    expect(chat.calls[0]!.headers!['authorization']).toBe('Bearer sk-unit-NOT-REAL');
    expect(chat.calls[0]!.body).not.toContain('sk-unit-NOT-REAL');
  });

  it('a refusal and an unreadable answer are errors, never an empty success', async () => {
    const refused = await sendTurn(
      fakeHttp({ choices: [{ finish_reason: 'stop', message: { refusal: 'No.' } }] }),
      local,
      undefined,
      {},
      'x'
    );
    expect(!refused.ok && refused.error.code).toBe('ai.refused');
    const junk = await sendTurn(fakeHttp({ nothing: true }), local, undefined, {}, 'x');
    expect(!junk.ok && junk.error.code).toBe('ai.malformed');
  });

  it('never follows a redirect: the key goes to the host the preview named and nowhere else', async () => {
    const answer = { choices: [{ finish_reason: 'stop', message: { content: 'Hi' } }] };
    const chat = fakeHttp(answer);
    await sendTurn(chat, local, 'k', requestBody(local, 's', [], [], 5), 'x');
    expect(chat.calls[0]!.noRedirects).toBe(true);

    const wire: Wire = { kind: 'anthropic', root: 'https://api.anthropic.com/v1', model: 'm' };
    const moved = fakeHttp({}, 302);
    const key = 'sk-ant-unit-NOT-A-REAL-KEY-1234';
    const sent = await sendTurn(moved, wire, key, requestBody(wire, 's', [], [], 5), 'Anthropic');
    expect(moved.calls).toHaveLength(1);
    expect(moved.calls[0]!.noRedirects).toBe(true);
    // The redirect is the answer, and it is a failure.
    expect(sent.ok).toBe(false);
  });
});

describe('what a request of the assistant costs to read (Anthropic)', () => {
  const wire: Wire = { kind: 'anthropic', root: 'https://api.anthropic.com/v1', model: 'm' };
  type Marked = { cache_control?: unknown };
  type Body = {
    system: Marked[];
    messages: { role: string; content: Marked[] }[];
  };
  const marks = (body: Body): number =>
    body.system.filter((b) => b.cache_control).length +
    body.messages.flatMap((m) => m.content).filter((b) => b.cache_control).length;

  it('marks the instructions and the end of the conversation, so the next request reads both from the cache', () => {
    const body = requestBody(wire, 'Be brief.', tools, conversation, 800) as unknown as Body;
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    const last = body.messages.at(-1)!;
    expect(last.content.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
    // Two breakpoints and no more: the API allows four.
    expect(marks(body)).toBe(2);
  });

  it('moves the mark with the conversation and never leaves one behind in it', () => {
    const before = JSON.stringify(conversation);
    requestBody(wire, 's', tools, conversation, 800);
    // The conversation itself is untouched: a mark kept in it would add up over the rounds.
    expect(JSON.stringify(conversation)).toBe(before);

    const longer: Message[] = [
      ...conversation,
      { role: 'assistant', content: [{ type: 'text', text: 'SRS is not installed.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Thanks.' }] },
    ];
    const body = requestBody(wire, 's', tools, longer, 800) as unknown as Body;
    expect(marks(body)).toBe(2);
    expect(body.messages.at(-1)!.content.at(-1)!.cache_control).toBeDefined();
    expect(body.messages[2]!.content.every((b) => !b.cache_control)).toBe(true);
    // Everything before the mark is the same text as in the request before: a cache prefix.
    const first = requestBody(wire, 's', tools, conversation, 800) as unknown as Body;
    const strip = (m: Body['messages'][number]) =>
      JSON.stringify(m.content.map((b) => ({ ...b, cache_control: undefined })));
    expect(body.messages.slice(0, 3).map(strip)).toEqual(first.messages.map(strip));
  });

  it('puts no mark on the chat wire, which has no such field', () => {
    const body = requestBody(local, 's', tools, conversation, 800);
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });
});

describe('stopping and failing', () => {
  const wire: Wire = { kind: 'anthropic', root: 'https://api.anthropic.com/v1', model: 'm' };

  it('Stop ends the wait at once and says nothing was changed', async () => {
    const http = fakeHttp({ content: [] });
    const stop = new AbortController();
    stop.abort();
    const answer = await sendTurn(http, wire, 'k', {}, 'Anthropic', stop.signal);
    expect(http.calls[0]!.signal).toBe(stop.signal);
    expect(!answer.ok && answer.error.code).toBe('ai.stopped');
    expect(!answer.ok && answer.error.message).toMatch(/Nothing was changed/);
  });

  it('says in words what the provider refused, without the key', async () => {
    const key = 'sk-ant-unit-NOT-A-REAL-KEY-1234';
    const unauthorized = await sendTurn(
      fakeHttp(
        { type: 'error', error: { type: 'authentication_error', message: `bad key ${key}` } },
        401
      ),
      wire,
      key,
      {},
      'Anthropic'
    );
    expect(unauthorized.ok).toBe(false);
    expect(JSON.stringify(unauthorized)).not.toContain(key);

    const limited = await sendTurn(fakeHttp({}, 429), local, undefined, {}, 'the server');
    expect(!limited.ok && limited.error.code).toBe('ai.rateLimited');
    const denied = await sendTurn(fakeHttp({}, 401), local, 'k', {}, 'the server');
    expect(!denied.ok && denied.error.code).toBe('ai.key');
    const other = await sendTurn(fakeHttp({}, 500), local, undefined, {}, 'the server');
    expect(!other.ok && other.error.message).toBe('the server refused the request (HTTP 500).');
  });

  it('a silence and a lost connection are told apart', async () => {
    const failing = (code: string): Http =>
      ({
        request: async () => err(code, 'x'),
        stream: async () => err(code, 'x'),
      }) as unknown as Http;
    const idle = await sendTurn(failing('http.idle'), local, undefined, {}, 'the server');
    expect(!idle.ok && idle.error.code).toBe('ai.timeout');
    const late = await sendTurn(failing('http.timeout'), local, undefined, {}, 'the server');
    expect(!late.ok && late.error.code).toBe('ai.timeout');
    const gone = await sendTurn(failing('http.network'), local, undefined, {}, 'the server');
    expect(!gone.ok && gone.error.code).toBe('ai.network');
  });
});
