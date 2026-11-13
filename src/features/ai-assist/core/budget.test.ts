import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chatAnswer } from '../../../../tests/aiStream';
import { BINDING_FILES, HORNET } from '../../../../tests/dcsBindings';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { AI_KEY_SECRET } from '../../../core/settings';
import type { TurnOutcome, TurnPreview } from './assistantModel';
import { budgetState, budgetStopMessage, monthKey } from './budget';
import type { AiStatus, MonthBudget, Prepared, Sent } from './model';

/**
 * The monthly budget and the acknowledgement that turns a limit on, on the whole wired app:
 * the real service, the real assistant, the fake Http port and the test clock. The key is a
 * made-up string; nothing leaves the fake port.
 */

const KEY = 'sk-ant-unit-NOT-A-REAL-KEY-0000-abcd';
/** One answer estimated at $0.41 at the built-in prices of the default model ($4 in, $20 out). */
const BIG = { input_tokens: 100_000, output_tokens: 500 };
const DAY = 24 * 60 * 60_000;

let app: WiredApp | undefined;

afterEach(async () => {
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
});

/** The assistant's scenario, with a key. */
async function started(): Promise<WiredApp> {
  app = await wiredApp('flying-all-good');
  await app.ports.secrets.set(AI_KEY_SECRET, KEY);
  return app;
}

/** The binding guide's scenario, with a key. */
async function guide(): Promise<WiredApp> {
  app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
  await app.invoke('settings:setAiKey', { key: KEY });
  return app;
}

