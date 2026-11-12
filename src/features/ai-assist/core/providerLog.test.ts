import { describe, expect, it } from 'vitest';
import { scenarioRig } from '../../../../tests/helpers';
import { createLogger, parseLog, type LogEntry } from '../../../core/logger';
import type { Http, HttpRequest, HttpResponse, HttpStreamRequest } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { AI_KEY_SECRET } from '../../../core/settings';
import { discoverFeatures, wireFeatures } from '../../../main/bootstrap';
import type { TurnOutcome, TurnPreview } from './assistantModel';
import { loggedHttp } from './providerLog';

/**
 * What a failed request to an AI provider leaves in the log, and what it never does. The
 * first half is the wrapper on its own; the second is the whole wired app writing a real
 * log line through the real logger, read back as text.
 */

const KEY = 'sk-ant-unit-NOT-A-REAL-KEY-0000-abcd';
const QUESTION = 'Is TrackIR a required step for launching the Hornet?';
const ANSWER = 'The Hornet setup lists TrackIR as required.';

type Line = { level: string; message: string; data?: Record<string, unknown> };

function capture(): { lines: Line[]; log: Parameters<typeof loggedHttp>[1] } {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (message: string, data?: unknown): void => {
      lines.push({ level, message, ...(data ? { data: data as Record<string, unknown> } : {}) });
    };
  const log = {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: () => log,
  };
  return { lines, log };
}

/** An Http that answers every request with the same result. */
function answering(result: Result<HttpResponse>): Http {
  return {
    request: async () => result,
    stream: async () => result,
  };
}

const post = (body: unknown, headers: Record<string, string> = {}): HttpRequest => ({
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages?beta=1',
  headers: { 'x-api-key': KEY, ...headers },
  body: JSON.stringify(body),
});

describe('one line in the log for every request to a provider that fails', () => {
  it('names the provider, the model, the status, what the provider said and its request id', async () => {
    const { lines, log } = capture();
    const http = loggedHttp(
      answering(
        ok({
          status: 401,
          headers: { 'request-id': 'req_011CSHoEeqs5C35K2UUqR7Fy' },
          body: JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'invalid x-api-key' },
            request_id: 'req_from_the_body',
          }),
        })
      ),
      log
    );
    await http.request(post({ model: 'claude-opus-5-5', messages: [{ content: QUESTION }] }));
    expect(lines).toEqual([
      {
        level: 'warn',
        message: 'ai-assist: a request to the AI provider failed',
        data: {
          provider: 'api.anthropic.com',
          path: '/v1/messages',
          model: 'claude-opus-5-5',
          status: 401,
          errorType: 'authentication_error',
          message: 'invalid x-api-key',
          requestId: 'req_011CSHoEeqs5C35K2UUqR7Fy',
        },
      },
    ]);
  });

  it('reads the error code of an OpenAI-style answer, and the request id from either place', async () => {
    const { lines, log } = capture();
    const http = loggedHttp(
      answering(
        ok({
          status: 429,
          headers: { 'x-request-id': 'req_openai_77' },
          body: JSON.stringify({
            error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'No quota.' },
          }),
        })
      ),
      log
    );
    await http.stream(
      {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'gpt-5.2' }),
      } as HttpStreamRequest,
      () => undefined
    );
    expect(lines[0]!.data).toEqual({
      provider: 'api.openai.com',
      path: '/v1/chat/completions',
      model: 'gpt-5.2',
      status: 429,
      errorType: 'insufficient_quota',
      errorCode: 'insufficient_quota',
      message: 'No quota.',
      requestId: 'req_openai_77',
    });

    // No header: the id in the body is the one.
    const second = capture();
    await loggedHttp(
      answering(
        ok({
          status: 500,
          headers: {},
          body: JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: 'Internal.' },
            request_id: 'req_from_the_body',
          }),
        })
      ),
      second.log
    ).request(post({ model: 'claude-opus-5-5' }));
    expect(second.lines[0]!.data).toMatchObject({ status: 500, requestId: 'req_from_the_body' });
  });

  it('names the model of a key test from the address, and says what is known of an answer that is not JSON', async () => {
    const { lines, log } = capture();
    const http = loggedHttp(
      answering(ok({ status: 502, headers: {}, body: '<html>Bad gateway</html>' })),
      log
    );
    await http.request({
      url: 'https://api.anthropic.com/v1/models/claude-opus-5-5',
      headers: { 'x-api-key': KEY },
    });
    expect(lines[0]!.data).toEqual({
      provider: 'api.anthropic.com',
      path: '/v1/models/claude-opus-5-5',
      model: 'claude-opus-5-5',
      status: 502,
    });
  });

  it('logs a request that never got an answer with the reason, and nothing for Stop or a success', async () => {
    const failed = capture();
    await loggedHttp(
      answering(err('http.timeout', 'No answer within 180 seconds.')),
      failed.log
    ).request(post({ model: 'claude-opus-5-5' }));
    expect(failed.lines[0]!.data).toEqual({
      provider: 'api.anthropic.com',
      path: '/v1/messages',
      model: 'claude-opus-5-5',
      failure: 'http.timeout',
      message: 'No answer within 180 seconds.',
    });

    const stopped = capture();
    await loggedHttp(answering(err('http.cancelled', 'Cancelled.')), stopped.log).stream(
      post({ model: 'claude-opus-5-5' }),
      () => undefined
    );
    expect(stopped.lines).toEqual([]);

    const fine = capture();
    await loggedHttp(
      answering(ok({ status: 200, headers: {}, body: JSON.stringify({ content: ANSWER }) })),
      fine.log
    ).request(post({ model: 'claude-opus-5-5' }));
    expect(fine.lines).toEqual([]);
  });

  it('never writes the key, the request or its address query, however the provider answers', async () => {
    const { lines, log } = capture();
    const long = 'x'.repeat(900);
    const http = loggedHttp(
      answering(
        ok({
          status: 400,
          headers: {},
          body: JSON.stringify({
            error: {
              type: 'invalid_request_error',
              // A provider that repeats the key it was given, and goes on at length.
              message: `The key ${KEY} is not allowed here. ${long}`,
            },
          }),
        })
      ),
      log
    );
    await http.request(
      post({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: QUESTION }] })
    );
    const written = JSON.stringify(lines);
    expect(written).not.toContain(KEY);
    expect(written).not.toContain(QUESTION);
    expect(written).not.toContain('beta=1');
    expect(written).not.toContain('x-api-key');
    const message = lines[0]!.data!['message'] as string;
    expect(message.startsWith('The key *** is not allowed here.')).toBe(true);
    expect(message.length).toBeLessThanOrEqual(301);
  });

  it('copes with an address that is not one', async () => {
    const { lines, log } = capture();
    await loggedHttp(answering(err('http.network', 'No route.')), log).request({ url: 'nonsense' });
    expect(lines[0]!.data).toMatchObject({
      provider: 'unknown',
      path: '',
      failure: 'http.network',
    });
  });
});

