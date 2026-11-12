import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { mayRunScript, runAsAssistant } from '../../../core/assistantScripts';
import { AI_KEY_SECRET } from '../../../core/settings';
import { HttpStreamScriptSchema } from '../../../platform/fake/scenario';
import { counted, lineOf, MAX_TOOL_RESULT } from './assistant';
import {
  type Drafts,
  type SavedScript,
  type TurnPreview,
  type ConversationView,
  type TurnOutcome,
} from './assistantModel';

/**
 * The built-in assistant on the whole wired app: the catalogue and gate it shares with the
 * MCP server, a scripted conversation with tool use, setup proposals and scripts with the
 * approval hash. The key is a made-up string; nothing leaves the fake Http port.
 */

const KEY = 'sk-ant-unit-NOT-A-REAL-KEY-0000-abcd';
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

const caller = { id: 'builtin-assistant', name: 'Built-in assistant' };
const signal = (): AbortSignal => new AbortController().signal;

/** Answers the next question the window would show. */
function answerNext(running: WiredApp, allow: boolean): void {
  const seen = running.events.length;
  const timer = setInterval(() => {
    const asked = running.events.slice(seen).find((e) => e.channel === 'mcp:event:confirm');
    if (!asked) return;
    clearInterval(timer);
    void running.invoke('mcp:answer', { id: (asked.payload as { id: string }).id, allow });
  }, 5);
}

const MESSAGES = { url: 'api.anthropic.com/v1/messages', method: 'POST' } as const;