/** One scripted answer of the Messages API to the assistant, used once, in order. */
function reply(running: WiredApp, content: unknown[], stop = 'end_turn', usage = BIG): void {
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
const send = (running: WiredApp, requestId: string): Promise<TurnOutcome> =>
  running.invoke<TurnOutcome>('ai-assist:assistantSend', { requestId });
const status = (running: WiredApp): Promise<AiStatus> =>
  running.invoke<AiStatus>('ai-assist:status');
const budget = (running: WiredApp, dollars: number, acknowledged = false): Promise<AiStatus> =>
  running.invoke<AiStatus>('ai-assist:setMonthlyBudget', { dollars, acknowledged });
const settingsFile = (running: WiredApp, name: string): string =>
  path.join(running.home, '.rigready', 'ai-assist', name);

describe('the rule of the monthly budget', () => {
  it('names the calendar month of this PC, and a month starts on its first day', () => {
    expect(monthKey(new Date(2026, 10, 12, 9, 30))).toBe('2026-11');
    expect(monthKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01');
    expect(monthKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12');
  });

  it('is off at 0, warns from 80 percent, and stops at the budget or before the request that would pass it', () => {
    expect(budgetState(0, 12)).toBe('off');
    expect(budgetState(10, 0)).toBe('ok');
    expect(budgetState(10, 7.99)).toBe('ok');
    expect(budgetState(10, 8)).toBe('warn');
    expect(budgetState(10, 7.5, 0.5)).toBe('warn');
    expect(budgetState(10, 9.99)).toBe('warn');
    expect(budgetState(10, 10)).toBe('stopped');
    expect(budgetState(10, 9.8, 0.3)).toBe('stopped');
    // A request that takes the month exactly to the budget still goes.
    expect(budgetState(10, 9.5, 0.5)).toBe('warn');
  });

  it('says it stopped on the estimate, never on a bill, and where the true figure is', () => {
    const month = (over: Partial<MonthBudget>): MonthBudget => ({
      budget: 5,
      month: '2026-11',
      spent: 5.2,
      requests: 40,
      unpriced: 0,
      state: 'stopped',
      ...over,
    });
    expect(budgetStopMessage(month({}))).toBe(
      "Stopped on RigReady's estimate, not on a bill: this month's requests are estimated at $5.20, which reaches your monthly budget of $5.00. Nothing was sent. You can raise the budget or turn it off in Settings under AI. What you are charged is in your provider's console."
    );
    expect(budgetStopMessage(month({ spent: 4.9 }))).toContain(
      "this month's requests are estimated at $4.90, and this one would take the estimate past your monthly budget of $5.00"
    );
    const unread = budgetStopMessage(month({ spent: 0, problem: 'spend.json is not valid JSON.' }));
    expect(unread).toContain("could not read its count of this month's estimates");
    expect(unread).toContain('spend.json is not valid JSON. Nothing was sent.');
  });
});

describe('ASSIST-007 a monthly budget on what RigReady estimates', () => {
  it('starts switched off and counts nothing against a limit until the user sets one', async () => {
    const running = await started();
    const before = await status(running);
    expect(before.month).toMatchObject({ budget: 0, state: 'off', spent: 0, requests: 0 });
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    expect(first.month).toMatchObject({ state: 'off' });
    await send(running, first.requestId);
    // What was answered is still counted, so a budget set later starts from the truth.
    const after = await status(running);
    expect(after.month).toMatchObject({ budget: 0, state: 'off', requests: 1 });
    expect(after.month.spent).toBeCloseTo(0.41, 5);
  });

  it('counts every answered request, warns from 80 percent, then stops and sends nothing', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0 });
    await budget(running, 1, true);
    reply(running, [use('tu1')], 'tool_use');
    reply(running, [use('tu2')], 'tool_use');
    reply(running, [use('tu3')], 'tool_use');
    const first = await prepare(running, 'Which setups are there?');
    expect(first.month).toMatchObject({ budget: 1, spent: 0, requests: 0, state: 'ok' });

    const one = await send(running, first.requestId);
    expect(one.next!.month).toMatchObject({ requests: 1, state: 'ok' });
    expect(one.next!.month!.spent).toBeCloseTo(0.41, 5);

    // 82 cents of the dollar: from 80 percent on, the request says so.
    const two = await send(running, one.next!.requestId);
    expect(two.next!.month).toMatchObject({ requests: 2, state: 'warn' });
    expect(two.next!.month!.spent).toBeCloseTo(0.82, 5);

    // $1.23 by the estimate. The answer is kept and shown; the next request is not made.
    const three = await send(running, two.next!.requestId);
    expect(three.next).toBeUndefined();
    const note = three.conversation.entries.at(-1)!;
    expect(note.kind).toBe('note');
    const said = note.kind === 'note' ? note.text : '';
    expect(said).toContain("Stopped on RigReady's estimate, not on a bill");
    expect(said).toContain(
      "this month's requests are estimated at $1.23, which reaches your monthly budget of $1.00"
    );
    expect(said).toContain('Nothing was sent.');
    expect(said).toContain('What the tools answered is kept');
    expect(running.ports.http.calls).toHaveLength(3);

    // Neither a new message nor Continue gets a request ready, and nothing goes out.
    await expect(prepare(running, 'And now?', first.conversationId)).rejects.toThrow(/ai\.budget/);
    await expect(
      running.invoke('ai-assist:assistantResume', { conversationId: first.conversationId })
    ).rejects.toThrow(/Stopped on RigReady's estimate, not on a bill/);
    await expect(prepare(running, 'A new conversation')).rejects.toThrow(/Nothing was sent/);
    expect(running.ports.http.calls).toHaveLength(3);
    expect((await status(running)).month).toMatchObject({
      budget: 1,
      requests: 3,
      state: 'stopped',
    });

    // The user raises the budget: what waited goes on.
    await budget(running, 5);
    reply(running, text('One setup.'));
    const resumed = await running.invoke<TurnPreview>('ai-assist:assistantResume', {
      conversationId: first.conversationId,
    });
    expect(resumed.month).toMatchObject({ budget: 5, state: 'ok' });
    await send(running, resumed.requestId);
    expect(running.ports.http.calls).toHaveLength(4);
    expect((await status(running)).month.requests).toBe(4);
  });

  it('checks again when a request that was shown is sent, and keeps it ready while the budget holds it', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0 });
    await budget(running, 1, true);
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    // A second conversation, shown while the month still had room.
    const waiting = await prepare(running, 'And which devices?');
    expect(waiting.month).toMatchObject({ state: 'ok' });
    await send(running, first.requestId);

    await budget(running, 0.3);
    await expect(send(running, waiting.requestId)).rejects.toThrow(
      /ai\.budget.*Stopped on RigReady's estimate, not on a bill/
    );
    expect(running.ports.http.calls).toHaveLength(1);

    // Switched off, the very same request goes.
    await budget(running, 0);
    reply(running, text('Four devices.'));
    const sent = await send(running, waiting.requestId);
    expect(sent.conversation.entries.at(-1)).toMatchObject({ text: 'Four devices.' });
    expect(running.ports.http.calls).toHaveLength(2);
  });

  it('holds the binding guide back as well, before a request is shown and again when it is sent', async () => {
    const running = await guide();
    await budget(running, 1, true);
    // A question about the bindings is answered whole, not streamed.
    running.ports.http.respond('/v1/messages', {
      json: {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'You have no hook bound.' }],
        usage: BIG,
      },
    });
    const ask = (): Promise<Prepared> =>
      running.invoke<Prepared>('ai-assist:prepare', {
        aircraftId: HORNET,
        kind: 'ask',
        question: 'What am I missing for carrier landings?',
      });
    const first = await ask();
    expect(first.month).toMatchObject({ budget: 1, spent: 0, state: 'ok' });
    const waiting = await ask();
    const sent = await running.invoke<Sent>('ai-assist:send', { requestId: first.requestId });
    expect(sent.usage.cost).toBeCloseTo(0.41, 5);
    const counted = (await status(running)).month;
    expect(counted).toMatchObject({ requests: 1, state: 'ok' });
    expect(counted.spent).toBeCloseTo(0.41, 5);

    await budget(running, 0.4);
    await expect(ask()).rejects.toThrow(
      /ai\.budget.*Stopped on RigReady's estimate, not on a bill.*Nothing was sent/
    );
    await expect(
      running.invoke('ai-assist:send', { requestId: waiting.requestId })
    ).rejects.toThrow(/ai\.budget/);
    expect(running.ports.http.calls).toHaveLength(1);

    // Raised again, the request that waited is still the one that goes.
    await budget(running, 2);
    await running.invoke<Sent>('ai-assist:send', { requestId: waiting.requestId });
    expect(running.ports.http.calls).toHaveLength(2);
    expect((await status(running)).month.requests).toBe(2);
  });

  it('says what the month is estimated at each time a request was counted, for the page that shows it', async () => {
    const running = await started();
    await budget(running, 1, true);
    const said = (): MonthBudget[] =>
      running.events
        .filter((event) => event.channel === 'ai-assist:event:monthChanged')
        .map((event) => event.payload as MonthBudget);
    expect(said()).toEqual([]);
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    expect(said()).toEqual([]);
    await send(running, first.requestId);
    expect(said()).toHaveLength(1);
    expect(said()[0]).toMatchObject({ budget: 1, requests: 1, unpriced: 0, state: 'ok' });
    expect(said()[0]!.spent).toBeCloseTo(0.41, 5);
    reply(running, text('It is not.'));
    const second = await prepare(running, 'Is TrackIR part of it?');
    await send(running, second.requestId);
    expect(said()).toHaveLength(2);
    expect(said()[1]).toMatchObject({ requests: 2, state: 'warn' });
    expect(said()[1]!.spent).toBeCloseTo(0.82, 5);
  });

  it('starts a new calendar month from nothing', async () => {
    const running = await started();
    await budget(running, 1, true);
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    await send(running, first.requestId);
    const october = (await status(running)).month;
    expect(october).toMatchObject({ month: '2026-10', requests: 1 });
    expect(october.spent).toBeCloseTo(0.41, 5);

    running.clock.advance(31 * DAY);
    expect((await status(running)).month).toMatchObject({
      month: '2026-11',
      budget: 1,
      spent: 0,
      requests: 0,
      state: 'ok',
    });
    // The first request of the new month is counted in the new month alone.
    reply(running, text('Still one.'));
    const next = await prepare(running, 'And now?');
    await send(running, next.requestId);
    const november = (await status(running)).month;
    expect(november).toMatchObject({ month: '2026-11', requests: 1 });
    expect(november.spent).toBeCloseTo(0.41, 5);
  });

  it('sends nothing it cannot count: an unreadable count stops it while a budget is set, and the budget can still be turned off', async () => {
    const running = await started();
    await budget(running, 1, true);
    await fs.writeFile(settingsFile(running, 'spend.json'), 'not json at all');
    const broken = (await status(running)).month;
    expect(broken).toMatchObject({ budget: 1, state: 'stopped' });
    expect(broken.problem).toContain('is not valid JSON');
    await expect(prepare(running, 'Which setups are there?')).rejects.toThrow(
      /ai\.budget.*could not read its count of this month's estimates.*Nothing was sent/
    );
    expect(running.ports.http.calls).toHaveLength(0);

    // Without a budget nothing depends on the count, so the assistant works again.
    const off = await budget(running, 0);
    expect(off.month).toMatchObject({ budget: 0, state: 'off' });
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    const sent = await send(running, first.requestId);
    expect(sent.conversation.entries.at(-1)).toMatchObject({ text: 'One setup.' });
    // The file that could not be read was not replaced behind the user's back.
    expect(await fs.readFile(settingsFile(running, 'spend.json'), 'utf8')).toBe('not json at all');
  });

  it('keeps requests without prices out of the estimate, and says how many there were', async () => {
    const running = await started();
    await budget(running, 1, true);
    await running.invoke('ai-assist:setModel', { model: 'a-model-nobody-priced' });
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    // No prices, so no dollar figure, no source to name, and no budget to hold it against.
    expect(first).toMatchObject({ approxCost: null, prices: null, month: null });
    await send(running, first.requestId);
    expect((await status(running)).month).toMatchObject({
      spent: 0,
      requests: 0,
      unpriced: 1,
      state: 'ok',
    });
  });

  it('does not count a server on this PC that was given no prices', async () => {
    const running = await guide();
    await running.invoke('ai-assist:setCompatible', { preset: 'ollama' });
    running.ports.http.respond(
      'localhost:11434/v1/chat/completions',
      chatAnswer('It drops bombs.', {
        model: 'qwen3:8b',
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      })
    );
    const asked = await running.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'explain',
      actionId: 'key:d3003pnilu3003cd13vd1vpnilvu0',
    });
    expect(asked).toMatchObject({ local: true, approxCost: null, prices: null, month: null });
    const sent = await running.invoke<Sent>('ai-assist:send', { requestId: asked.requestId });
    expect(sent.usage).toMatchObject({ cost: null, prices: null });
    expect((await status(running)).month).toMatchObject({ requests: 0, unpriced: 0 });
  });
});