describe('the log of the wired app: what is in it after the assistant was used, and what is not', () => {
  const MESSAGES = { url: 'api.anthropic.com/v1/messages', method: 'POST' } as const;
  const TOOL_ANSWER_MARK = '"setups"';

  async function running() {
    const rig = await scenarioRig('flying-all-good');
    const written: string[] = [];
    const wiring = wireFeatures({
      features: discoverFeatures(),
      ports: rig.ports,
      // The real logger with the real redactor, into memory instead of the log file.
      log: createLogger({ write: (line) => void written.push(line) }, rig.clock),
      send: () => undefined,
    });
    await rig.ports.secrets.set(AI_KEY_SECRET, KEY);
    const invoke = async <T>(channel: string, input?: unknown): Promise<Result<T>> => {
      const envelope = await wiring.handlers.get(channel)!(input);
      return envelope as Result<T>;
    };
    const entries = (): LogEntry[] =>
      parseLog(written.join('')).filter((entry) => entry.scope === 'ai-assist');
    const close = async (): Promise<void> => {
      for (const feature of wiring.features) await feature.dispose?.();
      await rig.cleanup();
    };
    return { rig, written, invoke, entries, close };
  }

  const message = (content: unknown[], stop: string, usage: Record<string, number>) => ({
    status: 200,
    headers: {},
    json: {
      id: 'msg_unit',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content,
      stop_reason: stop,
      usage,
    },
  });

  it('a refused send and a refused key test each leave one line; a finished question leaves its numbers', async () => {
    const app = await running();
    try {
      const http = app.rig.ports.http;
      // The send is refused once, then the question takes two requests and one tool.
      http.scripts.push({
        match: MESSAGES,
        times: 1,
        response: {
          status: 401,
          headers: { 'request-id': 'req_unit_0001' },
          json: {
            type: 'error',
            error: { type: 'authentication_error', message: 'invalid x-api-key' },
            request_id: 'req_unit_0001',
          },
        },
      });
      http.scripts.push({
        match: MESSAGES,
        times: 1,
        response: message(
          [{ type: 'tool_use', id: 'tu1', name: 'setups_list', input: {} }],
          'tool_use',
          { input_tokens: 40, output_tokens: 60, cache_creation_input_tokens: 3600 }
        ),
      });
      http.scripts.push({
        match: MESSAGES,
        times: 1,
        response: message([{ type: 'text', text: ANSWER }], 'end_turn', {
          input_tokens: 50,
          output_tokens: 90,
          cache_read_input_tokens: 3700,
        }),
      });
      http.scripts.push({
        match: { url: 'api.anthropic.com/v1/models/', method: 'GET' },
        times: 1,
        response: {
          status: 403,
          headers: { 'request-id': 'req_unit_0002' },
          json: {
            type: 'error',
            error: { type: 'permission_error', message: 'This key may not use that model.' },
          },
        },
      });

      const first = await app.invoke<TurnPreview>('ai-assist:assistantPrepare', { text: QUESTION });
      if (!first.ok) throw new Error(first.error.message);
      const refused = await app.invoke<TurnOutcome>('ai-assist:assistantSend', {
        requestId: first.value.requestId,
      });
      expect(refused.ok).toBe(false);
      const one = await app.invoke<TurnOutcome>('ai-assist:assistantSend', {
        requestId: first.value.requestId,
      });
      if (!one.ok) throw new Error(one.error.message);
      const two = await app.invoke<TurnOutcome>('ai-assist:assistantSend', {
        requestId: one.value.next!.requestId,
      });
      expect(two.ok).toBe(true);
      await app.invoke('ai-assist:testKey');

      const dataOf = (entry: LogEntry): Record<string, unknown> =>
        JSON.parse(entry.text.slice(entry.text.indexOf('{'))) as Record<string, unknown>;
      const failures = app
        .entries()
        .filter((entry) => entry.text.includes('a request to the AI provider failed'));
      expect(failures.map((entry) => entry.level)).toEqual(['warn', 'warn']);
      expect(dataOf(failures[0]!)).toEqual({
        provider: 'api.anthropic.com',
        path: '/v1/messages',
        model: 'claude-opus-5-5',
        status: 401,
        errorType: 'authentication_error',
        message: 'invalid x-api-key',
        requestId: 'req_unit_0001',
      });
      // The key test: the model comes from the address, the id from the header.
      expect(dataOf(failures[1]!)).toEqual({
        provider: 'api.anthropic.com',
        path: '/v1/models/claude-opus-5-5',
        model: 'claude-opus-5-5',
        status: 403,
        errorType: 'permission_error',
        message: 'This key may not use that model.',
        requestId: 'req_unit_0002',
      });

      // One line for the question that was finished, with what it took and cost.
      const finished = app
        .entries()
        .filter((entry) => entry.text.includes('the assistant finished a question'));
      expect(finished).toHaveLength(1);
      const numbers = dataOf(finished[0]!);
      expect(numbers).toMatchObject({
        provider: 'api.anthropic.com',
        model: 'claude-opus-5-5',
        ended: 'answered',
        requests: 2,
        toolRounds: 1,
        // Everything the provider read: 90 new, 3,700 from its cache, 3,600 written to it.
        input: 7390,
        cached: 3700,
        written: 3600,
        output: 150,
      });
      expect(numbers['cost']).toBeGreaterThan(0);

      // What never is: the key, the question, what a tool answered, what the assistant said.
      const all = app.written.join('');
      expect(all).not.toContain(KEY);
      expect(all).not.toContain('NOT-A-REAL-KEY');
      expect(all).not.toContain(QUESTION);
      expect(all).not.toContain(ANSWER);
      // The tool did answer something, and it went to the provider; it is not in the log,
      // neither as it is nor as a string inside a line's data.
      const row = one.value.conversation.entries.find((entry) => entry.kind === 'tool');
      const answered = row && row.kind === 'tool' ? row.answer! : '';
      expect(answered).toContain(TOOL_ANSWER_MARK);
      expect(one.value.next!.body).toContain(JSON.stringify(answered).slice(1, -1));
      expect(all).not.toContain(answered);
      expect(all).not.toContain(JSON.stringify(answered).slice(1, -1));
      const ours = app
        .entries()
        .map((entry) => entry.text)
        .join('\n');
      expect(ours).not.toContain(TOOL_ANSWER_MARK);
      expect(ours).not.toContain('TrackIR');
    } finally {
      await app.close();
    }
  });
});
