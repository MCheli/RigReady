import { afterEach, describe, expect, it } from 'vitest';
import { BINDING_FILES, HORNET } from '../../../../tests/dcsBindings';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { AI_KEY_SECRET } from '../../../core/settings';
import type { AssistantProgress, TurnOutcome, TurnPreview } from './assistantModel';
import { PRICES_RECORDED, type AiStatus, type Prepared, type Price, type Sent } from './model';
import { builtInPrice, estimate, providerFor, DEFAULT_SETTINGS } from './providers';

/**
 * The prices behind every estimate, on the whole wired app: RigReady's built-in ones, the
 * user's own, and what is shown when there are none. The key is a made-up string; nothing
 * leaves the fake Http port.
 */

const KEY = 'sk-ant-unit-NOT-A-REAL-KEY-0000-abcd';
/** The built-in prices of the default model, per million tokens. */
const OPUS: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
/** Twice the built-in prices: what a user would type after a price rise. */
const DOUBLE: Price = { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10 };
const USAGE = { input_tokens: 100_000, output_tokens: 500 };

let app: WiredApp | undefined;

afterEach(async () => {
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
});

async function started(): Promise<WiredApp> {
  app = await wiredApp('flying-all-good');
  await app.ports.secrets.set(AI_KEY_SECRET, KEY);
  return app;
}

function reply(running: WiredApp, content: unknown[], stop = 'end_turn', usage = USAGE): void {
  running.ports.http.scripts.push({
    match: { url: 'api.anthropic.com/v1/messages', method: 'POST' },
    times: 1,
    response: {
      status: 200,
      headers: {},
      json: {
        id: 'msg_unit',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content,
        stop_reason: stop,
        usage,
      },
    },
  });
}

const text = (said: string): unknown[] => [{ type: 'text', text: said }];
const use = (id: string): unknown => ({ type: 'tool_use', id, name: 'setups_list', input: {} });
const prepare = (running: WiredApp, said: string, conversationId?: string): Promise<TurnPreview> =>
  running.invoke<TurnPreview>('ai-assist:assistantPrepare', {
    text: said,
    ...(conversationId ? { conversationId } : {}),
  });
const send = (running: WiredApp, requestId: string, pastCeiling?: boolean): Promise<TurnOutcome> =>
  running.invoke<TurnOutcome>('ai-assist:assistantSend', {
    requestId,
    ...(pastCeiling ? { pastCeiling } : {}),
  });
const status = (running: WiredApp): Promise<AiStatus> =>
  running.invoke<AiStatus>('ai-assist:status');
const setPrices = (running: WiredApp, price: Price): Promise<AiStatus> =>
  running.invoke<AiStatus>('ai-assist:setPrices', price);

