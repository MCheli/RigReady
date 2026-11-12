import type { Http } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import {
  approximateCost,
  DEFAULT_MODEL,
  knownModel,
  messageBody,
  MODELS,
  sendMessage,
  streamMessage,
  testKey,
  type KeyCheck,
  type MessageAnswer,
  type MessageRequest,
  type StreamOptions,
  type Usage,
} from './anthropic';
import {
  chatBody,
  chatCost,
  sendChat,
  streamChat,
  testChat,
  type ChatTarget,
  type ModelPrice,
} from './openai';

/**
 * Who answers the AI requests: Anthropic (the default), OpenAI, or any server that speaks
 * OpenAI's Chat Completions ("OpenAI-compatible": Google Gemini, OpenRouter, Mistral,
 * Groq, xAI, DeepSeek, and local servers such as Ollama and LM Studio). Each provider
 * talks to exactly one host. Sources: docs/research/ai-providers.md.
 */

export const PROVIDER_IDS = ['anthropic', 'openai', 'compatible'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  compatible: 'OpenAI-compatible (Gemini, OpenRouter, Mistral, local servers)',
};

/** The name each provider's key is kept under in ports.secrets. */
export const KEY_SECRETS: Record<ProviderId, string> = {
  // The name the Anthropic key always had, so a key stored by an older version still works.
  anthropic: 'anthropic-api-key',
  openai: 'openai-api-key',
  compatible: 'compatible-api-key',
};

export type Structured = 'schema' | 'prompt';

export const OPENAI_ROOT = 'https://api.openai.com/v1';

/** OpenAI models offered in Settings; the first is the default. Prices as published in Nov 2026. */
export const OPENAI_MODELS: { id: string; name: string; price: ModelPrice }[] = [
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', price: { input: 1, output: 5, cacheRead: 0.05 } },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', price: { input: 2, output: 10, cacheRead: 0.1 } },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', price: { input: 10, output: 50, cacheRead: 1 } },
];
export const OPENAI_DEFAULT_MODEL = OPENAI_MODELS[0]!.id;

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  /** Suggested model id; empty when it depends on what the user installed. */
  model: string;
  structured: Structured;
  /** Whether the server needs a key at all (local servers do not). */
  keyNeeded: boolean;
  /** Shown under the choice. */
  note: string;
}

/** Fill-ins for the OpenAI-compatible provider. Every field stays editable. */
export const PRESETS: Preset[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    structured: 'schema',
    keyNeeded: true,
    note: 'A key from Google AI Studio.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '~anthropic/claude-sonnet-latest',
    structured: 'schema',
    keyNeeded: true,
    note: 'One key for many models. Not every model it routes to accepts a JSON schema; if one refuses, choose "Ask for JSON".',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    structured: 'schema',
    keyNeeded: true,
    note: 'A key from Mistral La Plateforme.',
  },
  {
    id: 'ollama',
    name: 'Ollama (on this PC)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    structured: 'schema',
    keyNeeded: false,
    note: 'Free and private: nothing leaves the PC. Small models give weaker suggestions.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (on this PC)',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    structured: 'schema',
    keyNeeded: false,
    note: 'Free and private: nothing leaves the PC. Type the id of the model you loaded.',
  },
];

/** Model ids are typed by the user: kept to the characters real ids use. */
export const MODEL_ID = /^[A-Za-z0-9~][A-Za-z0-9._:/@~+-]{0,159}$/;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether an address is this PC itself. */
export const isLocal = (url: URL): boolean => LOOPBACK.has(url.hostname);

/**
 * Checks a base URL typed by the user: https, or plain http to this PC only; no user name,
 * password, query or fragment. Returns it without a trailing slash.
 */
export function checkBaseUrl(text: string): Result<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return err('ai.baseUrl', 'Type the address of the API first.');
  if (trimmed.length > 300) return err('ai.baseUrl', 'That address is too long.');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err('ai.baseUrl', 'That is not a web address. It starts with https://.');
  }
  if (url.protocol === 'http:' && !isLocal(url)) {
    return err(
      'ai.baseUrl',
      'Only https addresses are allowed, so the key and your data are encrypted on the way. Plain http is allowed only to this PC (localhost).'
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return err('ai.baseUrl', 'The address must start with https://.');
  }
  if (url.username || url.password) {
    return err('ai.baseUrl', 'Put the key in the key field, not in the address.');
  }
  if (url.search || url.hash) {
    return err('ai.baseUrl', 'The address must not have a query (?...) or a fragment (#...).');
  }
  return ok(`${url.origin}${url.pathname.replace(/\/+$/, '')}`);
}

/** The settings that say who answers. Kept in the feature's settings.json. */
export interface ProviderSettings {
  provider: ProviderId;
  /** The Anthropic model (the field's name from before there were other providers). */
  model: string;
  openai: { model: string };
  compatible: { baseUrl: string; model: string; structured: Structured };
}

