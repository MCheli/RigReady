---
title: Choose who answers
description: Use your own key from Anthropic, OpenAI, Google Gemini, OpenRouter or Mistral, or a model on your PC, and see which host receives what.
order: 5
---

The AI help in the [binding guide](../dcs/binding-guide-and-ai.md) uses a model you choose, with your own key. RigReady has no account or server of its own and never sees your key or your requests. Set it up under **Configure > Settings > AI assistance**.

## The choices

| Who answers | What you need | Where requests go |
|---|---|---|
| **Anthropic (Claude)**, the default | An Anthropic API key | `api.anthropic.com` |
| **OpenAI** | An OpenAI API key | `api.openai.com` |
| **OpenAI-compatible**, preset **Google Gemini** | A key from Google AI Studio | `generativelanguage.googleapis.com` |
| **OpenAI-compatible**, preset **OpenRouter** | An OpenRouter key | `openrouter.ai` |
| **OpenAI-compatible**, preset **Mistral** | A Mistral key | `api.mistral.ai` |
| **OpenAI-compatible**, preset **Ollama** | Ollama running on this PC, no key | `localhost:11434`, this PC only |
| **OpenAI-compatible**, preset **LM Studio** | LM Studio's server running on this PC, no key | `localhost:1234`, this PC only |
| **OpenAI-compatible**, **Other** | The service's address and key (Groq, xAI, DeepSeek and others) | The address you type |

## Set it up

1. Under **Who answers**, pick the provider.
2. For OpenAI-compatible, pick a **Service**. It fills in the **API address** and suggests a **Model**; every field stays editable. For **Other**, type the address, for example `https://api.groq.com/openai/v1`, and press Enter.
3. Paste the key and press **Store key**. The page then says the key is stored and shows only its last four characters. A server on this PC needs no key.
4. Check the **Model**. Pick one from the list or type any model id the service offers.
5. Press **Test**. RigReady sends one small request and says plainly whether it worked: "Works. The key works with Claude Opus 5.5.", or why not ("did not accept this key", "does not offer that model").

Each provider keeps its own key, so you can switch between them without pasting again. A key for an OpenAI-compatible service is kept for that service's host only: change the address to another host and the key is removed, so it can never be sent there.

## Structured answers

Suggestions and drafted guides come back as JSON, which RigReady checks line by line before you see anything. Most services can be held to a JSON schema. For one that cannot (DeepSeek, most Groq models, some OpenRouter models, older local servers), set **Structured answers** to **Ask for JSON**: the schema is then written into the request, the answer is checked the same way, and if it does not check out the same request is sent once more. The preview before each request says when this applies. If the second answer still does not check out, nothing is used and the message says so.

## Which host receives what

What is sent depends on what you use, and is the same for every provider.

- **The binding guide** sends the aircraft, its actions and what each is bound to now, the product names and layout of the controllers used in DCS, RigReady's guide for the aircraft and your question. It never sends file paths, device IDs, serial numbers, the names you gave your devices, your Windows user or PC name, or the contents of your files. See [What is sent](../dcs/binding-guide-and-ai.md#what-is-sent).
- **The built-in assistant** sends your messages, its own answers, RigReady's instructions and tool list, and what each tool it used answered. That can be anything RigReady itself can show you: your setups, what is connected and running, where programs are installed, the names of your devices, bindings and settings. In what the tools answered, the path of your Windows user folder is written as `{USER}` and the PC's name as `{PC}`; other names and paths go as they are. See [The built-in assistant](built-in-assistant.md#every-request-is-shown-first).

**Exactly what is sent** in Settings says the same for the provider you chose.

- Requests go only to the host in the table above (or the one you typed), and only when you press **Send** on the preview, or **Test** in Settings. In the assistant panel you can switch the preview off for one conversation; its requests then go as soon as they are ready, until you press **Stop**.
- The address must start with `https://`. Plain `http://` is accepted only for this PC (`localhost`, `127.0.0.1`), so the key and your data are never sent unencrypted over a network.
- If a service answers with a redirect to another address, RigReady stops and says so instead of following it with your key.
- The key goes only in the request's header. It is encrypted for your Windows account and never written to settings, logs, backups, shared setups or screenshots.
- With Ollama or LM Studio nothing leaves the PC, unless that server is set up to send it on.
- The provider's own terms and privacy policy apply to what you send it.

## Cost and tokens

After each answer, RigReady shows the model, the tokens in (and how many came from the provider's cache) and out, as the provider reports them. It shows an approximate cost for the Anthropic and OpenAI models it lists. For other services and models it shows no price, because it does not know it; check your account with the service. A model on your own PC costs nothing per request.
