import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { AI_KEY_SECRET } from '../../../core/settings';
import { HttpStreamScriptSchema } from '../../../platform/fake/scenario';
import { onMachineChanged } from '../../../renderer/machine';
import { useAssistantStore } from './assistantStore';

/**
 * The assistant panel's store on the whole wired app: the real client, the real channels and
 * the real assistant behind them, with the provider played by the fake Http port. What the
 * panel shows after every way a request can fail or be dropped is pinned here: a Send button
 * is never left on screen for a request that can only fail, the message is never lost, and
 * trying again is one press. The key is a made-up string; nothing leaves the fake port.
 */

const KEY = 'sk-ant-unit-NOT-A-REAL-KEY-0000-abcd';
const QUESTION = 'Is TrackIR a required step for launching the F/A-18C setup?';
const MESSAGES = { url: 'api.anthropic.com/v1/messages', method: 'POST' } as const;

let app: WiredApp | undefined;
let offMachine: (() => void) | undefined;
let machineChanges = 0;

/** The window's bridge, onto the wired app: what the preload script is in the real window. */
async function started(scenario = 'flying-all-good'): Promise<WiredApp> {
  const running = await wiredApp(scenario);
  app = running;
  await running.ports.secrets.set(AI_KEY_SECRET, KEY);
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const push = running.events.push.bind(running.events);
  running.events.push = (...sent) => {
    for (const event of sent) {
      for (const listener of listeners.get(event.channel) ?? []) listener(event.payload);
    }
    return push(...sent);
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      rigready: {
        invoke: async (channel: string, input: unknown) => {
          const handler = running.wiring.handlers.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler(input);
        },
        on: (channel: string, listener: (payload: unknown) => void) => {
          const set = listeners.get(channel) ?? new Set();
          listeners.set(channel, set);
          set.add(listener);
          return () => set.delete(listener);
        },
      },
    },
  });
  return running;
}

/** The store, subscribed the way the bar's button subscribes it. */
function panel(): ReturnType<typeof useAssistantStore> {
  const store = useAssistantStore();
  store.api.on('settingsChanged', () => void store.settingsChanged());
  store.api.on('assistantProgress', (now) => store.onProgress(now));
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  machineChanges = 0;
  offMachine = onMachineChanged(() => {
    machineChanges += 1;
  });
});

afterEach(async () => {
  offMachine?.();
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
  Reflect.deleteProperty(globalThis, 'window');
});

