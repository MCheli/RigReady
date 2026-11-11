import { z } from 'zod';
import type { Http } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import {
  MAX_RESPONSE_BYTES,
  scrub,
  STREAM_IDLE_MS,
  STREAM_TOTAL_MS,
  type KeyCheck,
  type MessageAnswer,
  type MessageRequest,
  type StreamOptions,
  type StreamUpdate,
  type Usage,
} from './anthropic';
import { SseDecoder, type SseEvent } from './sse';

/**
 * The Chat Completions API that OpenAI defined and that most other providers copy
 * (Google Gemini's OpenAI endpoint, OpenRouter, Mistral, Groq, xAI, DeepSeek, and the
 * local servers Ollama and LM Studio). Over the Http port, like the Anthropic module.
 * The key, when there is one, is only ever placed in the Authorization header and is
 * scrubbed from anything returned. Redirects are never followed, so a request that
 * carries the key cannot go on to another address.
 */

export interface ModelPrice {
  /** US dollars per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
}

export interface ChatTarget {
  /** Where the API lives, without a trailing slash: https://api.openai.com/v1. */
  root: string;
  /** Who answers, for messages: "OpenAI", "the server at localhost:11434". */
  label: string;
  /** OpenAI's own API takes max_completion_tokens; most others max_tokens. */
  tokenField: 'max_completion_tokens' | 'max_tokens';
  /** Ask for the token counts at the end of a stream (stream_options.include_usage). */
  streamUsage: boolean;
  /**
   * schema: the answer's JSON schema goes in response_format and the server enforces it.
   * prompt: the schema is written into the task, and the answer is checked here.
   */
  structured: 'schema' | 'prompt';
  /** Prices of the models this target knows, for the approximate cost. */
  prices?: Record<string, ModelPrice>;
}

/** Name given to the schema in response_format. */
export const SCHEMA_NAME = 'rigready_answer';

/** Written after the task when the server is not given the schema itself. */
export function jsonInstruction(schema: Record<string, unknown>): string {
  return [
    'Answer with exactly one JSON object and nothing else: no code fences, no text before or after it.',
    'It must follow this JSON schema:',
    JSON.stringify(schema),
  ].join('\n');
}

/** The exact JSON body sent to {root}/chat/completions. */
export function chatBody(target: ChatTarget, request: MessageRequest): Record<string, unknown> {
  const inPrompt = request.schema !== undefined && target.structured === 'prompt';
  const task = inPrompt ? `${request.task}\n\n${jsonInstruction(request.schema!)}` : request.task;
  return {
    model: request.model,
    [target.tokenField]: request.maxTokens,
    ...(request.stream
      ? { stream: true, ...(target.streamUsage ? { stream_options: { include_usage: true } } : {}) }
      : {}),
    ...(request.schema && !inPrompt
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: SCHEMA_NAME, strict: true, schema: request.schema },
          },
        }
      : {}),
    messages: [
      { role: 'system', content: request.system },
      // The large, stable context first: providers that cache prompt prefixes reuse it.
      { role: 'user', content: `${request.context}\n\n${task}` },
    ],
  };
}

/** Takes the JSON object out of an answer that was only asked for JSON (fences, text around it). */
export function jsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const inner = fenced ? fenced[1]! : trimmed;
  const start = inner.indexOf('{');
  const end = inner.lastIndexOf('}');
  return start >= 0 && end > start ? inner.slice(start, end + 1) : inner;
}

function headers(key: string | undefined, stream: boolean): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...(stream ? { accept: 'text/event-stream' } : {}),
  };
}

