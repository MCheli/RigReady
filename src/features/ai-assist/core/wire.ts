import { z } from 'zod';
import type { Http } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import {
  API_ROOT,
  apiError,
  headers,
  MAX_RESPONSE_BYTES,
  safeJson,
  scrub,
  type Usage,
} from './anthropic';

/**
 * The two ways a tool-using conversation goes over the wire: Anthropic's Messages API, and
 * OpenAI's Chat Completions (OpenAI and every OpenAI-compatible server). The conversation is
 * kept in one form (Anthropic's content blocks) and turned into the other when the provider
 * speaks it. Only the provider's own host is ever contacted.
 */

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type Block = TextBlock | ToolUseBlock | ToolResultBlock;
export interface Message {
  role: 'user' | 'assistant';
  content: Block[];
}

export interface WireTool {
  name: string;
  description: string;
  /** An object schema, without $schema. */
  schema: Record<string, unknown>;
}

/** Where a conversation goes and how it is spoken. */
export interface Wire {
  kind: 'anthropic' | 'chat';
  /** The API's root without a trailing slash. */
  root: string;
  model: string;
  /** Chat Completions only: OpenAI's API takes max_completion_tokens, most others max_tokens. */
  tokenField?: 'max_completion_tokens' | 'max_tokens';
}

export interface Answer {
  blocks: Block[];
  usage: Usage;
  model: string;
  /** "tool_use", "end_turn", "max_tokens" (the chat stop reasons are mapped onto these). */
  stopReason: string | undefined;
}

/**
 * The conversation with a cache breakpoint at its end (Anthropic): the next request, which
 * repeats all of this and adds to it, reads it at the cache price instead of the full one.
 * The mark is put on the body alone, never kept in the conversation, so it moves with every
 * request and the two breakpoints (this one and the instructions') are all there ever are.
 */
function withBreakpoint(messages: Message[]): unknown[] {
  const last = messages.at(-1);
  if (!last || last.content.length === 0) return messages;
  const end = last.content.length - 1;
  return [
    ...messages.slice(0, -1),
    {
      role: last.role,
      content: last.content.map((block, i) =>
        i === end ? { ...block, cache_control: { type: 'ephemeral' } } : block
      ),
    },
  ];
}

export function requestBody(
  wire: Wire,
  system: string,
  tools: WireTool[],
  messages: Message[],
  maxTokens: number
): Record<string, unknown> {
  if (wire.kind === 'anthropic') {
    return {
      model: wire.model,
      max_tokens: maxTokens,
      // Tools and instructions never change within a conversation: one breakpoint covers both.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema,
      })),
      messages: withBreakpoint(messages),
    };
  }
  const chat: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = message.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const calls = message.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      chat.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      });
      continue;
    }
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        chat.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
      }
    }
    const text = message.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text) chat.push({ role: 'user', content: text });
  }
  return {
    model: wire.model,
    [wire.tokenField ?? 'max_tokens']: maxTokens,
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema },
    })),
    messages: chat,
  };
}

const AnthropicSchema = z.object({
  model: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  content: z.array(
    z.looseObject({
      type: z.string(),
      text: z.string().optional(),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.unknown().optional(),
    })
  ),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().nullable().optional(),
      cache_read_input_tokens: z.number().nullable().optional(),
    })
    .optional(),
});

const ChatSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.looseObject({
        finish_reason: z.string().nullable().optional(),
        message: z.looseObject({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.looseObject({
                id: z.string(),
                function: z.looseObject({ name: z.string(), arguments: z.string().optional() }),
              })
            )
            .nullable()
            .optional(),
        }),
      })
    )
    .min(1),
  usage: z
    .looseObject({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      prompt_tokens_details: z
        .looseObject({ cached_tokens: z.number().nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

function chatHeaders(key: string | undefined): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  };
}

function parseAnswer(wire: Wire, text: string, body: Record<string, unknown>): Result<Answer> {
  const fallbackModel = String(body['model']);
  if (wire.kind === 'anthropic') {
    const parsed = AnthropicSchema.safeParse(safeJson(text));
    if (!parsed.success) return err('ai.malformed', 'The answer could not be read.');
    const message = parsed.data;
    if (message.stop_reason === 'refusal') {
      return err('ai.refused', 'The model declined to answer this request.');
    }
    const blocks: Block[] = [];
    for (const block of message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        blocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use' && block.id && block.name) {
        blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} });
      }
    }
    return ok({
      blocks,
      usage: {
        input: message.usage?.input_tokens ?? 0,
        output: message.usage?.output_tokens ?? 0,
        cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
        cacheRead: message.usage?.cache_read_input_tokens ?? 0,
      },
      model: message.model ?? fallbackModel,
      stopReason: message.stop_reason ?? undefined,
    });
  }
  const parsed = ChatSchema.safeParse(safeJson(text));
  if (!parsed.success) return err('ai.malformed', 'The answer could not be read.');
  const choice = parsed.data.choices[0]!;
  if (choice.message.refusal) {
    return err('ai.refused', 'The model declined to answer this request.');
  }
  const blocks: Block[] = [];
  if (choice.message.content) blocks.push({ type: 'text', text: choice.message.content });
  for (const call of choice.message.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      // Arguments that are not JSON: the tool refuses them as invalid, and the model is told.
      input = { unreadable: call.function.arguments ?? '' };
    }
    blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
  }
  const cached = parsed.data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const finish = choice.finish_reason ?? undefined;
  return ok({
    blocks,
    usage: {
      input: (parsed.data.usage?.prompt_tokens ?? 0) - cached,
      output: parsed.data.usage?.completion_tokens ?? 0,
      cacheWrite: 0,
      cacheRead: cached,
    },
    model: parsed.data.model ?? fallbackModel,
    stopReason:
      finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn',
  });
}

/** How long an answer may take: the body is not streamed, so nothing arrives until it is whole. */
const ANSWER_TIMEOUT_MS = 180_000;

/**
 * Sends one request body and reads the answer. Nothing is retried. The answer is read as it
 * arrives only so that `signal` can end the wait at once (the user's Stop); the request
 * itself asks for a whole answer, not a stream.
 */
export async function sendTurn(
  http: Http,
  wire: Wire,
  key: string | undefined,
  body: Record<string, unknown>,
  who: string,
  signal?: AbortSignal
): Promise<Result<Answer>> {
  const anthropic = wire.kind === 'anthropic';
  const decoder = new TextDecoder();
  let received = '';
  let bytes = 0;
  const response = await http.stream(
    {
      method: 'POST',
      url: anthropic ? `${API_ROOT}/messages` : `${wire.root}/chat/completions`,
      headers: anthropic ? headers(key ?? '', false) : chatHeaders(key),
      body: JSON.stringify(body),
      timeoutMs: ANSWER_TIMEOUT_MS,
      idleTimeoutMs: ANSWER_TIMEOUT_MS,
      // Only the host the preview named: a redirect is an answer, never followed.
      noRedirects: true,
      ...(signal ? { signal } : {}),
    },
    (chunk) => {
      bytes += chunk.length;
      // More than is ever read: the rest is dropped rather than kept in memory.
      if (bytes <= MAX_RESPONSE_BYTES) received += decoder.decode(chunk, { stream: true });
    }
  );
  if (!response.ok) {
    const code = response.error.code;
    if (code === 'http.cancelled') {
      return err('ai.stopped', 'Stopped before the answer came. Nothing was changed.');
    }
    const late = code === 'http.timeout' || code === 'http.idle';
    return late
      ? err('ai.timeout', `${who} did not answer in time. Try again.`)
      : err('ai.network', `Could not reach ${who}. Check the connection.`);
  }
  const status = response.value.status;
  // A refusal comes whole in the result; an answer came in pieces.
  const text = response.value.body || received + decoder.decode();
  if (bytes > MAX_RESPONSE_BYTES || text.length > MAX_RESPONSE_BYTES) {
    return err(
      'ai.oversized',
      'The answer was far larger than expected, so RigReady did not read it.'
    );
  }
  if (status !== 200) {
    if (anthropic) {
      const failed = apiError(status, text, response.value.headers['retry-after']);
      if (failed.ok) return failed;
      return err(
        failed.error.code,
        scrub(failed.error.message, key ?? ''),
        failed.error.detail === undefined ? undefined : scrub(failed.error.detail, key ?? '')
      );
    }
    return err(
      status === 401 ? 'ai.key' : status === 429 ? 'ai.rateLimited' : 'ai.request',
      status === 401
        ? `${who} did not accept the key. Check it in Settings.`
        : status === 429
          ? `${who} is limiting requests. Try again in a minute.`
          : `${who} refused the request (HTTP ${status}).`
    );
  }
  return parseAnswer(wire, text, body);
}