function reply(
  running: WiredApp,
  content: unknown[],
  stop = 'end_turn',
  usage = { input_tokens: 900, output_tokens: 80 }
): void {
  running.ports.http.scripts.push({
    match: MESSAGES,
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

function refuse(running: WiredApp, status: number, type: string, message: string): void {
  running.ports.http.scripts.push({
    match: MESSAGES,
    times: 1,
    response: {
      status,
      headers: { 'request-id': 'req_unit_0001' },
      json: { type: 'error', error: { type, message }, request_id: 'req_unit_0001' },
    },
  });
}

/** An answer that never comes, until the request is stopped. */
function hang(running: WiredApp): void {
  running.ports.http.scripts.push({
    match: MESSAGES,
    times: 1,
    response: {
      status: 200,
      headers: {},
      stream: HttpStreamScriptSchema.parse({ chunks: [], end: 'hang' }),
    },
  });
}

const text = (said: string): unknown[] => [{ type: 'text', text: said }];
const use = (id: string, name: string, input: unknown = {}): unknown => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const sentRequests = (running: WiredApp): number =>
  running.ports.http.calls.filter((call) => call.url.includes('/v1/messages')).length;
const kinds = (store: ReturnType<typeof useAssistantStore>): string[] =>
  (store.conversation?.entries ?? []).map((entry) => entry.kind);

/** Sends a request straight to main, as nothing in the panel does: the answer's error code. */
async function codeOfSend(running: WiredApp, requestId: string): Promise<string | undefined> {
  const envelope = await running.wiring.handlers.get('ai-assist:assistantSend')!({ requestId });
  return envelope.ok ? undefined : envelope.error.code;
}

describe('ASSIST-001 the panel after a request failed or was dropped', () => {
  it('a refused send leaves the message, the error and a button that works: trying again is one press', async () => {
    const running = await started();
    const store = panel();
    refuse(running, 401, 'authentication_error', 'invalid x-api-key');
    store.edit(QUESTION);
    expect(await store.prepare()).toBe(true);
    const shown = store.preview;
    expect(shown?.text).toBe(QUESTION);
    // The message stays in the box while its request waits.
    expect(store.draft).toBe(QUESTION);

    await store.send();
    expect(store.error).toBeTruthy();
    expect(store.error).not.toMatch(/no longer ready/);
    expect(store.failed).toBe(true);
    expect(store.sending).toBe(false);
    // Nothing was lost: the message is back in the box and the same request is still ready.
    expect(store.draft).toBe(QUESTION);
    expect(store.preview?.requestId).toBe(shown?.requestId);
    expect(store.conversation).toBeUndefined();

    reply(running, text('It is not.'));
    await store.send();
    expect(store.error).toBeUndefined();
    expect(store.failed).toBe(false);
    expect(kinds(store)).toEqual(['user', 'assistant']);
    expect(store.preview).toBeUndefined();
    expect(store.draft).toBe('');
    expect(sentRequests(running)).toBe(2);
  });

  it('the scenario the window test plays: refused once, answered on the next press, counted once', async () => {
    // fixtures/scenarios/assistant-refused.yaml scripts the provider: a 401, then an answer.
    const running = await started('assistant-refused');
    const store = panel();
    store.edit(QUESTION);
    await store.prepare();
    await store.send();
    expect(store.error).toMatch(/did not accept the API key/);
    expect(store.failed).toBe(true);
    expect(store.draft).toBe(QUESTION);
    expect(store.preview).toBeDefined();

    // Closing the panel changes nothing: the same request is still the one that waits.
    store.open = false;
    store.open = true;
    expect(store.failed).toBe(true);
    await store.send();
    expect(store.error).toBeUndefined();
    expect(store.draft).toBe('');
    const said = store.conversation?.entries.at(-1);
    expect(said?.kind).toBe('assistant');
    expect(said?.kind === 'assistant' ? said.text : '').toContain('**TrackIR** is a check');
    // The refused request cost nothing and is not counted: one request was answered.
    expect(store.conversation?.usage.requests).toBe(1);
    expect(sentRequests(running)).toBe(2);
  });

  it('a new key stored in Settings clears the old failure and makes the request ready again, also with the panel closed', async () => {
    const running = await started();
    const store = panel();
    refuse(running, 401, 'authentication_error', 'invalid x-api-key');
    store.edit(QUESTION);
    await store.prepare();
    await store.send();
    const failed = store.preview?.requestId;
    expect(store.error).toBeTruthy();
    store.open = false;

    await store.api.setKey({ key: `${KEY}-new` });
    await vi.waitFor(() => {
      expect(store.preview).toBeDefined();
      expect(store.preview?.requestId).not.toBe(failed);
    });
    expect(store.error).toBeUndefined();
    expect(store.failed).toBe(false);
    expect(store.draft).toBe(QUESTION);
    // The request it replaced is gone in RigReady too: nothing is left behind.
    expect(await codeOfSend(running, failed!)).toBe('ai.expired');

    store.open = true;
    reply(running, text('It is not.'));
    await store.send();
    expect(kinds(store)).toEqual(['user', 'assistant']);
    expect(store.error).toBeUndefined();
  });

  it('with no provider ready any more, the request goes and the message stays', async () => {
    const running = await started();
    const store = panel();
    store.edit(QUESTION);
    await store.prepare();
    const shown = store.preview!.requestId;
    await store.api.clearKey();
    await vi.waitFor(() => expect(store.preview).toBeUndefined());
    expect(store.keyPresent).toBe(false);
    expect(store.draft).toBe(QUESTION);
    expect(await codeOfSend(running, shown)).toBe('ai.expired');
  });

  it('a request made for other settings is made ready again and shown, never sent by itself', async () => {
    const running = await started();
    // The page did not hear of the change: Send is pressed on a request main will refuse.
    const store = useAssistantStore();
    store.edit(QUESTION);
    await store.prepare();
    const first = store.preview!;
    store.skipPreview = true;
    await running.wiring.handlers.get('ai-assist:setModel')!({ model: 'claude-sonnet-5-5' });

    await store.send();
    expect(sentRequests(running)).toBe(0);
    expect(store.error).toBeUndefined();
    expect(store.notice).toMatch(/made ready again for .*Nothing was sent/);
    expect(store.preview?.requestId).not.toBe(first.requestId);
    expect(store.preview?.model).toBe('claude-sonnet-5-5');
    expect(store.preview?.text).toBe(QUESTION);
    expect(store.draft).toBe(QUESTION);
    expect(store.sending).toBe(false);
    // The tick stays with the conversation the message is in.
    expect(store.skipPreview).toBe(true);

    reply(running, text('It is not.'));
    await store.send();
    expect(kinds(store)).toEqual(['user', 'assistant']);
    expect(store.notice).toBeUndefined();
  });

  it('a request RigReady no longer holds is made ready again, for tool answers too', async () => {
    const running = await started();
    const store = useAssistantStore();
    store.edit(QUESTION);
    await store.prepare();
    const lost = store.preview!.requestId;
    // Thrown away behind the page's back, with the conversation nothing was sent in.
    await running.wiring.handlers.get('ai-assist:assistantDiscard')!({ requestId: lost });
    await store.send();
    expect(sentRequests(running)).toBe(0);
    expect(store.notice).toMatch(/made ready again\. Nothing was sent/);
    expect(store.preview?.requestId).not.toBe(lost);
    expect(store.draft).toBe(QUESTION);

    reply(running, [use('tu1', 'setups_list')], 'tool_use');
    await store.send();
    expect(kinds(store)).toEqual(['user', 'tool']);
    const next = store.preview!;
    expect(next.text).toBeUndefined();
    await running.wiring.handlers.get('ai-assist:assistantDiscard')!({ requestId: next.requestId });
    await store.send();
    expect(sentRequests(running)).toBe(1);
    expect(store.preview?.requestId).not.toBe(next.requestId);
    expect(store.preview?.round).toBe(2);
    reply(running, text('One setup.'));
    await store.send();
    expect(kinds(store)).toEqual(['user', 'tool', 'assistant']);
  });

  it('the request shown is always the message in the box: an edit takes it away, in RigReady too', async () => {
    const running = await started();
    const store = panel();
    store.edit(QUESTION);
    await store.prepare();
    const shown = store.preview!.requestId;
    store.edit(`${QUESTION} `);
    // The same message, a space more: still the request shown.
    expect(store.preview?.requestId).toBe(shown);
    store.edit('Something else');
    expect(store.preview).toBeUndefined();
    await vi.waitFor(async () => expect(await codeOfSend(running, shown)).toBe('ai.expired'));

    // "Don't send" keeps the message and throws the request away.
    await store.prepare();
    const second = store.preview!.requestId;
    await store.drop();
    expect(store.preview).toBeUndefined();
    expect(store.draft).toBe('Something else');
    expect(await codeOfSend(running, second)).toBe('ai.expired');
    expect(sentRequests(running)).toBe(0);
  });

  it('Enter a second time sends what is shown', async () => {
    const running = await started();
    const store = panel();
    reply(running, text('It is not.'));
    store.edit(QUESTION);
    await store.prepare();
    expect(sentRequests(running)).toBe(0);
    await store.prepare();
    expect(sentRequests(running)).toBe(1);
    expect(kinds(store)).toEqual(['user', 'assistant']);
    // An empty box prepares nothing.
    expect(await store.prepare()).toBe(false);
    expect(store.preview).toBeUndefined();
  });
});

describe('ASSIST-001 "Don\'t show this again for this conversation"', () => {
  it('belongs to one conversation: a failed first send, a dropped request or a new conversation never carries it over', async () => {
    const running = await started();
    const store = panel();
    // A first send that fails with the tick set, then the request is dropped.
    refuse(running, 401, 'authentication_error', 'invalid x-api-key');
    store.edit(QUESTION);
    await store.prepare();
    store.skipPreview = true;
    expect(store.skipPreview).toBe(true);
    await store.send();
    expect(store.failed).toBe(true);
    await store.drop();
    expect(store.skipPreview).toBe(false);

    // The same message again begins another conversation: the tick is not set there.
    await store.prepare();
    expect(store.preview).toBeDefined();
    expect(store.skipPreview).toBe(false);
    expect(sentRequests(running)).toBe(1);

    // Set in a conversation, it holds for that conversation.
    store.skipPreview = true;
    reply(running, text('It is not.'));
    await store.send();
    reply(running, text('Yes.'));
    store.edit('Are you sure?');
    await store.prepare();
    expect(kinds(store)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(store.preview).toBeUndefined();

    await store.newConversation();
    expect(store.skipPreview).toBe(false);
    expect(store.conversation).toBeUndefined();
    store.edit(QUESTION);
    await store.prepare();
    expect(store.skipPreview).toBe(false);
    expect(store.preview).toBeDefined();
    expect(sentRequests(running)).toBe(3);
  });
});

describe('ASSIST-001 while the assistant works', () => {
  it('says which tool runs and shows the conversation so far; a tool that only read changes no screen', async () => {
    const running = await started();
    const store = panel();
    const host = running.wiring.context.mcp.host()!;
    const listed = await host.call(
      { id: 'unit', name: 'Unit test', signal: new AbortController().signal },
      'setups_list',
      {}
    );
    const setup = (listed as { value: { setups: { id: string }[] } }).value.setups[0]!.id;

    reply(running, [use('tu1', 'setups_list')], 'tool_use');
    store.edit('Make my setup ready');
    await store.prepare();
    await store.send();
    expect(kinds(store)).toEqual(['user', 'tool']);
    expect(machineChanges).toBe(0);

    // A change is asked in the window first: while it waits, the panel shows where it is.
    reply(
      running,
      [{ type: 'text', text: 'I will make it ready.' }, use('tu2', 'rig_make_ready', { setup })],
      'tool_use'
    );
    const asked = running.events.length;
    const sending = store.send();
    await vi.waitFor(() =>
      expect(running.events.slice(asked).some((e) => e.channel === 'mcp:event:confirm')).toBe(true)
    );
    await vi.waitFor(() => expect(kinds(store)).toEqual(['user', 'tool', 'assistant']));
    expect(store.sending).toBe(true);
    expect(store.progress).toMatchObject({ phase: 'tool', round: 2 });
    expect(store.progress?.tool).toBeTruthy();
    expect(store.pendingText).toBeUndefined();

    const confirm = running.events.slice(asked).find((e) => e.channel === 'mcp:event:confirm')!;
    await running.wiring.handlers.get('mcp:answer')!({
      id: (confirm.payload as { id: string }).id,
      allow: false,
    });
    await sending;
    expect(store.sending).toBe(false);
    expect(store.progress).toBeUndefined();
    expect(kinds(store)).toEqual(['user', 'tool', 'assistant', 'tool']);
    // The call was a change, run or not: the screens that show the rig read it again.
    expect(machineChanges).toBe(1);
  });

  it('shows the message as on its way until it is taken, and Stop ends the wait with nothing lost', async () => {
    const running = await started();
    const store = panel();
    hang(running);
    store.edit(QUESTION);
    await store.prepare();
    const shown = store.preview!.requestId;
    const sending = store.send();
    await vi.waitFor(() => expect(store.progress).toMatchObject({ phase: 'asking', round: 1 }));
    expect(store.sending).toBe(true);
    expect(store.pendingText).toBe(QUESTION);
    expect(store.draft).toBe('');

    await store.stop();
    await sending;
    expect(store.sending).toBe(false);
    expect(store.error).toBeUndefined();
    expect(store.failed).toBe(false);
    expect(store.notice).toMatch(/Stopped/);
    expect(store.pendingText).toBeUndefined();
    expect(store.draft).toBe(QUESTION);
    expect(store.preview?.requestId).toBe(shown);

    reply(running, text('It is not.'));
    await store.send();
    expect(kinds(store)).toEqual(['user', 'assistant']);
  });

  it('with the tick set, requests follow each other until Stop; what the tools answered waits for Continue', async () => {
    const running = await started();
    const store = panel();
    reply(running, [use('tu1', 'setups_list')], 'tool_use');
    reply(running, [use('tu2', 'setups_list')], 'tool_use');
    hang(running);
    store.edit('Which setups are there?');
    await store.prepare();
    store.skipPreview = true;
    const sending = store.send();
    await vi.waitFor(() => expect(store.progress).toMatchObject({ phase: 'asking', round: 3 }));
    expect(sentRequests(running)).toBe(3);
    await store.stop();
    await sending;
    expect(store.notice).toMatch(/Stopped/);
    expect(kinds(store)).toEqual(['user', 'tool', 'tool']);
    // The third request is still ready; dropped, the tool answers wait for Continue.
    expect(store.preview?.round).toBe(3);
    await store.drop();
    expect(store.canResume).toBe(true);
    store.skipPreview = false;
    await store.resume();
    expect(store.preview?.round).toBe(3);
    expect(store.canResume).toBe(false);
    reply(running, text('One setup.'));
    await store.send();
    expect(kinds(store)).toEqual(['user', 'tool', 'tool', 'assistant']);
  });

  it('never goes past the ceiling by itself: it stops, says so, and goes on only on the press', async () => {
    const running = await started();
    const store = panel();
    await store.api.setQuestionCeiling({ dollars: 0.05, acknowledged: true });
    // A first answer that cost more than the ceiling by itself: about 12 cents.
    reply(running, [use('tu1', 'setups_list')], 'tool_use', {
      input_tokens: 20_000,
      output_tokens: 2000,
    });
    store.edit('Which setups are there?');
    await store.prepare();
    expect(store.preview?.overCeiling).toBe(false);
    store.skipPreview = true;
    await store.send();
    // The next request would pass the ceiling: it waits, tick or no tick.
    expect(sentRequests(running)).toBe(1);
    expect(store.preview?.overCeiling).toBe(true);
    expect(store.preview?.spent).toBeGreaterThan(0.05);
    expect(store.sending).toBe(false);
    await store.send();
    expect(sentRequests(running)).toBe(1);

    reply(running, text('One setup.'));
    await store.send(true);
    expect(sentRequests(running)).toBe(2);
    expect(kinds(store)).toEqual(['user', 'tool', 'assistant']);
  });

  it('a ceiling below one request holds the very first one, before anything is sent', async () => {
    const running = await started();
    const store = panel();
    await store.api.setQuestionCeiling({ dollars: 0.01, acknowledged: true });
    store.edit(QUESTION);
    await store.prepare();
    expect(store.preview?.overCeiling).toBe(true);
    store.skipPreview = true;
    await store.send();
    // Enter in the box is no way round it either.
    await store.prepare();
    expect(sentRequests(running)).toBe(0);
    expect(store.draft).toBe(QUESTION);

    reply(running, text('It is not.'));
    await store.send(true);
    expect(sentRequests(running)).toBe(1);
    expect(kinds(store)).toEqual(['user', 'assistant']);
  });

  it('a new conversation while a request is on its way ends it and takes nothing from it', async () => {
    const running = await started();
    const store = panel();
    hang(running);
    store.edit(QUESTION);
    await store.prepare();
    const sending = store.send();
    await vi.waitFor(() => expect(store.progress).toMatchObject({ phase: 'asking' }));
    await store.newConversation();
    await sending;
    expect(store.sending).toBe(false);
    expect(store.conversation).toBeUndefined();
    expect(store.preview).toBeUndefined();
    expect(store.error).toBeUndefined();
    expect(store.notice).toBeUndefined();

    reply(running, text('It is not.'));
    store.edit(QUESTION);
    await store.prepare();
    await store.send();
    expect(kinds(store)).toEqual(['user', 'assistant']);
  });
});

/** An answer estimated at 12 cents at the built-in prices of Opus 5.5: $0.08 in, $0.04 out. */
const TWELVE_CENTS = { input_tokens: 20_000, output_tokens: 2000 };
const OWN_PRICES = { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10 };

describe('ASSIST-007 the panel at the monthly budget', () => {
  it('does not make a message ready once the month is at its budget: nothing is sent, the reason says it stopped on the estimate, and the message stays', async () => {
    const running = await started();
    const store = panel();
    await store.api.setMonthlyBudget({ dollars: 0.1, acknowledged: true });
    reply(running, text('Two setups.'), 'end_turn', TWELVE_CENTS);
    store.edit('Which setups are there?');
    await store.prepare();
    await store.send();
    expect(sentRequests(running)).toBe(1);

    store.edit(QUESTION);
    expect(await store.prepare()).toBe(false);
    expect(store.preview).toBeUndefined();
    expect(store.error).toMatch(/^Stopped on RigReady's estimate, not on a bill: /);
    expect(store.error).toMatch(
      /estimated at \$0\.12, which reaches your monthly budget of \$0\.10/
    );
    expect(store.error).toMatch(/Nothing was sent\./);
    expect(store.error).toMatch(/What you are charged is in your provider's console\./);
    // Not a failure of the provider: no "Try again" for something that cannot go.
    expect(store.failed).toBe(false);
    expect(store.draft).toBe(QUESTION);
    expect(sentRequests(running)).toBe(1);

    // Turned off in Settings: the old reason goes, and the message can be made ready.
    await store.api.setMonthlyBudget({ dollars: 0 });
    await vi.waitFor(() => expect(store.error).toBeUndefined());
    reply(running, text('It is not.'));
    expect(await store.prepare()).toBe(true);
    await store.send();
    expect(sentRequests(running)).toBe(2);
    expect(kinds(store)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('warns in the request when the month is close, keeps a request ready that Send could not take, and sends it once the budget is raised', async () => {
    const running = await started();
    // The page does not hear of the changes made behind it here.
    const store = useAssistantStore();
    await store.api.setMonthlyBudget({ dollars: 0.14, acknowledged: true });
    reply(running, text('Two setups.'), 'end_turn', TWELVE_CENTS);
    store.edit('Which setups are there?');
    await store.prepare();
    expect(store.preview?.month).toMatchObject({ state: 'ok', budget: 0.14, spent: 0 });
    await store.send();

    // 12 of 14 cents: the next request says so before it is sent.
    store.edit(QUESTION);
    await store.prepare();
    const shown = store.preview!;
    expect(shown.month).toMatchObject({ state: 'warn', budget: 0.14, requests: 1 });
    expect(shown.month?.spent).toBeCloseTo(0.12, 6);

    // The budget was lowered under it: Send is refused, on the estimate.
    await running.wiring.handlers.get('ai-assist:setMonthlyBudget')!({ dollars: 0.1 });
    await store.send();
    expect(sentRequests(running)).toBe(1);
    expect(store.error).toMatch(/^Stopped on RigReady's estimate, not on a bill: /);
    expect(store.failed).toBe(false);
    expect(store.preview?.requestId).toBe(shown.requestId);
    expect(store.draft).toBe(QUESTION);
    expect(store.sending).toBe(false);
    // Pressing again changes nothing while the budget stands.
    await store.send();
    expect(sentRequests(running)).toBe(1);

    // Raised in Settings: the request is made ready again and goes on the press.
    await running.wiring.handlers.get('ai-assist:setMonthlyBudget')!({ dollars: 5 });
    await store.settingsChanged();
    expect(store.error).toBeUndefined();
    expect(store.preview?.text).toBe(QUESTION);
    expect(store.preview?.month).toMatchObject({ state: 'ok', budget: 5 });
    reply(running, text('It is not.'));
    await store.send();
    expect(sentRequests(running)).toBe(2);
    expect(kinds(store)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });
});

describe('ASSIST-009 the panel when the prices are changed', () => {
  it('makes a request shown at other prices ready again with its new estimate, and never sends it by itself', async () => {
    const running = await started();
    // The page did not hear of the change: Send is pressed on an estimate that no longer holds.
    const store = useAssistantStore();
    store.edit(QUESTION);
    await store.prepare();
    const first = store.preview!;
    expect(first.prices).toBe('built-in');
    store.skipPreview = true;
    await running.wiring.handlers.get('ai-assist:setPrices')!(OWN_PRICES);

    await store.send();
    expect(sentRequests(running)).toBe(0);
    expect(store.error).toBeUndefined();
    expect(store.notice).toMatch(
      /^Settings were changed after this request was shown, so it was made ready again and its estimate worked out anew\. Nothing was sent/
    );
    expect(store.preview?.requestId).not.toBe(first.requestId);
    expect(store.preview?.prices).toBe('own');
    // Every price was doubled, so the estimate is twice what it was.
    expect(store.preview!.approxCost!).toBeCloseTo(first.approxCost! * 2, 6);
    expect(store.draft).toBe(QUESTION);

    reply(running, text('It is not.'));
    await store.send();
    expect(kinds(store)).toEqual(['user', 'assistant']);
    expect(store.conversation?.usage.prices).toBe('own');
  });

  it('works the estimate of the request on screen out again when Settings says the prices changed', async () => {
    const running = await started();
    const store = panel();
    store.edit(QUESTION);
    await store.prepare();
    const first = store.preview!;

    await store.api.setPrices(OWN_PRICES);
    await vi.waitFor(() => expect(store.preview?.prices).toBe('own'));
    expect(store.preview?.requestId).not.toBe(first.requestId);
    expect(store.notice).toBe(
      'The prices were changed in Settings: the estimate for this request was worked out again. Nothing was sent.'
    );
    expect(sentRequests(running)).toBe(0);

    // Back to the built-in prices: the estimate it had at first.
    await store.api.resetPrices();
    await vi.waitFor(() => expect(store.preview?.prices).toBe('built-in'));
    expect(store.preview!.approxCost!).toBeCloseTo(first.approxCost!, 9);
  });
});