const TokenCounts = z
  .looseObject({
    prompt_tokens: z.number().nullable().optional(),
    completion_tokens: z.number().nullable().optional(),
    prompt_tokens_details: z
      .looseObject({ cached_tokens: z.number().nullable().optional() })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

const ResponseSchema = z.looseObject({
  model: z.string().optional(),
  choices: z
    .array(
      z.looseObject({
        message: z
          .looseObject({
            content: z.string().nullable().optional(),
            refusal: z.string().nullable().optional(),
          })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      })
    )
    .min(1),
  usage: TokenCounts,
});

const ChunkSchema = z.looseObject({
  model: z.string().optional(),
  choices: z
    .array(
      z.looseObject({
        delta: z
          .looseObject({
            content: z.string().nullable().optional(),
            refusal: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
        finish_reason: z.string().nullable().optional(),
      })
    )
    .optional(),
  usage: TokenCounts,
  error: z.unknown().optional(),
});

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** The error object of an error body, whichever of the usual shapes the server used. */
function errorObject(body: unknown): Record<string, unknown> | undefined {
  const first = record(Array.isArray(body) ? body[0] : body);
  return record(first?.['error']) ?? first;
}

/** What a server said in an error body. */
function errorMessage(body: unknown): string {
  const first = record(Array.isArray(body) ? body[0] : body);
  if (typeof first?.['error'] === 'string') return first['error'];
  const inner = errorObject(body);
  for (const field of ['message', 'detail']) {
    const value = inner?.[field];
    if (typeof value === 'string') return value;
  }
  return '';
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    // Not JSON: the caller reports the status instead.
    return undefined;
  }
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const cap = (label: string): string => label.charAt(0).toUpperCase() + label.slice(1);

/** One plain message per failure. */
function apiError(
  target: ChatTarget,
  status: number,
  text: string,
  retryAfter: string | undefined
): Result<never> {
  const body = safeJson(text);
  const said = clip(errorMessage(body), 300);
  const who = cap(target.label);
  const detail = said ? `${who} said: ${said}` : `HTTP ${status}`;
  if (status >= 300 && status < 400) {
    return err(
      'ai.redirect',
      `${who} sent the request on to another address. RigReady does not follow it with your key; check the address in Settings.`,
      detail
    );
  }
  if (status === 401) {
    return err('ai.key', `${who} did not accept the API key. Check it in Settings.`, detail);
  }
  if (status === 403) {
    return err('ai.forbidden', 'This API key is not allowed to use that model.', detail);
  }
  if (status === 404) {
    return err(
      'ai.model',
      `${who} does not offer that model, or the address is wrong. Check both in Settings.`,
      detail
    );
  }
  if (status === 413) return err('ai.tooLarge', 'The request was too large for the API.', detail);
  if (status === 429) {
    const code = errorObject(body)?.['code'];
    if (code === 'insufficient_quota') {
      return err(
        'ai.quota',
        `${who} says this key has no credit left. Check the account's billing.`,
        detail
      );
    }
    const seconds = Number.parseInt(retryAfter ?? '', 10);
    return err(
      'ai.rateLimited',
      Number.isFinite(seconds)
        ? `${who} is limiting requests from this key. Try again in ${seconds} seconds.`
        : `${who} is limiting requests from this key. Try again in a minute.`,
      detail
    );
  }
  if (status >= 500) {
    return err(
      'ai.unavailable',
      `${who} is busy or down right now. Try again in a few minutes.`,
      detail
    );
  }
  if ((status === 400 || status === 422) && /response_format|json_schema|schema/i.test(said)) {
    return err(
      'ai.schemaUnsupported',
      `${who} did not accept a JSON schema for the answer. In Settings, set "Structured answers" to "Ask for JSON" and try again.`,
      detail
    );
  }
  return err('ai.request', `${who} refused the request.`, detail);
}

function usageOf(counts: z.infer<typeof TokenCounts>): Usage {
  const cached = counts?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input: Math.max(0, (counts?.prompt_tokens ?? 0) - cached),
    output: counts?.completion_tokens ?? 0,
    cacheWrite: 0,
    cacheRead: cached,
  };
}

/** Approximate cost in US dollars, or null when the model's price is not known. */
export function chatCost(target: ChatTarget, model: string, usage: Usage): number | null {
  const price = target.prices?.[model];
  if (!price) return null;
  return (
    (usage.input * price.input + usage.cacheRead * price.cacheRead + usage.output * price.output) /
    1_000_000
  );
}

interface Finished {
  model: string;
  finish: string | undefined;
  refusal: string | undefined;
  text: string;
  usage: Usage;
}

function complete(target: ChatTarget, message: Finished): Result<MessageAnswer> {
  if (message.refusal || message.finish === 'content_filter') {
    return err(
      'ai.refused',
      'The model declined to answer this request.',
      message.refusal ? clip(message.refusal, 300) : undefined
    );
  }
  if (message.finish === 'length') {
    return err(
      'ai.truncated',
      'The answer was cut off before it was complete, so nothing from it was used. Try again.'
    );
  }
  if (message.finish === 'error') {
    return err('ai.unavailable', `${cap(target.label)} failed while answering. Try again.`);
  }
  const { text, model, usage } = message;
  return ok({ text, model, usage, cost: chatCost(target, model, usage) });
}

/** Removes the key from the messages of a failure, whatever the server echoed. */
function scrubbed<T>(result: Result<T>, key: string | undefined): Result<T> {
  if (result.ok || !key) return result;
  return err(
    result.error.code,
    scrub(result.error.message, key),
    result.error.detail === undefined ? undefined : scrub(result.error.detail, key)
  );
}

const unreadable = (target: ChatTarget): Result<never> =>
  err('ai.malformed', `${cap(target.label)} sent an answer RigReady could not read.`);

/** Reads a whole (not streamed) answer. */
function readWhole(target: ChatTarget, text: string, requested: string): Result<MessageAnswer> {
  const parsed = ResponseSchema.safeParse(safeJson(text));
  if (!parsed.success) return unreadable(target);
  const choice = parsed.data.choices[0]!;
  return complete(target, {
    model: parsed.data.model ?? requested,
    finish: choice.finish_reason ?? undefined,
    refusal: choice.message?.refusal ?? undefined,
    text: choice.message?.content ?? '',
    usage: usageOf(parsed.data.usage),
  });
}

function unreached(
  target: ChatTarget,
  error: { code: string; message: string; detail?: string | undefined }
): Result<never> {
  const timedOut = error.code === 'http.timeout';
  return err(
    timedOut ? 'ai.timeout' : 'ai.network',
    timedOut
      ? `${cap(target.label)} did not answer in time. Try again.`
      : `Could not reach ${target.label}. Check the address and the connection.`,
    error.detail ?? error.message
  );
}

/** Sends one prepared body and waits for the whole answer. Nothing is retried automatically. */
export async function sendChat(
  http: Http,
  target: ChatTarget,
  key: string | undefined,
  body: Record<string, unknown>,
  timeoutMs = 180_000
): Promise<Result<MessageAnswer>> {
  const response = await http.request({
    method: 'POST',
    url: `${target.root}/chat/completions`,
    headers: headers(key, false),
    body: JSON.stringify(body),
    timeoutMs,
    noRedirects: true,
  });
  if (!response.ok) return scrubbed(unreached(target, response.error), key);
  const { status, body: text } = response.value;
  if (text.length > MAX_RESPONSE_BYTES) {
    return err(
      'ai.oversized',
      'The answer was far larger than expected, so RigReady did not read it.'
    );
  }
  if (status !== 200) {
    return scrubbed(apiError(target, status, text, response.value.headers['retry-after']), key);
  }
  return scrubbed(readWhole(target, text, String(body['model'])), key);
}

/**
 * Puts a streamed answer together from its chunks: `data: {...}` events whose
 * choices[0].delta.content carries the text, a finish_reason at the end, optionally a
 * last chunk with the token counts and no choices, then `data: [DONE]`. A chunk with an
 * `error` (sent with status 200 by some servers) ends it.
 */
export class ChatAssembler {
  private model: string;
  private text = '';
  private finish: string | undefined;
  private refusal = '';
  private usage: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  private started = false;
  private done = false;
  private failure: Result<never> | undefined;

  constructor(
    private readonly target: ChatTarget,
    requestedModel: string
  ) {
    this.model = requestedModel;
  }

  get failed(): Result<never> | undefined {
    return this.failure;
  }

  /** Whether any event was read: a server that ignored `stream` sends none. */
  get sawEvents(): boolean {
    return this.started || this.done || this.failure !== undefined;
  }

  accept(data: string): StreamUpdate[] {
    if (this.failure || this.done) return [];
    if (data.trim() === '[DONE]') {
      this.done = true;
      return [];
    }
    const parsed = ChunkSchema.safeParse(safeJson(data));
    if (!parsed.success) {
      this.failure = unreadable(this.target);
      return [];
    }
    const chunk = parsed.data;
    if (chunk.error !== undefined && chunk.error !== null) {
      const code = Number(record(chunk.error)?.['code']);
      this.failure = apiError(
        this.target,
        Number.isInteger(code) && code >= 400 && code < 600 ? code : 500,
        JSON.stringify({ error: chunk.error }),
        undefined
      );
      return [];
    }
    const updates: StreamUpdate[] = [];
    if (!this.started) {
      this.started = true;
      updates.push({ kind: 'started' });
    }
    if (chunk.model) this.model = chunk.model;
    if (chunk.usage) this.usage = usageOf(chunk.usage);
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) this.finish = choice.finish_reason;
    if (choice?.delta?.refusal) this.refusal += choice.delta.refusal;
    const piece = choice?.delta?.content;
    if (piece) {
      this.text += piece;
      updates.push({ kind: 'text', delta: piece, chars: this.text.length });
    }
    return updates;
  }

  /** The stream closed normally: the answer, or why there is none. */
  end(): Result<MessageAnswer> {
    if (this.failure) return this.failure;
    if (!this.started) return unreadable(this.target);
    if (this.finish === undefined) {
      return err(
        'ai.incomplete',
        'The answer ended before it was complete, so nothing from it was used. Try again.'
      );
    }
    return complete(this.target, {
      model: this.model,
      finish: this.finish,
      refusal: this.refusal || undefined,
      text: this.text,
      usage: this.usage,
    });
  }
}

/**
 * Sends one prepared body (made with `stream: true`) and reads the answer as it arrives.
 * A server that ignores `stream` and answers with one JSON document is read as such.
 */
export async function streamChat(
  http: Http,
  target: ChatTarget,
  key: string | undefined,
  body: Record<string, unknown>,
  options: StreamOptions = {}
): Promise<Result<MessageAnswer>> {
  return scrubbed(await streamRaw(http, target, key, body, options), key);
}

const oversizedAnswer = (): Result<never> =>
  err('ai.oversized', 'The answer was far larger than expected, so RigReady did not read it.');

async function streamRaw(
  http: Http,
  target: ChatTarget,
  key: string | undefined,
  body: Record<string, unknown>,
  options: StreamOptions
): Promise<Result<MessageAnswer>> {
  const decoder = new SseDecoder();
  const assembler = new ChatAssembler(target, String(body['model']));
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  let oversized = false;
  // Kept until the first event, in case the server ignored `stream` and sent one document.
  const rawDecoder = new TextDecoder();
  let raw = '';
  const take = (events: SseEvent[]): void => {
    for (const event of events) {
      for (const update of assembler.accept(event.data)) options.onUpdate?.(update);
    }
  };
  const idleMs = options.idleTimeoutMs ?? STREAM_IDLE_MS;
  const response = await http.stream(
    {
      method: 'POST',
      url: `${target.root}/chat/completions`,
      headers: headers(key, true),
      body: JSON.stringify(body),
      idleTimeoutMs: idleMs,
      timeoutMs: options.timeoutMs ?? STREAM_TOTAL_MS,
      signal: controller.signal,
      noRedirects: true,
    },
    (chunk) => {
      if (controller.signal.aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        oversized = true;
        controller.abort();
        return;
      }
      if (!assembler.sawEvents) raw += rawDecoder.decode(chunk, { stream: true });
      take(decoder.push(chunk));
      if (assembler.failed || decoder.overflowed) controller.abort();
    }
  );
  options.signal?.removeEventListener('abort', cancel);
  const who = cap(target.label);

  if (oversized) return oversizedAnswer();
  if (assembler.failed) return assembler.failed;
  if (decoder.overflowed) return unreadable(target);
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
            ? `${who} did not start answering within ${seconds} seconds. Try again.`
            : `The answer stopped arriving: nothing came for ${seconds} seconds, so nothing from it was used. Try again.`
        );
      case 'http.timeout':
        return err('ai.timeout', `${who} did not answer in time. Try again.`, detail);
      default:
        return bytes === 0
          ? unreached(target, response.error)
          : err(
              'ai.interrupted',
              `The connection to ${target.label} broke before the answer was complete, so nothing from it was used. Try again.`,
              detail
            );
    }
  }
  const { status, body: text } = response.value;
  if (status !== 200) {
    if (text.length > MAX_RESPONSE_BYTES) return oversizedAnswer();
    return apiError(target, status, text, response.value.headers['retry-after']);
  }
  take(decoder.end());
  if (!assembler.sawEvents) {
    // No events at all: a server without streaming that answered in one piece.
    const whole = raw + rawDecoder.decode();
    if (whole.trim().startsWith('{')) {
      options.onUpdate?.({ kind: 'started' });
      return readWhole(target, whole, String(body['model']));
    }
  }
  return assembler.end();
}

