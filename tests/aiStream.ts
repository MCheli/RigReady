import { HttpStreamScriptSchema, type HttpStreamScript } from '../src/platform/fake/scenario';

/**
 * A Messages API answer as the event stream the API sends for `"stream": true`, for
 * scripting `ports.http` in tests: message_start, an (empty) thinking block, a ping, the
 * text in several text_delta events, message_delta with the stop reason and the final
 * token counts, message_stop.
 */

export interface StreamedMessageOptions {
  model?: string;
  stopReason?: string;
  /** Characters per text_delta. Default 40. */
  pieceChars?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** Leave out message_stop, as when the connection closes early. */
  withoutStop?: boolean;
  /** Passed to the stream script: pacing, re-cutting into byte pieces, how it ends. */
  delayMs?: number;
  chunkBytes?: number;
  end?: HttpStreamScript['end'];
}

export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
}

const event = (type: string, data: Record<string, unknown> = {}): StreamEvent => ({
  event: type,
  data: { type, ...data },
});

/** The events of one streamed message whose only text block holds `text`. */
export function messageEvents(text: string, options: StreamedMessageOptions = {}): StreamEvent[] {
  const usage = options.usage ?? {};
  const size = options.pieceChars ?? 40;
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += size) pieces.push(text.slice(at, at + size));
  return [
    event('message_start', {
      message: {
        id: 'msg_scripted',
        type: 'message',
        role: 'assistant',
        model: options.model ?? 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: usage.input_tokens ?? 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
          output_tokens: 1,
        },
      },
    }),
    event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
    event('content_block_delta', {
      index: 0,
      delta: { type: 'signature_delta', signature: 'c2NyaXB0ZWQ=' },
    }),
    event('content_block_stop', { index: 0 }),
    event('ping'),
    event('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
    ...pieces.map((piece) =>
      event('content_block_delta', { index: 1, delta: { type: 'text_delta', text: piece } })
    ),
    event('content_block_stop', { index: 1 }),
    event('message_delta', {
      delta: { stop_reason: options.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.output_tokens ?? 0 },
    }),
    ...(options.withoutStop ? [] : [event('message_stop')]),
  ];
}

/** `rig.ports.http.respond(url, streamedMessage('...'))`. */
export function streamedMessage(
  text: string,
  options: StreamedMessageOptions = {}
): { stream: HttpStreamScript } {
  return { stream: streamOf(messageEvents(text, options), options) };
}

/** A stream script from any events (or raw text chunks). */
export function streamOf(
  chunks: (StreamEvent | string)[],
  options: Pick<StreamedMessageOptions, 'delayMs' | 'chunkBytes' | 'end'> = {}
): HttpStreamScript {
  return HttpStreamScriptSchema.parse({
    chunks,
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
    ...(options.chunkBytes === undefined ? {} : { chunkBytes: options.chunkBytes }),
    ...(options.end === undefined ? {} : { end: options.end }),
  });
}

export interface ChatStreamOptions {
  model?: string;
  /** null: no chunk with a finish_reason, as when the connection closes early. */
  finishReason?: string | null;
  /** Characters per chunk. Default 40. */
  pieceChars?: number;
  /** The token counts, sent as a last chunk with no choices (stream_options.include_usage). */
  usage?: { prompt_tokens: number; completion_tokens: number; cached?: number };
  /** Leave out `data: [DONE]`. */
  withoutDone?: boolean;
  delayMs?: number;
  chunkBytes?: number;
  end?: HttpStreamScript['end'];
}

/**
 * A Chat Completions answer as OpenAI-compatible servers stream it: `data:` events only,
 * a role chunk, the text in content deltas, a chunk with finish_reason, optionally a
 * usage chunk with no choices, then `data: [DONE]`.
 */
export function chatEvents(
  text: string,
  options: ChatStreamOptions = {}
): ({ data: unknown } | string)[] {
  const model = options.model ?? 'gpt-6.1-terra';
  const size = options.pieceChars ?? 40;
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    data: {
      id: 'chatcmpl-scripted',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    },
  });
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += size) pieces.push(text.slice(at, at + size));
  const usage = options.usage;
  return [
    chunk({ role: 'assistant', content: '' }),
    ...pieces.map((piece) => chunk({ content: piece })),
    ...(options.finishReason === null ? [] : [chunk({}, options.finishReason ?? 'stop')]),
    ...(usage
      ? [
          {
            data: {
              id: 'chatcmpl-scripted',
              object: 'chat.completion.chunk',
              model,
              choices: [],
              usage: {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.prompt_tokens + usage.completion_tokens,
                prompt_tokens_details: { cached_tokens: usage.cached ?? 0 },
              },
            },
          },
        ]
      : []),
    // Not JSON, so written as raw text.
    ...(options.withoutDone ? [] : ['data: [DONE]\n\n']),
  ];
}

/** `rig.ports.http.respond(url, chatStream('...'))`. */
export function chatStream(
  text: string,
  options: ChatStreamOptions = {}
): { stream: HttpStreamScript } {
  return {
    stream: HttpStreamScriptSchema.parse({
      chunks: chatEvents(text, options),
      ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
      ...(options.chunkBytes === undefined ? {} : { chunkBytes: options.chunkBytes }),
      ...(options.end === undefined ? {} : { end: options.end }),
    }),
  };
}

/** A whole (not streamed) Chat Completions answer, as `respond(url, chatAnswer('...'))` takes it. */
export function chatAnswer(
  text: string | null,
  options: {
    model?: string;
    finishReason?: string;
    refusal?: string;
    usage?: ChatStreamOptions['usage'];
  } = {}
): { json: unknown } {
  const usage = options.usage ?? { prompt_tokens: 120, completion_tokens: 30 };
  return {
    json: {
      id: 'chatcmpl-scripted',
      object: 'chat.completion',
      model: options.model ?? 'gpt-6.1-terra',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text, refusal: options.refusal ?? null },
          finish_reason: options.finishReason ?? 'stop',
        },
      ],
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        prompt_tokens_details: { cached_tokens: usage.cached ?? 0 },
      },
    },
  };
}