describe('an estimate from prices per million tokens', () => {
  it('has built-in prices for the listed models of Anthropic and OpenAI, and for no other', () => {
    expect(builtInPrice('anthropic', 'claude-opus-5-5')).toEqual(OPUS);
    // Writing Anthropic's five-minute cache is a quarter more than fresh input.
    expect(builtInPrice('anthropic', 'claude-sonnet-5-5')).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
    });
    // OpenAI charges nothing extra to write its cache.
    expect(builtInPrice('openai', 'gpt-6.1-terra')).toEqual({
      input: 1,
      output: 5,
      cacheRead: 0.05,
      cacheWrite: 1,
    });
    expect(builtInPrice('anthropic', 'a-model-nobody-priced')).toBeNull();
    expect(builtInPrice('openai', 'a-model-nobody-priced')).toBeNull();
    expect(builtInPrice('compatible', 'qwen3:8b')).toBeNull();
  });

  it('counts fresh input, cache writes, cache reads and output each at its own price', () => {
    expect(estimate(OPUS, { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 })).toBe(4);
    expect(estimate(OPUS, { input: 0, output: 1_000_000, cacheWrite: 0, cacheRead: 0 })).toBe(20);
    expect(estimate(OPUS, { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 0 })).toBe(5);
    expect(estimate(OPUS, { input: 0, output: 0, cacheWrite: 0, cacheRead: 1_000_000 })).toBe(0.2);
    expect(
      estimate(OPUS, { input: 90, output: 150, cacheWrite: 3600, cacheRead: 3700 })
    ).toBeCloseTo((90 * 4 + 150 * 20 + 3600 * 5 + 3700 * 0.2) / 1_000_000, 10);
  });

  it("puts the user's own prices before the built-in ones, by service and model", () => {
    const provider = providerFor({
      ...DEFAULT_SETTINGS,
      prices: { 'anthropic/claude-opus-5-5': DOUBLE, 'openai/gpt-6.1-terra': OPUS },
    });
    expect(provider.ok && provider.value.priceKey).toBe('anthropic/claude-opus-5-5');
    expect(provider.ok && provider.value.prices).toEqual({ source: 'own', ...DOUBLE });
    expect(provider.ok && provider.value.builtIn).toEqual(OPUS);
    expect(provider.ok && provider.value.inputCost(1_000_000)).toBe(8);
    const plain = providerFor(DEFAULT_SETTINGS);
    expect(plain.ok && plain.value.prices).toEqual({ source: 'built-in', ...OPUS });
    // A compatible server is known by its host: the same model name elsewhere is another price.
    const local = providerFor({
      ...DEFAULT_SETTINGS,
      provider: 'compatible',
      compatible: { baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', structured: 'prompt' },
      prices: {
        'localhost:11434/qwen3:8b': { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
    });
    expect(local.ok && local.value.priceKey).toBe('localhost:11434/qwen3:8b');
    expect(local.ok && local.value.prices?.source).toBe('own');
    expect(local.ok && local.value.builtIn).toBeNull();
  });
});

describe("ASSIST-009 the prices behind the estimates are the user's to set", () => {
  it('starts from the built-in prices of the chosen model and says when they were recorded', async () => {
    const running = await started();
    const first = await status(running);
    expect(first).toMatchObject({
      model: 'claude-opus-5-5',
      priceKnown: true,
      prices: { source: 'built-in', ...OPUS },
      builtInPrices: OPUS,
      pricesRecorded: PRICES_RECORDED,
    });
    expect(first.pricesRecorded).toBe('November 2026');
    const sonnet = await running.invoke<AiStatus>('ai-assist:setModel', {
      model: 'claude-sonnet-5-5',
    });
    expect(sonnet.prices).toEqual({
      source: 'built-in',
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
    });
  });

  it("estimates with the user's own prices once they are set, per model, and goes back to the built-in ones on reset", async () => {
    const running = await started();
    const before = await prepare(running, 'Which setups are there?');
    expect(before.prices).toBe('built-in');
    await running.invoke('ai-assist:assistantDiscard', { requestId: before.requestId });

    const own = await setPrices(running, DOUBLE);
    expect(own.prices).toEqual({ source: 'own', ...DOUBLE });
    // The built-in ones are still there to compare with and to go back to.
    expect(own.builtInPrices).toEqual(OPUS);
    expect(running.events.at(-1)!.channel).toBe('ai-assist:event:settingsChanged');

    reply(running, text('One setup.'));
    const after = await prepare(running, 'Which setups are there?');
    expect(after.prices).toBe('own');
    expect(after.approxCost).toBeCloseTo(before.approxCost! * 2, 10);
    const sent = await send(running, after.requestId);
    // 100,000 in at $8 and 500 out at $40 a million: twice what the built-in prices give.
    expect(sent.conversation.usage.question).toMatchObject({ prices: 'own' });
    expect(sent.conversation.usage.question.cost).toBeCloseTo(0.82, 10);
    expect((await status(running)).month.spent).toBeCloseTo(0.82, 10);

    // Own prices belong to the model they were typed for.
    const sonnet = await running.invoke<AiStatus>('ai-assist:setModel', {
      model: 'claude-sonnet-5-5',
    });
    expect(sonnet.prices?.source).toBe('built-in');
    const back = await running.invoke<AiStatus>('ai-assist:setModel', {
      model: 'claude-opus-5-5',
    });
    expect(back.prices).toEqual({ source: 'own', ...DOUBLE });

    const reset = await running.invoke<AiStatus>('ai-assist:resetPrices');
    expect(reset.prices).toEqual({ source: 'built-in', ...OPUS });
    const again = await prepare(running, 'And now?');
    expect(again.prices).toBe('built-in');
  });

  it('shows no dollar figure and applies no limit for a model without prices, until the user enters them', async () => {
    const running = await started();
    await running.invoke('ai-assist:setMonthlyBudget', { dollars: 1, acknowledged: true });
    const unknown = await running.invoke<AiStatus>('ai-assist:setModel', {
      model: 'a-model-nobody-priced',
    });
    expect(unknown).toMatchObject({ priceKnown: false, prices: null, builtInPrices: null });
    const bare = await prepare(running, 'Hello');
    expect(bare).toMatchObject({
      approxCost: null,
      prices: null,
      spent: null,
      ceiling: null,
      overCeiling: false,
      month: null,
    });
    await running.invoke('ai-assist:assistantDiscard', { requestId: bare.requestId });

    const typed = await setPrices(running, { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 });
    expect(typed).toMatchObject({
      priceKnown: true,
      prices: { source: 'own', input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
      builtInPrices: null,
    });
    const priced = await prepare(running, 'Hello');
    expect(priced).toMatchObject({ prices: 'own', spent: 0, ceiling: 0.25 });
    expect(priced.approxCost).toBeGreaterThan(0);
    expect(priced.month).toMatchObject({ budget: 1, state: 'ok' });

    // Reset where there are no built-in prices is back to none.
    const none = await running.invoke<AiStatus>('ai-assist:resetPrices');
    expect(none).toMatchObject({ priceKnown: false, prices: null });
  });

  it('does not send a request that was shown at other prices: its estimate no longer holds', async () => {
    const running = await started();
    reply(running, text('One setup.'));
    const shown = await prepare(running, 'Which setups are there?');
    await setPrices(running, DOUBLE);
    await expect(send(running, shown.requestId)).rejects.toThrow(
      /ai\.changed.*The prices were changed in Settings/
    );
    expect(running.ports.http.calls).toHaveLength(0);
    // It can never be sent as shown again, so it is gone: the message is sent anew.
    await expect(send(running, shown.requestId)).rejects.toThrow(/ai\.expired/);
    const anew = await prepare(running, 'Which setups are there?');
    await send(running, anew.requestId);
    expect(running.ports.http.calls).toHaveLength(1);
  });

  it('refuses a price that is not a number from 0 to 10,000, and keeps the prices it had', async () => {
    const running = await started();
    for (const bad of [
      { ...DOUBLE, input: -1 },
      { ...DOUBLE, output: 10_001 },
      { ...DOUBLE, cacheRead: Number.NaN },
      { input: 8, output: 40, cacheRead: 0.4 },
    ]) {
      await expect(running.invoke('ai-assist:setPrices', bad)).rejects.toThrow();
    }
    expect((await status(running)).prices).toEqual({ source: 'built-in', ...OPUS });
    // Free is a price too: a model the user pays nothing for is estimated at $0.
    const free = await setPrices(running, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(free.prices).toMatchObject({ source: 'own', input: 0, output: 0 });
    // Kept to a millionth of a dollar.
    const fine = await setPrices(running, { ...DOUBLE, input: 0.123456789 });
    expect(fine.prices?.input).toBe(0.123457);
  });
});

describe('ASSIST-008 every dollar figure is an estimate that says where its prices came from', () => {
  it('gives the source of the prices with every estimate the assistant shows', async () => {
    const running = await started();
    const small = { input_tokens: 1000, output_tokens: 100 };
    reply(running, [use('tu1')], 'tool_use', small);
    reply(running, text('One setup.'), 'end_turn', small);
    const first = await prepare(running, 'Which setups are there?');
    expect(first.approxCost).toBeGreaterThan(0);
    expect(first.prices).toBe('built-in');
    const one = await send(running, first.requestId);
    expect(one.next).toMatchObject({ prices: 'built-in' });
    const done = await send(running, one.next!.requestId);
    expect(done.conversation.usage).toMatchObject({
      prices: 'built-in',
      question: { prices: 'built-in', requests: 2 },
    });
    const told = running.events
      .filter((e) => e.channel === 'ai-assist:event:assistantProgress')
      .map((e) => e.payload as AssistantProgress);
    // Before anything of a question is estimated there is no figure, so no source either.
    expect(told[0]).toMatchObject({ phase: 'asking', round: 1, prices: null });
    expect(told[1]).toMatchObject({ phase: 'tool', prices: 'built-in' });
    expect(told[1]!.cost).toBeGreaterThan(0);
  });

  it('gives the source with the estimates of the binding guide too', async () => {
    app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
    await app.invoke('settings:setAiKey', { key: KEY });
    // A question about the bindings is answered whole, not streamed.
    app.ports.http.respond('/v1/messages', {
      json: {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'You have no hook bound.' }],
        usage: USAGE,
      },
    });
    const ask = (): Promise<Prepared> =>
      app!.invoke<Prepared>('ai-assist:prepare', {
        aircraftId: HORNET,
        kind: 'ask',
        question: 'What am I missing for carrier landings?',
      });
    const built = await ask();
    expect(built.approxCost).toBeGreaterThan(0);
    expect(built.prices).toBe('built-in');
    const sent = await app.invoke<Sent>('ai-assist:send', { requestId: built.requestId });
    expect(sent.usage).toMatchObject({ prices: 'built-in' });
    expect(sent.usage.cost).toBeCloseTo(0.41, 10);

    await app.invoke('ai-assist:setPrices', DOUBLE);
    const own = await ask();
    expect(own.prices).toBe('own');
    expect(own.approxCost).toBeCloseTo(built.approxCost! * 2, 10);
    const again = await app.invoke<Sent>('ai-assist:send', { requestId: own.requestId });
    expect(again.usage).toMatchObject({ prices: 'own' });
    expect(again.usage.cost).toBeCloseTo(0.82, 10);
  });

  it('says mixed for a sum over requests estimated at built-in and at own prices', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0 });
    reply(running, [use('tu1')], 'tool_use');
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    const one = await send(running, first.requestId);
    expect(one.conversation.usage.question).toMatchObject({ prices: 'built-in' });

    // The prices change in the middle of the question: the request that waited is built again.
    await setPrices(running, DOUBLE);
    await expect(send(running, one.next!.requestId)).rejects.toThrow(/ai\.changed/);
    const rebuilt = await running.invoke<TurnPreview>('ai-assist:assistantResume', {
      conversationId: first.conversationId,
    });
    expect(rebuilt.prices).toBe('own');
    const done = await send(running, rebuilt.requestId);
    expect(done.conversation.usage.question).toMatchObject({ requests: 2, prices: 'mixed' });
    // $0.41 at the built-in prices and $0.82 at the user's own.
    expect(done.conversation.usage.question.cost).toBeCloseTo(1.23, 10);
  });

  it('stops at the ceiling in words that say it stopped on the estimate, not on a bill', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0.1, acknowledged: true });
    reply(running, [use('tu1')], 'tool_use');
    const first = await prepare(running, 'Which setups are there?');
    const one = await send(running, first.requestId);
    expect(one.next).toMatchObject({ overCeiling: true, prices: 'built-in' });
    const stopped = send(running, one.next!.requestId);
    await expect(stopped).rejects.toThrow(/ai\.ceiling/);
    await expect(send(running, one.next!.requestId)).rejects.toThrow(
      /Stopped on RigReady's estimate, not on a bill: this question is estimated at \$0\.41 so far, and the next request would take the estimate past \$0\.10, the most one question may reach before RigReady asks you\. Nothing was sent\./
    );
    expect(running.ports.http.calls).toHaveLength(1);
  });
});