/** One scripted answer of the Messages API, used once, in order. */
function reply(
  running: WiredApp,
  content: unknown[],
  stop = 'end_turn',
  usage: Record<string, number> = { input_tokens: 900, output_tokens: 80 }
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

/** One scripted refusal of the Messages API, used once. */
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
const tools = (view: ConversationView) =>
  view.entries.flatMap((entry) => (entry.kind === 'tool' ? [entry] : []));

/** Waits until something the test is not awaiting has happened. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !done(); i += 1) await new Promise((r) => setTimeout(r, 5));
  expect(done()).toBe(true);
}

describe('ASSIST-001 one gate for the built-in assistant and the MCP server', () => {
  it('offers the guided catalogue with the new tools and none of the channels kept from assistants', async () => {
    const running = await started();
    const host = running.wiring.context.mcp.host()!;
    const names = host.tools().map((t) => t.name);
    for (const name of [
      'rig_check',
      'rig_make_ready',
      'setups_list',
      'rigready_call',
      'rigready_channels',
      'programs_find',
      'setup_propose',
      'script_draft',
      'setup_read',
      'setup_types',
    ]) {
      expect(names).toContain(name);
    }
    expect(names.some((n) => n.startsWith('ipc_'))).toBe(false);
    // The same tools are on the MCP server's own catalogue.
    const catalogue = await running.invoke<{ tools: { name: string }[] }>('mcp:catalogue');
    for (const name of [
      'programs_find',
      'setup_propose',
      'script_draft',
      'setup_read',
      'setup_types',
    ]) {
      expect(catalogue.tools.map((t) => t.name)).toContain(name);
    }
  });

  it('a read runs, a change is asked in the window under its name, a refusal is recorded, an off channel is refused', async () => {
    const running = await started();
    const host = running.wiring.context.mcp.host()!;
    const listed = await host.call({ ...caller, signal: signal() }, 'setups_list', {});
    expect(listed.ok).toBe(true);
    const setup = (listed as { value: { setups: { id: string }[] } }).value.setups[0]!.id;

    answerNext(running, false);
    const made = await host.call({ ...caller, signal: signal() }, 'rig_make_ready', { setup });
    expect(made.ok).toBe(false);
    expect(!made.ok && made.error.code).toBe('mcp.denied');
    const asked = running.events.find((e) => e.channel === 'mcp:event:confirm');
    expect((asked?.payload as { client: string }).client).toBe('Built-in assistant');

    const off = await host.call({ ...caller, signal: signal() }, 'rigready_call', {
      channel: 'ai-assist:assistantSend',
      input: { requestId: 't1' },
    });
    expect(!off.ok && off.error.code).toBe('mcp.off');

    const activity = await running.invoke<{ entries: { client: string; outcome: string }[] }>(
      'mcp:activity'
    );
    const mine = activity.entries.filter((e) => e.client === 'Built-in assistant');
    expect(mine.map((e) => e.outcome)).toEqual(['refused', 'denied', 'ok']);

    // The confirm policy of the MCP settings holds here too.
    await running.invoke('mcp:setOptions', { confirm: 'never' });
    const second = await host.call({ ...caller, signal: signal() }, 'rig_make_ready', { setup });
    expect(second.ok).toBe(true);
  });
});

describe('ASSIST-003 a conversation with tool use, every request shown first', () => {
  it('finds the programs, proposes a setup, and the user saves it', async () => {
    const running = await started();
    reply(
      running,
      [
        { type: 'text', text: 'I will look for the programs first.' },
        {
          type: 'tool_use',
          id: 'tu1',
          name: 'programs_find',
          input: { names: ['SimAppPro', 'TrackIR'] },
        },
      ],
      'tool_use'
    );
    reply(
      running,
      [
        {
          type: 'tool_use',
          id: 'tu2',
          name: 'setup_propose',
          input: {
            newSetup: { name: 'DCS session', game: 'dcs' },
            summary: 'SimAppPro and TrackIR must run before DCS starts.',
            addChecks: [
              {
                type: 'process.running',
                title: 'SimAppPro',
                params: { name: 'SimAppPro.exe' },
                remediation: {
                  type: 'process.launch',
                  params: { exe: '{LOCALAPPDATA}/Programs/SimAppPro/SimAppPro.exe' },
                },
              },
            ],
          },
        },
      ],
      'tool_use'
    );
    reply(running, [{ type: 'text', text: 'The proposal is in RigReady for you to look at.' }]);

    const first = await running.invoke<TurnPreview>('ai-assist:assistantPrepare', {
      text: 'Set up a DCS session',
    });
    expect(running.ports.http.calls).toHaveLength(0);
    expect(first.contents[0]).toContain('Set up a DCS session');
    const body = JSON.parse(first.body) as { tools: { name: string }[] };
    expect(body.tools.map((t) => t.name)).toContain('programs_find');
    expect(first.body).not.toContain(KEY);

    const one = await running.invoke<TurnOutcome>('ai-assist:assistantSend', {
      requestId: first.requestId,
    });
    expect(one.next).toBeDefined();
    expect(one.next!.body).toContain('{LOCALAPPDATA}/Programs/SimAppPro/SimAppPro.exe');
    // The user's folder is never in what is sent.
    expect(one.next!.body).not.toContain(running.ports.folders.home());
    // The preview names the tool in words, as the conversation does.
    expect(one.next!.contents.join(' ')).toContain(
      'What one tool answered: Find installed programs'
    );
    expect(one.next!.round).toBe(2);

    const two = await running.invoke<TurnOutcome>('ai-assist:assistantSend', {
      requestId: one.next!.requestId,
    });
    const drafts = await running.invoke<Drafts>('ai-assist:drafts');
    expect(drafts.setups).toHaveLength(1);
    expect(drafts.setups[0]!.checks[0]!.fix).toContain('SimAppPro.exe');
    const three = await running.invoke<TurnOutcome>('ai-assist:assistantSend', {
      requestId: two.next!.requestId,
    });
    expect(three.next).toBeUndefined();
    const view: ConversationView = three.conversation;
    expect(view.entries.map((e) => e.kind)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
    ]);
    // The proposal is tied to the tool call that made it, so the page shows it there.
    const proposed = view.entries[3]!;
    expect(proposed.kind === 'tool' && proposed.draftId).toBe(drafts.setups[0]!.id);
    // A tool row: plain title, what was called, a short result, and the answer as it was sent.
    const found = view.entries[2]!;
    expect(found).toMatchObject({ title: 'Find installed programs', tier: 'read', ok: true });
    expect(found.kind === 'tool' && found.line).toMatch(/^\d+ programs?$/);
    expect(found.kind === 'tool' && two.next!.body.includes(JSON.stringify(found.answer))).toBe(
      true
    );
    // What it cost is counted per question and for the conversation.
    expect(view.usage).toMatchObject({ requests: 3, input: 2700, output: 240 });
    expect(view.usage.question.requests).toBe(3);
    expect(view.usage.cost).toBeGreaterThan(0);
    expect(view.waiting).toBe(false);
    expect(running.ports.http.calls).toHaveLength(3);
    // The key went in the header only.
    expect(running.ports.http.calls[0]!.headers!['x-api-key']).toBe(KEY);
    expect(running.ports.http.calls.every((c) => !(c.body ?? '').includes(KEY))).toBe(true);

    // Nothing is saved until the user's Save.
    const before = await running.invoke<{ id: string }[]>('profiles:list');
    expect(before.some((p) => p.id === 'dcs-session')).toBe(false);
    const saved = await running.invoke<{ setupId: string }>('ai-assist:saveSetupDraft', {
      draftId: drafts.setups[0]!.id,
    });
    const profile = await running.invoke<{ checks: { type: string; remediation?: unknown }[] }>(
      'profiles:get',
      { id: saved.setupId }
    );
    expect(profile.checks[0]).toMatchObject({ type: 'process.running' });
  });

  it('answers a how-to question from the manual: searches it, reads the page and links it', async () => {
    const running = await started();
    reply(
      running,
      [
        {
          type: 'tool_use',
          id: 'tu_search',
          name: 'manual_search',
          input: { query: 'script ask before running' },
        },
      ],
      'tool_use'
    );
    reply(
      running,
      [{ type: 'tool_use', id: 'tu_read', name: 'manual_read', input: { page: 'setups/scripts' } }],
      'tool_use'
    );
    reply(running, [
      {
        type: 'text',
        text: 'Switch off "Ask before running" on the step. See https://rigready.io/docs/setups/scripts/',
      },
    ]);
    const first = await running.invoke<TurnPreview>('ai-assist:assistantPrepare', {
      text: 'How do I stop a script from asking before it runs?',
    });
    // The instructions tell the model to search, read and cite the manual.
    expect(first.body).toContain('manual_search');
    expect(first.body).toContain('https://rigready.io/docs/<section>/<page>/');
    const tools = (JSON.parse(first.body) as { tools: { name: string }[] }).tools.map(
      (t) => t.name
    );
    expect(tools).toEqual(expect.arrayContaining(['manual_search', 'manual_read']));

    const searched = await running.invoke<TurnOutcome>('ai-assist:assistantSend', {
      requestId: first.requestId,
    });
    // What the search found goes back with its link on the website.
    expect(searched.next!.body).toContain('https://rigready.io/docs/setups/scripts/');
    const read = await running.invoke<TurnOutcome>('ai-assist:assistantSend', {
      requestId: searched.next!.requestId,
    });
    // The page itself, as the rigready://docs resource reads it.
    expect(read.next!.body).toContain('Ask before running');
    const done = await running.invoke<TurnOutcome>('ai-assist:assistantSend', {
      requestId: read.next!.requestId,
    });
    const said = done.conversation.entries.filter((e) => e.kind === 'assistant');
    expect(said.at(-1)).toMatchObject({
      text: expect.stringContaining('rigready.io/docs/setups/scripts/'),
    });
    expect(
      done.conversation.entries
        .filter((e) => e.kind === 'tool')
        .map((e) => e.kind === 'tool' && e.tool)
    ).toEqual(['manual_search', 'manual_read']);
  });

  it('never sends a request that was not prepared and shown', async () => {
    const running = await started();
    await expect(running.invoke('ai-assist:assistantSend', { requestId: 'nope' })).rejects.toThrow(
      /ai.expired/
    );
  });
});

describe('a request that was shown can be sent, or is gone from the page', () => {
  it('keeps the request when the provider refuses it: trying again is the same request, once more', async () => {
    const running = await started();
    refuse(running, 401, 'authentication_error', 'invalid x-api-key');
    reply(running, text('It is.'));
    const first = await prepare(running, 'Is TrackIR required?');
    await expect(send(running, first.requestId)).rejects.toThrow(/ai\./);
    // Nothing of the failed send is in a conversation: the message is not shown as sent.
    const after = await running.invoke<ConversationView>('ai-assist:assistantConversation', {
      conversationId: first.conversationId,
    });
    expect(after.entries).toEqual([]);
    // The same request id still sends: one click, and the text was never lost.
    const again = await send(running, first.requestId);
    expect(again.conversation.entries).toEqual([
      { kind: 'user', text: 'Is TrackIR required?' },
      { kind: 'assistant', text: 'It is.' },
    ]);
    const calls = running.ports.http.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    // Sent once it worked, it is used up.
    await expect(send(running, first.requestId)).rejects.toThrow(/ai.expired/);
  });

  it('keeps the request when no key is stored yet, and sends it once one is', async () => {
    const running = await started();
    const first = await prepare(running, 'Is TrackIR required?');
    await running.invoke('ai-assist:clearKey');
    await expect(send(running, first.requestId)).rejects.toThrow(/ai.noKey/);
    expect(running.ports.http.calls).toHaveLength(0);
    await running.invoke('ai-assist:setKey', { key: KEY });
    reply(running, text('It is.'));
    const sent = await send(running, first.requestId);
    expect(sent.conversation.entries).toHaveLength(2);
  });

  it('drops a request whose provider changed in Settings, says so, and a new one can be built at once', async () => {
    const running = await started();
    const first = await prepare(running, 'Is TrackIR required?');
    const seen = running.events.length;
    await running.invoke('ai-assist:setModel', { model: 'claude-sonnet-5-5' });
    // The page is told, so it can build the request again before the user presses Send.
    expect(
      running.events.slice(seen).some((e) => e.channel === 'ai-assist:event:settingsChanged')
    ).toBe(true);
    await expect(send(running, first.requestId)).rejects.toThrow(/ai.changed/);
    expect(running.ports.http.calls).toHaveLength(0);
    // It is gone for good, and the page has the text to build it again.
    await expect(send(running, first.requestId)).rejects.toThrow(/ai.expired/);
    expect(first.text).toBe('Is TrackIR required?');
    reply(running, text('It is.'));
    const second = await prepare(running, first.text!, first.conversationId);
    expect(second.model).toBe('claude-sonnet-5-5');
    expect((await send(running, second.requestId)).conversation.entries).toHaveLength(2);
  });

  it('builds a request that carries tool answers again, after it was lost', async () => {
    const running = await started();
    reply(running, [use('tu1', 'setups_list')], 'tool_use');
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    const one = await send(running, first.requestId);
    expect(one.conversation.waiting).toBe(true);
    await running.invoke('ai-assist:setModel', { model: 'claude-sonnet-5-5' });
    await expect(send(running, one.next!.requestId)).rejects.toThrow(/ai.changed/);
    const rebuilt = await running.invoke<TurnPreview>('ai-assist:assistantResume', {
      conversationId: first.conversationId,
    });
    expect(rebuilt.text).toBeUndefined();
    expect(rebuilt.contents[0]).toBe('What one tool answered: List the setups');
    const done = await send(running, rebuilt.requestId);
    expect(done.conversation.waiting).toBe(false);
    expect(done.conversation.entries.at(-1)).toEqual({ kind: 'assistant', text: 'One setup.' });
    // With nothing waiting there is nothing to build.
    await expect(
      running.invoke('ai-assist:assistantResume', { conversationId: first.conversationId })
    ).rejects.toThrow(/ai.nothing/);
  });

  it('a newer request of a conversation replaces the older one, which then says so', async () => {
    const running = await started();
    const first = await prepare(running, 'One');
    const second = await prepare(running, 'Two', first.conversationId);
    await expect(send(running, first.requestId)).rejects.toThrow(/ai.expired/);
    reply(running, text('Two it is.'));
    const sent = await send(running, second.requestId);
    expect(sent.conversation.entries[0]).toEqual({ kind: 'user', text: 'Two' });
  });

  it('"Don\'t send" throws the request away, and a conversation nothing was sent in with it', async () => {
    const running = await started();
    const first = await prepare(running, 'Is TrackIR required?');
    const gone = await running.invoke<{ discarded: boolean }>('ai-assist:assistantDiscard', {
      requestId: first.requestId,
    });
    expect(gone.discarded).toBe(true);
    await expect(send(running, first.requestId)).rejects.toThrow(/ai.expired/);
    await expect(
      running.invoke('ai-assist:assistantConversation', { conversationId: first.conversationId })
    ).rejects.toThrow(/ai.conversation/);
    // A second time there is nothing to throw away.
    const twice = await running.invoke<{ discarded: boolean }>('ai-assist:assistantDiscard', {
      requestId: first.requestId,
    });
    expect(twice.discarded).toBe(false);
    expect(running.ports.http.calls).toHaveLength(0);
  });

  it('ending a conversation takes its request with it', async () => {
    const running = await started();
    reply(running, text('Hello.'));
    const first = await prepare(running, 'Hello');
    await send(running, first.requestId);
    const second = await prepare(running, 'And now?', first.conversationId);
    await running.invoke('ai-assist:assistantForget', { conversationId: first.conversationId });
    await expect(send(running, second.requestId)).rejects.toThrow(/ai.expired/);
    await expect(prepare(running, 'Again', first.conversationId)).rejects.toThrow(
      /ai.conversation/
    );
  });

  it('a message that cannot be built leaves no conversation behind', async () => {
    const running = await started();
    await running.invoke('ai-assist:clearKey');
    await expect(prepare(running, 'Hello')).rejects.toThrow(/ai.noKey/);
    await expect(prepare(running, '   ')).rejects.toThrow(/ai.question/);
  });
});

describe('Stop is always reachable while the assistant works', () => {
  it('ends the wait for an answer at once; the request stays ready', async () => {
    const running = await started();
    hang(running);
    reply(running, text('It is.'));
    const first = await prepare(running, 'Is TrackIR required?');
    const waiting = send(running, first.requestId);
    void waiting.catch(() => undefined);
    await until(() => running.ports.http.calls.length === 1);
    // While it works, a second send and a new message are refused, not queued.
    await expect(send(running, first.requestId)).rejects.toThrow(/ai.busy/);
    await expect(prepare(running, 'Another', first.conversationId)).rejects.toThrow(/ai.busy/);
    const stopped = await running.invoke<{ stopped: boolean }>('ai-assist:assistantStop', {
      conversationId: first.conversationId,
    });
    expect(stopped.stopped).toBe(true);
    await expect(waiting).rejects.toThrow(/ai.stopped/);
    // Nothing is running any more, so there is nothing to stop.
    const idle = await running.invoke<{ stopped: boolean }>('ai-assist:assistantStop', {
      conversationId: first.conversationId,
    });
    expect(idle.stopped).toBe(false);
    const again = await send(running, first.requestId);
    expect(again.conversation.entries.at(-1)).toEqual({ kind: 'assistant', text: 'It is.' });
  });

  it('stops between tools: what ran is kept, what did not says so, and Continue goes on', async () => {
    const running = await started();
    const setups = await running.invoke<{ profiles: { id: string }[] }>('fly:state');
    const setup = setups.profiles[0]!.id;
    reply(
      running,
      [
        use('tu1', 'setups_list'),
        use('tu2', 'rig_make_ready', { setup }),
        use('tu3', 'rig_check', { setup }),
      ],
      'tool_use'
    );
    reply(running, text('Nothing was changed.'));
    const first = await prepare(running, 'Make the rig ready');
    const seen = running.events.length;
    const working = send(running, first.requestId);
    // The change is asked in the window; the user presses Stop instead of answering.
    await until(() => running.events.slice(seen).some((e) => e.channel === 'mcp:event:confirm'));
    await running.invoke('ai-assist:assistantStop', { conversationId: first.conversationId });
    const outcome = await working;
    expect(outcome.next).toBeUndefined();
    expect(outcome.conversation.waiting).toBe(true);
    const rows = tools(outcome.conversation);
    expect(rows.map((r) => r.ok)).toEqual([true, false, false]);
    expect(rows[2]!.line).toBe('Not run: you stopped the assistant first.');
    expect(outcome.conversation.entries.at(-1)).toEqual({
      kind: 'note',
      text: 'Stopped. What the tools answered is kept: continue, or write a message.',
    });
    // Continue: the three answers go back, each tool call with its own.
    const next = await running.invoke<TurnPreview>('ai-assist:assistantResume', {
      conversationId: first.conversationId,
    });
    const body = JSON.parse(next.body) as {
      messages: { content: { type: string; tool_use_id?: string; is_error?: boolean }[] }[];
    };
    const results = body.messages.at(-1)!.content.filter((b) => b.type === 'tool_result');
    expect(results.map((r) => r.tool_use_id)).toEqual(['tu1', 'tu2', 'tu3']);
    expect(results.map((r) => r.is_error === true)).toEqual([false, true, true]);
    const done = await send(running, next.requestId);
    expect(done.conversation.entries.at(-1)).toEqual({
      kind: 'assistant',
      text: 'Nothing was changed.',
    });
  });
});

describe('what the page is told while the assistant works', () => {
  it('says which request of the question it is on, which tool runs, and what it has cost so far', async () => {
    const running = await started();
    reply(running, [use('tu1', 'setups_list')], 'tool_use');
    reply(running, text('One setup.'));
    const first = await prepare(running, 'Which setups are there?');
    const one = await send(running, first.requestId);
    await send(running, one.next!.requestId);
    const told = running.events
      .filter((e) => e.channel === 'ai-assist:event:assistantProgress')
      .map((e) => e.payload as { phase: string; round: number; tool?: string; cost: number });
    expect(told.map((t) => [t.phase, t.round, t.tool])).toEqual([
      ['asking', 1, undefined],
      ['tool', 1, 'List the setups'],
      ['asking', 2, undefined],
    ]);
    expect(told[0]!.cost).toBe(0);
    expect(told[1]!.cost).toBeGreaterThan(0);
    expect(told[2]!.cost).toBe(told[1]!.cost);
  });
});

describe('a tool row says what was really called', () => {
  it('a read through "Call one channel" is a read, named by what the channel does', async () => {
    const running = await started();
    // The tool itself may change things, which is why its own tier is not the row's.
    const host = running.wiring.context.mcp.host()!;
    expect(host.tools().find((t) => t.name === 'rigready_call')!.tier).toBe('change');
    reply(running, [use('tu1', 'rigready_call', { channel: 'profiles:list' })], 'tool_use');
    const first = await prepare(running, 'List my setups');
    const one = await send(running, first.requestId);
    const row = tools(one.conversation)[0]!;
    expect(row).toMatchObject({ tool: 'rigready_call', tier: 'read', channel: 'profiles:list' });
    // In words, not the tool's own title and not the channel id.
    expect(row.title).not.toBe('Call one channel');
    expect(row.title).not.toContain('profiles:list');
    expect(row.title.length).toBeGreaterThan(8);
  });

  it('a refused call keeps the tier of what was asked for', async () => {
    const running = await started();
    reply(
      running,
      [use('tu1', 'rigready_call', { channel: 'ai-assist:assistantSend', input: {} })],
      'tool_use'
    );
    const first = await prepare(running, 'Send it yourself');
    const one = await send(running, first.requestId);
    const row = tools(one.conversation)[0]!;
    expect(row.ok).toBe(false);
    expect(one.next!.body).toContain('mcp.off');
  });

  it('cuts an answer that is too long and tells the model how to ask for less', async () => {
    const running = await started();
    reply(running, [use('tu1', 'rigready_call', { channel: 'profiles:types' })], 'tool_use');
    const first = await prepare(running, 'What can a setup check?');
    const one = await send(running, first.requestId);
    const row = tools(one.conversation)[0]!;
    expect(row.answer!.length).toBeLessThan(MAX_TOOL_RESULT + 300);
    expect(row.answer).toMatch(/\[cut: the answer was \d+ characters and only the first 16000/);
    expect(row.answer).toContain('Ask for less');
  });

  it('counts in the right number', () => {
    expect(counted(1, 'setups')).toBe('1 setup');
    expect(counted(8, 'hits')).toBe('8 hits');
    expect(counted(0, 'setups')).toBe('0 setups');
    expect(counted(1, 'entries')).toBe('1 entry');
    expect(counted(1, 'matches')).toBe('1 match');
    expect(counted(1, 'checkTypes')).toBe('1 check type');
    expect(counted(3, 'checkTypes')).toBe('3 check types');
    expect(counted(1, 'status')).toBe('1 status');
    expect(counted(1, 'statuses')).toBe('1 status');
    expect(counted(1, 'axes')).toBe('1 axis');
    expect(counted(1, 'deviceAxes')).toBe('1 device axis');
    expect(counted(1, 'items')).toBe('1 item');
    expect(counted(1, 'data')).toBe('1 data');
    expect(lineOf({ setups: [{ id: 'a' }] })).toBe('1 setup');
    expect(lineOf({ hits: [1, 2, 3, 4, 5, 6, 7, 8] })).toBe('8 hits');
    expect(lineOf({ name: 'F/A-18C', checks: [1, 2] })).toBe('F/A-18C: 2 checks');
    expect(lineOf({ message: 'The proposal is shown.' })).toBe('The proposal is shown.');
    expect(lineOf({ ready: false })).toBe('Not ready');
    expect(lineOf('# Launch\n\nText')).toBe('Launch');
    expect(lineOf([1])).toBe('1 item');
    expect(lineOf(null)).toBe('Done');
  });
});

describe('a ceiling on what one question may cost', () => {
  const big = { input_tokens: 40_000, output_tokens: 500 };

  it('shows the ceiling with the request, stops before going past it, and goes on only with a yes', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0.1 });
    // Each answer costs about $0.17 at the price of the default model.
    reply(running, [use('tu1', 'setups_list')], 'tool_use', big);
    reply(running, [use('tu2', 'setups_list')], 'tool_use', big);
    reply(running, text('One setup.'), 'end_turn', big);
    const first = await prepare(running, 'Which setups are there?');
    expect(first).toMatchObject({ round: 1, spent: 0, ceiling: 0.1, overCeiling: false });
    const one = await send(running, first.requestId);
    // The question has now cost more than the ceiling: the next request says so.
    expect(one.next).toMatchObject({ round: 2, ceiling: 0.1, overCeiling: true });
    expect(one.next!.spent).toBeGreaterThan(0.1);
    await expect(send(running, one.next!.requestId)).rejects.toThrow(/ai.ceiling/);
    await expect(send(running, one.next!.requestId)).rejects.toThrow(/Nothing was sent/);
    expect(running.ports.http.calls).toHaveLength(1);

    // The user's yes: the same request goes, and the question may cost as much again.
    const two = await send(running, one.next!.requestId, true);
    expect(running.ports.http.calls).toHaveLength(2);
    expect(two.next!.overCeiling).toBe(true);
    expect(two.next!.ceiling).toBeGreaterThan(0.1);
    await expect(send(running, two.next!.requestId)).rejects.toThrow(/ai.ceiling/);
    const three = await send(running, two.next!.requestId, true);
    expect(three.conversation.usage.question.requests).toBe(3);

    // A new question starts from nothing again, under the ceiling of Settings.
    const second = await prepare(running, 'Thanks', first.conversationId);
    expect(second).toMatchObject({ round: 1, spent: 0, ceiling: 0.1 });
  });

  it('0 means no ceiling, and a model without a known price has none', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0 });
    const free = await prepare(running, 'Hello');
    expect(free).toMatchObject({ ceiling: null, overCeiling: false });
    expect(free.approxCost).toBeGreaterThan(0);
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0.1 });
    await running.invoke('ai-assist:setModel', { model: 'a-model-nobody-priced' });
    const unknown = await prepare(running, 'Hello');
    expect(unknown).toMatchObject({ approxCost: null, spent: null, ceiling: null });
    expect(unknown.overCeiling).toBe(false);
  });

  it('is kept in Settings, in whole cents, and refuses an amount that is not one', async () => {
    const running = await started();
    type Status = { questionCeiling: number; priceKnown: boolean };
    const before = await running.invoke<Status>('ai-assist:status');
    expect(before).toMatchObject({ questionCeiling: 0.25, priceKnown: true });
    const set = await running.invoke<Status>('ai-assist:setQuestionCeiling', { dollars: 1.239 });
    expect(set.questionCeiling).toBe(1.24);
    expect((await running.invoke<Status>('ai-assist:status')).questionCeiling).toBe(1.24);
    await expect(running.invoke('ai-assist:setQuestionCeiling', { dollars: 500 })).rejects.toThrow(
      /ai.amount/
    );
    await running.invoke('ai-assist:setModel', { model: 'a-model-nobody-priced' });
    expect((await running.invoke<Status>('ai-assist:status')).priceKnown).toBe(false);
  });
});

describe('ASSIST-004 a script an assistant wrote: shown, saved with its hash, asked again when changed', () => {
  it('is saved into the data folder with a header, approved by hash, refused when changed and for an assistant', async () => {
    const running = await started();
    const fly = await running.invoke<{ profiles: { id: string; name: string }[] }>('fly:state');
    const setup = fly.profiles[0]!;
    const drafted = await running.invoke<{ draftId: string }>('ai-assist:draftScript', {
      by: 'Built-in assistant',
      fileName: 'srs-running.ps1',
      content:
        'if (Get-Process SR-ClientRadio -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }',
      explanation: 'Passes when the SRS radio client is running, and fails when it is not.',
      use: { setup: setup.id, as: 'check', title: 'SRS radio running' },
    });
    const drafts = await running.invoke<Drafts>('ai-assist:drafts');
    expect(drafts.scripts[0]!.text).toContain('Written by an assistant');
    expect(drafts.scripts[0]!.text).toContain('Get-Process SR-ClientRadio');

    const saved = await running.invoke<{ stored: string; sha256: string }>(
      'ai-assist:saveScriptDraft',
      { draftId: drafted.draftId }
    );
    const dataRoot = running.ports.folders.dataRoot();
    const file = path.join(dataRoot, 'scripts', 'assistant', 'srs-running.ps1');
    expect(await fs.readFile(file, 'utf8')).toContain('Get-Process SR-ClientRadio');
    const profile = await running.invoke<{ checks: { type: string; params: { exe: string } }[] }>(
      'profiles:get',
      { id: setup.id }
    );
    const check = profile.checks.find((c) => c.type === 'script.check')!;
    expect(check.params.exe).toBe(saved.stored);

    expect((await mayRunScript(running.ports.files, dataRoot, file)).ok).toBe(true);
    // An assistant never runs it itself.
    const asAssistant = await runAsAssistant('Claude Code', () =>
      mayRunScript(running.ports.files, dataRoot, file)
    );
    expect(!asAssistant.ok && asAssistant.error.code).toBe('script.assistant');

    // Changed behind RigReady's back: not run, and shown again for approval.
    await fs.appendFile(file, '\r\nRemove-Item C:\\Important -Recurse\r\n');
    const refused = await mayRunScript(running.ports.files, dataRoot, file);
    expect(!refused.ok && refused.error.code).toBe('script.changed');
    const scripts = await running.invoke<{ scripts: SavedScript[] }>('ai-assist:assistantScripts');
    const changed = scripts.scripts.find((s) => s.file === 'srs-running.ps1')!;
    expect(changed.state).toBe('changed');
    expect(changed.text).toContain('Remove-Item');
    // An approval of an older text does not count.
    await expect(
      running.invoke('ai-assist:approveScript', { file: 'srs-running.ps1', sha256: saved.sha256 })
    ).rejects.toThrow(/script.changed/);
    const approved = await running.invoke<SavedScript>('ai-assist:approveScript', {
      file: 'srs-running.ps1',
      sha256: changed.sha256,
    });
    expect(approved.state).toBe('approved');
    expect((await mayRunScript(running.ports.files, dataRoot, file)).ok).toBe(true);
  });

  it('refuses a script that asks for administrator rights', async () => {
    const running = await started();
    await expect(
      running.invoke('ai-assist:draftScript', {
        fileName: 'elevate.ps1',
        content: "Start-Process powershell -Verb RunAs -ArgumentList '-File x.ps1'",
        explanation: 'Starts a second PowerShell as administrator.',
      })
    ).rejects.toThrow(/ai.elevation/);
  });

  it('a script.run step for an assistant script always asks, whatever the setup says', async () => {
    const running = await started();
    const fix = running.wiring.context.checks.remediation('script.run')!;
    const params = fix.params.parse({
      exe: '{RIGREADY_HOME}/scripts/assistant/x.cmd',
      requiresConfirmation: false,
    });
    expect(fix.confirm?.(params)).toBeDefined();
  });
});
