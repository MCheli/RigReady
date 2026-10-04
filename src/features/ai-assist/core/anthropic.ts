import { z } from 'zod';
import type { Http } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { SseDecoder, type SseEvent } from './sse';

/**
 * The Anthropic Messages API, over the Http port (never fetch directly), so tests and
 * scenario runs answer from scripts. Long answers (a plan, a guide) are streamed, so the
 * user sees them arrive and can cancel; short ones (a question) come back in one piece.
 * Either way the answer is only used once it is complete. The key is only ever placed in
 * the x-api-key header and is scrubbed from anything that is returned.
 */

export const API_ROOT = 'https://api.anthropic.com/v1';
export const API_VERSION = '2023-06-01';
/** Server-side fallback on a refusal ("default" routing). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface ModelInfo {
  id: string;
  name: string;
  /** US dollars per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
}

/** The models offered in the settings; the first is the default. Prices as published in 2026. */
export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2 },
];
export const DEFAULT_MODEL = MODELS[0]!.id;

export const modelInfo = (id: string): ModelInfo => MODELS.find((m) => m.id === id) ?? MODELS[0]!;

export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** Approximate cost in US dollars: cache writes cost 1.25x input, reads the cache price. */
export function approximateCost(model: string, usage: Usage): number {
  const m = modelInfo(model);
  const dollars =
    usage.input * m.input +
    usage.cacheWrite * m.input * 1.25 +
    usage.cacheRead * m.cacheRead +
    usage.output * m.output;
  return dollars / 1_000_000;
}

/** Roughly four characters per token; for showing size before a request is sent. */
export const approximateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface MessageRequest {
  model: string;
  system: string;
  /** Large, stable context (the aircraft's action list): cached between requests. */
  context: string;
  /** What is asked this time. */
  task: string;
  /** JSON schema the answer must follow (structured output); plain text when absent. */
  schema?: Record<string, unknown>;
  maxTokens: number;
  /** Ask for the answer as a stream of events (`streamMessage`) instead of one document. */
  stream?: boolean;
}

/** The exact JSON body sent to the Messages API. */
export function messageBody(request: MessageRequest): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    ...(request.stream ? { stream: true } : {}),
    output_config: {
      effort: 'medium',
      ...(request.schema ? { format: { type: 'json_schema', schema: request.schema } } : {}),
    },
    fallbacks: 'default',
    system: [{ type: 'text', text: request.system }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: request.context, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: request.task },
        ],
      },
    ],
  };
}

function headers(key: string, beta: boolean): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': API_VERSION,
    ...(beta ? { 'anthropic-beta': FALLBACK_BETA } : {}),
  };
}

/** Largest answer accepted; anything bigger is refused before it is parsed. */
export const MAX_RESPONSE_BYTES = 1_000_000;

const ResponseSchema = z.object({
  model: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  stop_details: z
    .object({
      category: z.string().nullable().optional(),
      explanation: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().nullable().optional(),
      cache_read_input_tokens: z.number().nullable().optional(),
    })
    .optional(),
});

const ErrorSchema = z.object({
  error: z.object({ type: z.string().optional(), message: z.string().optional() }),
});

export interface MessageAnswer {
  text: string;
  model: string;
  usage: Usage;
  cost: number;
}

/** Removes the key from text that may be shown or logged, whatever the server echoed. */
export function scrub(text: string, key: string): string {
  if (key.length < 8) return text;
  return text.split(key).join('[key]');
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

function apiError(status: number, body: string, retryAfter: string | undefined): Result<never> {
  const parsed = ErrorSchema.safeParse(safeJson(body));
  const said = parsed.success ? clip(parsed.data.error.message ?? '', 300) : '';
  const detail = said ? `Anthropic said: ${said}` : `HTTP ${status}`;
  if (status === 401) {
    return err('ai.key', 'Anthropic did not accept the API key. Check it in Settings.', detail);
  }
  if (status === 403) {
    return err('ai.forbidden', 'This API key is not allowed to use that model.', detail);
  }
  if (status === 404) {
    return err(
      'ai.model',
      'That model is not available to this API key. Pick another in Settings.',
      detail
    );
  }
  if (status === 413) {
    return err('ai.tooLarge', 'The request was too large for the API.', detail);
  }
  if (status === 429) {
    const seconds = Number.parseInt(retryAfter ?? '', 10);
    return err(
      'ai.rateLimited',
      Number.isFinite(seconds)
        ? `Anthropic is limiting requests from this key. Try again in ${seconds} seconds.`
        : 'Anthropic is limiting requests from this key. Try again in a minute.',
      detail
    );
  }
  if (status === 529 || status >= 500) {
    return err(
      'ai.unavailable',
      'The Anthropic API is busy or down right now. Try again in a few minutes.',
      detail
    );
  }
  return err('ai.request', 'The Anthropic API refused the request.', detail);
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    // Not JSON: the caller reports the status and the raw body instead.
    return undefined;
  }
}

