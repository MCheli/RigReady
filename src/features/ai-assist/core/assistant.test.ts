import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { mayRunScript, runAsAssistant } from '../../../core/assistantScripts';
import { AI_KEY_SECRET } from '../../../core/settings';
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

/** One scripted answer of the Messages API, used once, in order. */
function reply(running: WiredApp, content: unknown[], stop = 'end_turn'): void {
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
        usage: { input_tokens: 900, output_tokens: 80 },
      },
    },
  });
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
    ]) {
      expect(names).toContain(name);
    }
    expect(names.some((n) => n.startsWith('ipc_'))).toBe(false);
    // The same three tools are on the MCP server's own catalogue.
    const catalogue = await running.invoke<{ tools: { name: string }[] }>('mcp:catalogue');
    for (const name of ['programs_find', 'setup_propose', 'script_draft']) {
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
    expect(one.next!.contents.join(' ')).toContain('programs_find');

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
