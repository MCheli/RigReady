import type { Logger } from '../../../core/logger';
import type { Http, HttpRequest, HttpResponse, HttpStreamRequest } from '../../../core/ports';
import type { Result } from '../../../core/result';

/**
 * Every request to an AI provider that fails leaves one line in the log, so "it said no"
 * can be looked up afterwards: which host, which model, the HTTP status, the provider's own
 * error type, code and message, and the id the provider gave the request (what its support
 * asks for).
 *
 * What is never in the line: the key (it is a request header, and no header is logged; a
 * provider that repeats it in its message has it cut out), the request body (the user's
 * text, the conversation, what the tools answered), and anything of an answer that worked.
 */

const MAX_MESSAGE = 300;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

function parsed(body: string | undefined): Record<string, unknown> | undefined {
  if (!body) return undefined;
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    // Not JSON (an error page, an empty body): the line is written from what else is known.
    return undefined;
  }
}

/** The model a request names: in its body, or in the address of a model lookup. */
function modelOf(request: HttpRequest, url: URL | undefined): string | undefined {
  const named = text(parsed(request.body)?.['model']);
  if (named) return named;
  const lookup = url ? /\/models\/([^/]+)$/.exec(url.pathname) : null;
  return lookup ? decodeURIComponent(lookup[1]!) : undefined;
}

/** The key as the request carries it, to cut it out of whatever a provider says back. */
function keyOf(request: HttpRequest): string | undefined {
  const headers = request.headers ?? {};
  const direct = headers['x-api-key'];
  if (direct) return direct;
  const bearer = headers['authorization'] ?? headers['Authorization'];
  return bearer ? bearer.replace(/^Bearer\s+/i, '') : undefined;
}

/** What a provider says is wrong: Anthropic's {error: {type, message}} and OpenAI's {error: {type, code, message}}. */
function said(body: string): { type?: string; code?: string; message?: string; id?: string } {
  const json = parsed(body);
  const error = json?.['error'];
  const out: { type?: string; code?: string; message?: string; id?: string } = {};
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const type = text(e['type']);
    const code = text(e['code']) ?? (typeof e['code'] === 'number' ? String(e['code']) : undefined);
    const message = text(e['message']);
    if (type) out.type = type;
    if (code) out.code = code;
    if (message) out.message = message;
  } else {
    const plain = text(error) ?? text(json?.['message']);
    if (plain) out.message = plain;
  }
  const id = text(json?.['request_id']);
  if (id) out.id = id;
  return out;
}

function line(
  request: HttpRequest,
  result: Result<HttpResponse>
): Record<string, unknown> | undefined {
  let url: URL | undefined;
  try {
    url = new URL(request.url);
  } catch {
    // Not an address: the line then says "unknown" for the provider.
    url = undefined;
  }
  const model = modelOf(request, url);
  const where = {
    provider: url?.host ?? 'unknown',
    // The path alone: an address's query is never logged.
    path: url?.pathname ?? '',
    ...(model ? { model } : {}),
  };
  if (!result.ok) {
    // The user's own Stop is not a failure.
    if (result.error.code === 'http.cancelled') return undefined;
    return { ...where, failure: result.error.code, message: result.error.message };
  }
  const { status, headers, body } = result.value;
  if (status >= 200 && status < 300) return undefined;
  const error = said(body);
  const key = keyOf(request);
  let message = error.message;
  if (message && key && key.length >= 4) message = message.split(key).join('***');
  if (message && message.length > MAX_MESSAGE) message = `${message.slice(0, MAX_MESSAGE)}…`;
  const requestId = headers['request-id'] ?? headers['x-request-id'] ?? error.id;
  return {
    ...where,
    status,
    ...(error.type ? { errorType: error.type } : {}),
    ...(error.code ? { errorCode: error.code } : {}),
    ...(message ? { message } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

/** The Http port with the failures of what goes through it written to the log. */
export function loggedHttp(http: Http, log: Logger): Http {
  const note = (request: HttpRequest, result: Result<HttpResponse>): void => {
    const data = line(request, result);
    if (data) log.warn('ai-assist: a request to the AI provider failed', data);
  };
  return {
    async request(request: HttpRequest): Promise<Result<HttpResponse>> {
      const result = await http.request(request);
      note(request, result);
      return result;
    },
    async stream(
      request: HttpStreamRequest,
      onChunk: (bytes: Uint8Array) => void
    ): Promise<Result<HttpResponse>> {
      const result = await http.stream(request, onChunk);
      note(request, result);
      return result;
    },
  };
}