/** Sends one prepared body. Nothing is retried automatically; every failure is a plain message. */
export async function sendMessage(
  http: Http,
  key: string,
  body: Record<string, unknown>,
  timeoutMs = 180_000
): Promise<Result<MessageAnswer>> {
  const result = await sendRaw(http, key, body, timeoutMs);
  if (result.ok) return result;
  return err(
    result.error.code,
    scrub(result.error.message, key),
    result.error.detail === undefined ? undefined : scrub(result.error.detail, key)
  );
}

async function sendRaw(
  http: Http,
  key: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<Result<MessageAnswer>> {
  const response = await http.request({
    method: 'POST',
    url: `${API_ROOT}/messages`,
    headers: headers(key, 'fallbacks' in body),
    body: JSON.stringify(body),
    timeoutMs,
  });
  if (!response.ok) {
    return err(
      response.error.code === 'http.timeout' ? 'ai.timeout' : 'ai.network',
      response.error.code === 'http.timeout'
        ? 'The Anthropic API did not answer in time. Try again.'
        : 'Could not reach the Anthropic API. Check the internet connection.',
      response.error.detail ?? response.error.message
    );
  }
  const { status, body: text } = response.value;
  if (text.length > MAX_RESPONSE_BYTES) {
    return err(
      'ai.oversized',
      'The answer was far larger than expected, so RigReady did not read it.'
    );
  }
  if (status !== 200) return apiError(status, text, response.value.headers['retry-after']);
  const parsed = ResponseSchema.safeParse(safeJson(text));
  if (!parsed.success) {
    return err('ai.malformed', 'The Anthropic API sent an answer RigReady could not read.');
  }
  const message = parsed.data;
  return complete({
    model: message.model ?? String(body.model),
    stopReason: message.stop_reason ?? undefined,
    refusal: message.stop_details?.explanation ?? undefined,
    text: message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join(''),
    usage: {
      input: message.usage?.input_tokens ?? 0,
      output: message.usage?.output_tokens ?? 0,
      cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
      cacheRead: message.usage?.cache_read_input_tokens ?? 0,
    },
  });
}

interface CompleteMessage {
  model: string;
  stopReason: string | undefined;
  /** Why the model declined, when it did. */
  refusal: string | undefined;
  text: string;
  usage: Usage;
}

/** The checks every complete message passes, however it arrived. */
function complete(message: CompleteMessage): Result<MessageAnswer> {
  if (message.stopReason === 'refusal') {
    return err(
      'ai.refused',
      'The model declined to answer this request.',
      message.refusal ? clip(message.refusal, 300) : undefined
    );
  }
  if (message.stopReason === 'max_tokens') {
    return err(
      'ai.truncated',
      'The answer was cut off before it was complete, so nothing from it was used. Try again.'
    );
  }
  const { text, model, usage } = message;
  return ok({ text, model, usage, cost: approximateCost(model, usage) });
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** Longest silence accepted from a stream. The API sends pings while the model works. */
export const STREAM_IDLE_MS = 90_000;
/** No single answer may take longer than this, however steadily it arrives. */
export const STREAM_TOTAL_MS = 15 * 60_000;

/** What a stream reports while it runs. Nothing here is the answer; that comes at the end. */
export type StreamUpdate =
  /** The API accepted the request and the model started working. */
  | { kind: 'started' }
  /** More of the answer's text arrived: this piece, and the characters received so far. */
  | { kind: 'text'; delta: string; chars: number };

export interface StreamOptions {
  onUpdate?: (update: StreamUpdate) => void;
  /** Aborting it stops the request; the result is `ai.cancelled`. */
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  timeoutMs?: number;
}

const TokenCounts = z.looseObject({
  input_tokens: z.number().nullable().optional(),
  output_tokens: z.number().nullable().optional(),
  cache_creation_input_tokens: z.number().nullable().optional(),
  cache_read_input_tokens: z.number().nullable().optional(),
});

/** One event of a streamed message. Fields this code does not use are ignored, not refused. */
const StreamEventSchema = z.looseObject({
  type: z.string(),
  message: z
    .looseObject({ model: z.string().optional(), usage: TokenCounts.optional() })
    .optional(),
  content_block: z
    .looseObject({
      type: z.string(),
      text: z.string().optional(),
      to: z.looseObject({ model: z.string().optional() }).optional(),
    })
    .optional(),
  delta: z
    .looseObject({
      type: z.string().optional(),
      text: z.string().optional(),
      stop_reason: z.string().nullable().optional(),
      stop_details: z
        .looseObject({ explanation: z.string().nullable().optional() })
        .nullable()
        .optional(),
    })
    .optional(),
  usage: TokenCounts.optional(),
  error: z.looseObject({ type: z.string().optional(), message: z.string().optional() }).optional(),
});

/** The HTTP status each error type has when it is not sent inside a stream. */
const ERROR_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

/**
 * Puts a streamed message together from its events: message_start, then per content block
 * content_block_start / content_block_delta / content_block_stop, then message_delta (the
 * stop reason and the final token counts) and message_stop. Only text is kept; thinking
 * and signatures are skipped, pings and event types added later are ignored.
 */
export class MessageAssembler {
  private model: string;
  private text = '';
  private stopReason: string | undefined;
  private refusal: string | undefined;
  private readonly usage: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  private started = false;
  private stopped = false;
  private failure: Result<never> | undefined;

  constructor(requestedModel: string) {
    this.model = requestedModel;
  }

  /** The error that ended the stream early (an `error` event, or an unreadable one). */
  get failed(): Result<never> | undefined {
    return this.failure;
  }

  get chars(): number {
    return this.text.length;
  }

  private count(usage: z.infer<typeof TokenCounts> | undefined): void {
    if (!usage) return;
    // message_delta repeats the counts as they stand at the end; absent ones keep their value.
    this.usage.input = usage.input_tokens ?? this.usage.input;
    this.usage.output = usage.output_tokens ?? this.usage.output;
    this.usage.cacheWrite = usage.cache_creation_input_tokens ?? this.usage.cacheWrite;
    this.usage.cacheRead = usage.cache_read_input_tokens ?? this.usage.cacheRead;
  }

  /** Takes one event's data; returns what it means for progress, if anything. */
  accept(data: string): StreamUpdate | undefined {
    if (this.failure || this.stopped) return undefined;
    const parsed = StreamEventSchema.safeParse(safeJson(data));
    if (!parsed.success) {
      this.failure = err(
        'ai.malformed',
        'The Anthropic API sent an answer RigReady could not read.'
      );
      return undefined;
    }
    const event = parsed.data;
    switch (event.type) {
      case 'message_start':
        this.started = true;
        this.model = event.message?.model ?? this.model;
        this.count(event.message?.usage);
        return { kind: 'started' };
      case 'content_block_start': {
        const block = event.content_block;
        // A refusal fallback: the rest of the message is written by another model.
        if (block?.type === 'fallback') this.model = block.to?.model ?? this.model;
        if (block?.type === 'text' && block.text) return this.append(block.text);
        return undefined;
      }
      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          return this.append(event.delta.text);
        }
        return undefined;
      case 'message_delta':
        this.stopReason = event.delta?.stop_reason ?? this.stopReason;
        this.refusal = event.delta?.stop_details?.explanation ?? this.refusal;
        this.count(event.usage);
        return undefined;
      case 'message_stop':
        this.stopped = true;
        return undefined;
      case 'error': {
        const type = event.error?.type ?? '';
        this.failure = apiError(
          ERROR_STATUS[type] ?? 500,
          JSON.stringify({ error: event.error ?? {} }),
          undefined
        );
        return undefined;
      }
      default:
        // ping, content_block_stop, and anything the API adds later.
        return undefined;
    }
  }

  private append(text: string): StreamUpdate {
    this.text += text;
    return { kind: 'text', delta: text, chars: this.text.length };
  }

  /** The stream closed normally: the answer, or why there is none. */
  finish(): Result<MessageAnswer> {
    if (this.failure) return this.failure;
    if (!this.started) {
      return err('ai.malformed', 'The Anthropic API sent an answer RigReady could not read.');
    }
    if (!this.stopped) {
      return err(
        'ai.incomplete',
        'The answer ended before it was complete, so nothing from it was used. Try again.'
      );
    }
    return complete({
      model: this.model,
      stopReason: this.stopReason,
      refusal: this.refusal,
      text: this.text,
      usage: this.usage,
    });
  }
}

/**
 * Sends one prepared body (made with `stream: true`) and reads the answer as it arrives.
 * `onUpdate` reports progress; the answer itself is returned only when the message is
 * complete, and a stream that fails, stalls, is cut off or is cancelled returns nothing
 * of it. Nothing is retried automatically.
 */
export async function streamMessage(
  http: Http,
  key: string,
  body: Record<string, unknown>,
  options: StreamOptions = {}
): Promise<Result<MessageAnswer>> {
  const result = await streamRaw(http, key, body, options);
  if (result.ok) return result;
  return err(
    result.error.code,
    scrub(result.error.message, key),
    result.error.detail === undefined ? undefined : scrub(result.error.detail, key)
  );
}

async function streamRaw(
  http: Http,
  key: string,
  body: Record<string, unknown>,
  options: StreamOptions
): Promise<Result<MessageAnswer>> {
  const decoder = new SseDecoder();
  const assembler = new MessageAssembler(String(body.model));
  // This side ends the request too: when the caller cancels, and when the stream turns
  // out to be unusable (an error event, far too large), so that nothing more is read.
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  let oversized = false;
  const take = (events: SseEvent[]): void => {
    for (const event of events) {
      const update = assembler.accept(event.data);
      if (update) options.onUpdate?.(update);
    }
  };
  const idleMs = options.idleTimeoutMs ?? STREAM_IDLE_MS;
  const response = await http.stream(
    {
      method: 'POST',
      url: `${API_ROOT}/messages`,
      headers: { ...headers(key, 'fallbacks' in body), accept: 'text/event-stream' },
      body: JSON.stringify(body),
      idleTimeoutMs: idleMs,
      timeoutMs: options.timeoutMs ?? STREAM_TOTAL_MS,
      signal: controller.signal,
    },
    (chunk) => {
      if (controller.signal.aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        oversized = true;
        controller.abort();
        return;
      }
      take(decoder.push(chunk));
      if (assembler.failed || decoder.overflowed) controller.abort();
    }
  );
  options.signal?.removeEventListener('abort', cancel);

  if (oversized) {
    return err(
      'ai.oversized',
      'The answer was far larger than expected, so RigReady did not read it.'
    );
  }
  if (assembler.failed) return assembler.failed;
  if (decoder.overflowed) {
    return err('ai.malformed', 'The Anthropic API sent an answer RigReady could not read.');
  }
  if (!response.ok) {
    const detail = response.error.detail ?? response.error.message;
    const seconds = Math.round(idleMs / 1000);
    switch (response.error.code) {
      case 'http.cancelled':
        return err('ai.cancelled', 'Cancelled. Nothing from the answer was used.');
      case 'http.idle':
        return err(
          'ai.stalled',
          bytes === 0
            ? `The Anthropic API did not start answering within ${seconds} seconds. Try again.`
            : `The answer stopped arriving: nothing came for ${seconds} seconds, so nothing from it was used. Try again.`
        );
      case 'http.timeout':
        return err('ai.timeout', 'The Anthropic API did not answer in time. Try again.', detail);
      default:
        return bytes === 0
          ? err(
              'ai.network',
              'Could not reach the Anthropic API. Check the internet connection.',
              detail
            )
          : err(
              'ai.interrupted',
              'The connection to the Anthropic API broke before the answer was complete, so nothing from it was used. Try again.',
              detail
            );
    }
  }
  const { status, body: text } = response.value;
  if (status !== 200) {
    if (text.length > MAX_RESPONSE_BYTES) {
      return err(
        'ai.oversized',
        'The answer was far larger than expected, so RigReady did not read it.'
      );
    }
    return apiError(status, text, response.value.headers['retry-after']);
  }
  take(decoder.end());
  return assembler.finish();
}

export type KeyCheck = { valid: true; model: string } | { valid: false; reason: string };

/** "Test key": one free request (the model's description) that needs a valid key. */
export async function testKey(http: Http, key: string, model: string): Promise<Result<KeyCheck>> {
  const response = await http.request({
    method: 'GET',
    url: `${API_ROOT}/models/${encodeURIComponent(model)}`,
    headers: headers(key, false),
    timeoutMs: 20_000,
  });
  if (!response.ok) {
    return err('ai.network', 'Could not reach the Anthropic API. Check the internet connection.');
  }
  const { status } = response.value;
  if (status === 200) return ok({ valid: true, model });
  if (status === 401) return ok({ valid: false, reason: 'Anthropic did not accept this key.' });
  if (status === 403 || status === 404) {
    return ok({
      valid: false,
      reason: `The key works, but it cannot use ${modelInfo(model).name}. Pick another model.`,
    });
  }
  const failed = apiError(status, response.value.body, response.value.headers['retry-after']);
  return failed.ok ? failed : err(failed.error.code, scrub(failed.error.message, key));
}