/**
 * "Test": OpenAI's own API describes a model for free (GET /models/{id}); other servers
 * get the smallest possible request, which proves the address, the key and the model.
 */
export async function testChat(
  http: Http,
  target: ChatTarget,
  key: string | undefined,
  model: string,
  freeModelCheck: boolean
): Promise<Result<KeyCheck>> {
  const response = freeModelCheck
    ? await http.request({
        method: 'GET',
        url: `${target.root}/models/${encodeURIComponent(model)}`,
        headers: headers(key, false),
        timeoutMs: 20_000,
        noRedirects: true,
      })
    : await http.request({
        method: 'POST',
        url: `${target.root}/chat/completions`,
        headers: headers(key, false),
        body: JSON.stringify({
          model,
          [target.tokenField]: 16,
          messages: [{ role: 'user', content: 'Reply with the word OK.' }],
        }),
        timeoutMs: 60_000,
        noRedirects: true,
      });
  const who = cap(target.label);
  if (!response.ok) return scrubbed(unreached(target, response.error), key);
  const { status } = response.value;
  if (status === 200) return ok({ valid: true, model });
  if (status === 401) return ok({ valid: false, reason: `${who} did not accept this key.` });
  if (status === 403 || status === 404) {
    return ok({
      valid: false,
      reason: `${who} answered, but does not offer ${model} to this key. Pick another model.`,
    });
  }
  return scrubbed(
    apiError(target, status, response.value.body, response.value.headers['retry-after']),
    key
  );
}