describe('ASSIST-010 a limit is turned on only with an acknowledgement that it works on estimates', () => {
  it('refuses to turn the monthly budget on without it, changes nothing, and keeps when it was given', async () => {
    const running = await started();
    await expect(budget(running, 5)).rejects.toThrow(/ai\.acknowledge.*Nothing was changed/);
    const refused = await status(running);
    expect(refused.month).toMatchObject({ budget: 0, state: 'off' });
    expect(refused.acknowledged.monthlyBudget).toBeUndefined();

    const on = await budget(running, 5, true);
    expect(on.month).toMatchObject({ budget: 5, state: 'ok' });
    // The moment it was acknowledged, by the app's clock.
    expect(on.acknowledged.monthlyBudget).toBe(running.clock.now().toISOString());
    const kept = JSON.parse(await fs.readFile(settingsFile(running, 'settings.json'), 'utf8')) as {
      monthlyBudget: number;
      acknowledged: { monthlyBudget?: string };
    };
    expect(kept.monthlyBudget).toBe(5);
    expect(kept.acknowledged.monthlyBudget).toBe(on.acknowledged.monthlyBudget);

    // Another amount of a budget that is on is the same limit: no second acknowledgement.
    expect((await budget(running, 7.499)).month.budget).toBe(7.5);
    // Turned off and on again is turning it on: it is asked for again, and the time is the new one.
    expect((await budget(running, 0)).month).toMatchObject({ budget: 0, state: 'off' });
    await expect(budget(running, 7.5)).rejects.toThrow(/ai\.acknowledge/);
    running.clock.advance(60_000);
    const again = await budget(running, 7.5, true);
    expect(again.acknowledged.monthlyBudget).toBe(running.clock.now().toISOString());
    expect(again.acknowledged.monthlyBudget).not.toBe(on.acknowledged.monthlyBudget);
  });

  it('asks for it before the first amount the user sets as the ceiling of one question', async () => {
    const running = await started();
    const ceiling = (dollars: number, acknowledged = false): Promise<AiStatus> =>
      running.invoke<AiStatus>('ai-assist:setQuestionCeiling', { dollars, acknowledged });
    // The ceiling RigReady starts with was never set by the user, so nothing is acknowledged.
    const before = await status(running);
    expect(before.questionCeiling).toBe(0.25);
    expect(before.acknowledged.questionCeiling).toBeUndefined();

    await expect(ceiling(1)).rejects.toThrow(/ai\.acknowledge/);
    expect((await status(running)).questionCeiling).toBe(0.25);
    const set = await ceiling(1, true);
    expect(set.questionCeiling).toBe(1);
    expect(set.acknowledged.questionCeiling).toBe(running.clock.now().toISOString());
    // The acknowledgement of one limit is not that of the other.
    expect(set.acknowledged.monthlyBudget).toBeUndefined();
    expect((await ceiling(2)).questionCeiling).toBe(2);

    // Turning a limit off never needs it.
    expect((await ceiling(0)).questionCeiling).toBe(0);
    await expect(ceiling(2)).rejects.toThrow(/ai\.acknowledge/);
  });

  it('refuses an amount that is not one before it asks for anything', async () => {
    const running = await started();
    await expect(budget(running, 10_001, true)).rejects.toThrow(
      /ai\.amount.*between 0 and 10000 dollars\. 0 means no monthly budget\./
    );
    await expect(budget(running, -1, true)).rejects.toThrow();
    expect((await status(running)).month.budget).toBe(0);
  });
});
