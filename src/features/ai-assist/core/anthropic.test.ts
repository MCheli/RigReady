import { afterEach, describe, expect, it } from 'vitest';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  approximateCost,
  FALLBACK_BETA,
  MAX_RESPONSE_BYTES,
  messageBody,
  scrub,
  sendMessage,
  testKey,
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
