# AI providers for the binding help (November 2026)

The binding help started with Anthropic only. This note records what the other providers' APIs offer, as checked on 2026-11-11 against each vendor's own documentation, and what RigReady does with it. Model ids change often: RigReady offers the ids below as defaults and lets the user type any other.

## Design in one paragraph

Three providers live in `src/features/ai-assist/core/providers.ts`: **Anthropic** (the Messages API, unchanged, the default and first in the list), **OpenAI** (Chat Completions at `https://api.openai.com/v1`), and **OpenAI-compatible** (any server that copies Chat Completions, at a base URL the user gives, with presets for Google Gemini, OpenRouter, Mistral, Ollama and LM Studio). The two OpenAI-shaped providers share `core/openai.ts`. Each provider talks to one host. The base URL must be https, except plain http to this PC (`localhost`, `127.0.0.1`, `[::1]`); the Http port enforces the same rule and AI requests never follow a redirect (`noRedirects`), so a key cannot be carried to another host. Keys are kept per provider in the secrets port; the OpenAI-compatible key is stored together with the host it was entered for and is removed when the address moves to another host. Structured answers use a JSON schema where the service enforces one (`response_format: {type: "json_schema", strict: true}`); for a service that does not, "Ask for JSON" writes the schema into the task, takes the JSON object out of the answer, checks it with the same zod schemas, and sends the very same request once more if it does not check out (the preview says so before anything is sent). Streams are read the same way for every OpenAI-shaped server, and a server that ignores `stream` and answers in one piece is read as such.

## OpenAI

- Base URL `https://api.openai.com/v1`, `Authorization: Bearer <key>`. Chat Completions is supported; OpenAI recommends the Responses API for new projects but has not deprecated Chat Completions. RigReady uses Chat Completions because every compatible server copies it. [API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- `max_tokens` is deprecated for current models in favour of `max_completion_tokens` (which counts reasoning tokens too). RigReady sends `max_completion_tokens` to OpenAI and `max_tokens` to compatible servers.
- Structured outputs: `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`. Strict mode needs every property required and `additionalProperties: false`; RigReady's two schemas (suggestions, drafted guide) already are.
- Streaming: `stream: true`; with `stream_options: {include_usage: true}` a last chunk with empty `choices` carries the usage, then `data: [DONE]`. `finish_reason` is `stop`, `length`, `content_filter`, `tool_calls`. A refusal arrives in `message.refusal` (or `delta.refusal`).
- Usage: `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`. RigReady shows cached tokens as "from cache" and prices them at the cached rate.
- Models and prices per million tokens (input / cached input / output), from [models](https://developers.openai.com/api/docs/models) and [pricing](https://developers.openai.com/api/docs/pricing): `gpt-6.1-terra` $1 / $0.05 / $5 (RigReady's default: fast and cheap enough for a plan of 30 000 tokens), `gpt-6.1-sol` $2 / $0.10 / $10, `gpt-6-astra` $10 / $1 / $50.
- "Test" uses `GET /v1/models/{id}`, which costs nothing and fails with 401 for a bad key and 404 for a model the key cannot use.

## Google Gemini (OpenAI-compatible endpoint)

- Base URL `https://generativelanguage.googleapis.com/v1beta/openai`, `Authorization: Bearer <Gemini API key>`; streaming, structured output through `response_format` and `GET /models` are supported. [Gemini OpenAI compatibility](https://aistudio.google.com/docs/openai)
- Models: `gemini-3.6-flash` is Stable (RigReady's preset default); `gemini-3.8-flash` is newer but marked New, not Stable; `gemini-3.1-pro-preview` is the Pro model. `gemini-2.5-*` are deprecated and rerouted on 1 Dec 2026. [Models](https://aistudio.google.com/docs/models)

## OpenRouter

- Base URL `https://openrouter.ai/api/v1`, Bearer key. Model ids are `vendor/model`; "latest" aliases such as `~anthropic/claude-sonnet-latest` exist (RigReady's preset default). [Quickstart](https://openrouter.ai/docs/quickstart)
- `json_schema` with `strict` works, but only on routes whose provider supports it. When a model refuses, the user switches the preset to "Ask for JSON". [Structured outputs](https://openrouter.ai/docs/features/structured-outputs)
- Streams carry SSE comment lines (`: OPENROUTER PROCESSING`), a usage chunk before `[DONE]`, and errors mid-stream as a chunk with a top-level `error` and `finish_reason: "error"` under HTTP 200. RigReady's stream reader handles all three. [Streaming](https://openrouter.ai/docs/api/reference/streaming)

## Mistral

- Base URL `https://api.mistral.ai/v1`, Bearer key, Chat Completions shape with `max_tokens`. `response_format` accepts `text`, `json_object` and `json_schema`. [API](https://docs.mistral.ai/api)
- How usage is reported in a stream is not documented, and Mistral refuses unknown fields, so RigReady does not send `stream_options` to `api.mistral.ai`.
- Preset model `mistral-large-latest`. [Models](https://docs.mistral.ai/getting-started/models/models_overview/)

## Groq, xAI, DeepSeek (no preset; type the address)

- **Groq** `https://api.groq.com/openai/v1`: strict `json_schema` only on a few models (`openai/gpt-oss-20b`, `openai/gpt-oss-120b` and two others); other models only `json_object`, so use "Ask for JSON" with them. [Structured outputs](https://console.groq.com/docs/structured-outputs)
- **xAI** `https://api.x.ai/v1`: `json_schema` supported; flagship `grok-4.7`. [Structured outputs](https://docs.x.ai/docs/guides/structured-outputs), [models](https://docs.x.ai/docs/models)
- **DeepSeek** `https://api.deepseek.com`: only `json_object` is documented, so "Ask for JSON". Models `deepseek-flash`, `deepseek-v4-pro`. [JSON mode](https://api-docs.deepseek.com/guides/json_mode)

## Local servers

- **Ollama** `http://localhost:11434/v1`, no key. Streaming and `stream_options.include_usage` are supported, as are `GET /v1/models`. `response_format` with a JSON schema is enforced on Ollama 0.5 and later. Preset model `qwen3:8b`; small models give weaker plans. [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- **LM Studio** `http://localhost:1234/v1`, any key or none. `json_schema` structured output is supported (models under 7B may not keep to it); `stream_options` is not listed, so RigReady does not send it there and shows usage only when the server reports it. The model id is whatever the user loaded. [OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat), [structured output](https://lmstudio.ai/docs/app/api/structured-output)

## Azure OpenAI: left out

The v1 API (`https://<resource>.openai.azure.com/openai/v1/`) works with an OpenAI client, but key authentication is documented with an `api-key` header and the `model` field must be a deployment name. Supporting it would mean a fourth header style and a deployment concept for very few sim pilots, so it is not offered. [API lifecycle](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle)

## Network and key rules (unchanged from the security review)

- Only the chosen provider's host is contacted, over https, or a server on this PC over http. Redirects are returned, never followed.
- The key goes only in the request header (`x-api-key` for Anthropic, `Authorization: Bearer` for the others), is scrubbed from every error message, and never reaches settings, logs, backups, shared setups or screenshots.
- Answers over 1 MB are refused before they are parsed; SSE lines over 2 MB end the stream.