/** A provider, ready to build and send requests. */
export interface ChatProvider {
  id: ProviderId;
  /** Who answers, for the page: "Anthropic", "OpenAI", "the server at localhost:11434". */
  label: string;
  /** The only host requests go to: api.anthropic.com, localhost:11434. */
  host: string;
  /** True for a server on this PC. */
  local: boolean;
  model: string;
  structured: Structured;
  keyNeeded: boolean;
  body(request: MessageRequest): Record<string, unknown>;
  send(
    http: Http,
    key: string | undefined,
    body: Record<string, unknown>
  ): Promise<Result<MessageAnswer>>;
  stream(
    http: Http,
    key: string | undefined,
    body: Record<string, unknown>,
    options: StreamOptions
  ): Promise<Result<MessageAnswer>>;
  test(http: Http, key: string | undefined): Promise<Result<KeyCheck>>;
  /** Approximate dollars for this many tokens in, at the model's input price; null when unknown. */
  inputCost(tokens: number): number | null;
  /** Approximate dollars for what a request used, at the model's prices (cache writes and reads at theirs); null when unknown. */
  cost(usage: Usage): number | null;
}

const needKey = (key: string | undefined): Result<string> =>
  key ? ok(key) : err('ai.noKey', 'No API key is stored. Add one in Settings.');

function anthropic(model: string): ChatProvider {
  return {
    id: 'anthropic',
    label: 'Anthropic',
    host: 'api.anthropic.com',
    local: false,
    model,
    structured: 'schema',
    keyNeeded: true,
    body: (request) => messageBody(request),
    async send(http, key, body) {
      const k = needKey(key);
      return k.ok ? sendMessage(http, k.value, body) : k;
    },
    async stream(http, key, body, options) {
      const k = needKey(key);
      return k.ok ? streamMessage(http, k.value, body, options) : k;
    },
    async test(http, key) {
      const k = needKey(key);
      return k.ok ? testKey(http, k.value, model) : k;
    },
    inputCost: (tokens) =>
      knownModel(model)
        ? approximateCost(model, { input: tokens, output: 0, cacheWrite: 0, cacheRead: 0 })
        : null,
    cost: (usage) => approximateCost(model, usage),
  };
}

function chat(
  id: ProviderId,
  target: ChatTarget,
  host: string,
  local: boolean,
  model: string,
  keyNeeded: boolean,
  freeModelCheck: boolean
): ChatProvider {
  return {
    id,
    label: target.label,
    host,
    local,
    model,
    structured: target.structured,
    keyNeeded,
    body: (request) => chatBody(target, request),
    send: (http, key, body) => sendChat(http, target, key, body),
    stream: (http, key, body, options) => streamChat(http, target, key, body, options),
    test: (http, key) => testChat(http, target, key, model, freeModelCheck),
    inputCost: (tokens) => {
      const price = target.prices?.[model];
      return price ? (tokens * price.input) / 1_000_000 : null;
    },
    cost: (usage) => chatCost(target, model, usage),
  };
}

/** Hosts known not to accept stream_options (the token counts at the end of a stream). */
const NO_STREAM_USAGE = new Set(['api.mistral.ai', 'localhost:1234', '127.0.0.1:1234']);

/** The provider the settings describe, or why it cannot be used yet. */
export function providerFor(settings: ProviderSettings): Result<ChatProvider> {
  if (settings.provider === 'anthropic') return ok(anthropic(settings.model));
  if (settings.provider === 'openai') {
    const prices = Object.fromEntries(OPENAI_MODELS.map((m) => [m.id, m.price]));
    return ok(
      chat(
        'openai',
        {
          root: OPENAI_ROOT,
          label: 'OpenAI',
          tokenField: 'max_completion_tokens',
          streamUsage: true,
          structured: 'schema',
          prices,
        },
        'api.openai.com',
        false,
        settings.openai.model,
        true,
        true
      )
    );
  }
  const { baseUrl, model, structured } = settings.compatible;
  if (!baseUrl) {
    return err('ai.baseUrl', 'Choose a service or type the address of the API in Settings.');
  }
  const checked = checkBaseUrl(baseUrl);
  if (!checked.ok) return checked;
  if (!model) return err('ai.model', 'Type the model to use in Settings.');
  const url = new URL(checked.value);
  const local = isLocal(url);
  return ok(
    chat(
      'compatible',
      {
        root: checked.value,
        label: local ? `the server at ${url.host}` : url.host,
        tokenField: 'max_tokens',
        streamUsage: !NO_STREAM_USAGE.has(url.host),
        structured,
      },
      url.host,
      local,
      model,
      !local,
      false
    )
  );
}

/** The models offered in the picker for a provider (the user may type any other). */
export function suggestedModels(
  provider: ProviderId
): { id: string; name: string; input?: number; output?: number }[] {
  if (provider === 'anthropic') {
    return MODELS.map(({ id, name, input, output }) => ({ id, name, input, output }));
  }
  if (provider === 'openai') {
    return OPENAI_MODELS.map(({ id, name, price }) => ({
      id,
      name,
      input: price.input,
      output: price.output,
    }));
  }
  return PRESETS.filter((p) => p.model).map((p) => ({
    id: p.model,
    name: `${p.model} (${p.name})`,
  }));
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: 'anthropic',
  model: DEFAULT_MODEL,
  openai: { model: OPENAI_DEFAULT_MODEL },
  compatible: { baseUrl: '', model: '', structured: 'schema' },
};
