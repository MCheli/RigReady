import { z } from 'zod';
import type { Http } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';

/**
 * The Anthropic Messages API, over the Http port (never fetch directly), so tests and
 * scenario runs answer from scripts. Non-streaming: answers here are a few thousand
 * tokens at most. The key is only ever placed in the x-api-key header and is scrubbed
 * from anything that is returned.
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
}

/** The exact JSON body sent to the Messages API. */
export function messageBody(request: MessageRequest): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
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
  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.explanation;
    return err(
      'ai.refused',
      'The model declined to answer this request.',
      why ? clip(why, 300) : undefined
    );
  }
  if (message.stop_reason === 'max_tokens') {
    return err(
      'ai.truncated',
      'The answer was cut off before it was complete, so nothing from it was used. Try again.'
    );
  }
  const answer = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  const model = message.model ?? String(body.model);
  const usage: Usage = {
    input: message.usage?.input_tokens ?? 0,
    output: message.usage?.output_tokens ?? 0,
    cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
    cacheRead: message.usage?.cache_read_input_tokens ?? 0,
  };
  return ok({ text: answer, model, usage, cost: approximateCost(model, usage) });
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
