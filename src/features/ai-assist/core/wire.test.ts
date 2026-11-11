import { describe, expect, it } from 'vitest';
import type { Http, HttpRequest } from '../../../core/ports';
import { ok } from '../../../core/result';
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

function fakeHttp(json: unknown): Http & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    request: async (request: HttpRequest) => {
      calls.push(request);
      return ok({ status: 200, headers: {}, body: JSON.stringify(json) });
    },
    stream: async () => ok({ status: 500, headers: {}, body: '' }),
  } as unknown as Http & { calls: HttpRequest[] };
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
});
