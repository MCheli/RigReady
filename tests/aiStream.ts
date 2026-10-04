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
