import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { McpStatus } from '../contract';
import path from 'node:path';
import { BRIDGE_TOKEN_FILE } from '../../../core/mcpBridge';

/**
 * The server as an assistant meets it: every feature wired on a scenario rig, the MCP
 * server turned on the way the Settings page does it, and the official MCP client SDK on
 * the other end of a real HTTP connection on 127.0.0.1.
 */

let app: WiredApp | undefined;
let clients: Client[] = [];

afterEach(async () => {
  for (const client of clients) await client.close().catch(() => undefined);
  clients = [];
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
});

async function started(): Promise<{ app: WiredApp; url: string; token: string }> {
  app = await wiredApp('flying-all-good');
  await app.invoke('mcp:setOptions', { port: 0 });
  const status = await app.invoke<McpStatus>('mcp:enable');
  expect(status.running).toBe(true);
  const paired = await app.invoke<{ token: string }>('mcp:pair', { name: 'Test assistant' });
  return { app, url: status.endpoint!.url, token: paired.token };
}

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'rigready-test', version: '1.0.0' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  return client;
}

const text = (result: { content: unknown }): string =>
  (result.content as { type: string; text?: string }[])[0]?.text ?? '';

/** The question the window would show for the next call that needs the user's yes, answered. */
function answerNextQuestion(running: WiredApp, allow: boolean): void {
  const seen = running.events.length;
  const timer = setInterval(() => {
    const asked = running.events.slice(seen).find((e) => e.channel === 'mcp:event:confirm');
    if (!asked) return;
    clearInterval(timer);
    void running.invoke('mcp:answer', { id: (asked.payload as { id: string }).id, allow });
  }, 10);
}

describe('MCP-002 the server answers the official MCP client over HTTP on 127.0.0.1', () => {
  it('lists the tools, runs a read, and reads the guide and a manual page', async () => {
    const { url, token } = await started();
    const client = await connect(url, token);
    expect(client.getServerVersion()?.name).toBe('rigready');
    expect(client.getInstructions()).toContain('check before you fix');

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of [
      'rig_check',
      'rig_make_ready',
      'rig_launch',
      'setups_list',
      'rigready_call',
    ]) {
      expect(names).toContain(name);
    }
    expect(tools.find((t) => t.name === 'rig_check')?.annotations?.readOnlyHint).toBe(true);

    const setups = await client.callTool({ name: 'setups_list', arguments: {} });
    expect(setups.isError, text(setups)).toBeFalsy();
    const listed = setups.structuredContent as { setups: { id: string; name: string }[] };
    expect(listed.setups.length).toBeGreaterThan(0);

    const check = await client.callTool({
      name: 'rig_check',
      arguments: { setup: listed.setups[0]!.id },
    });
    expect(check.isError, text(check)).toBeFalsy();
    expect(check.structuredContent).toMatchObject({ ready: expect.any(Boolean) });

    const guide = await client.readResource({ uri: 'rigready://guide' });
    expect((guide.contents[0] as { text: string }).text).toContain('Check before you fix');
    const contents = await client.readResource({ uri: 'rigready://docs' });
    const page = /\((rigready:\/\/docs\/[a-z-]+\/[a-z0-9-]+)\)/.exec(
      (contents.contents[0] as { text: string }).text
    );
    expect(page, 'the contents name at least one page').not.toBeNull();
    const read = await client.readResource({ uri: page![1]! });
    expect((read.contents[0] as { text: string }).text.length).toBeGreaterThan(100);

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain('first_setup');
    const prompt = await client.getPrompt({ name: 'why_not_ready', arguments: { setup: 'DCS' } });
    const said = (prompt.messages[0]!.content as { text: string }).text;
    expect(said).toContain('rig_check');
    expect(said).toContain('check_explain');
    const yaml = await client.readResource({ uri: `rigready://setups/${listed.setups[0]!.id}` });
    expect((yaml.contents[0] as { text: string }).text).toContain('checks');
  });

  it('a change waits for the user in the window: allowed it runs, denied it does not', async () => {
    const { app: running, url, token } = await started();
    const client = await connect(url, token);
    const setups = (await client.callTool({ name: 'setups_list', arguments: {} }))
      .structuredContent as { setups: { id: string }[] };
    const setup = setups.setups[0]!.id;

    answerNextQuestion(running, false);
    const denied = await client.callTool({ name: 'rig_make_ready', arguments: { setup } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain('mcp.denied');

    answerNextQuestion(running, true);
    const allowed = await client.callTool({ name: 'rig_make_ready', arguments: { setup } });
    expect(allowed.isError, text(allowed)).toBeFalsy();
    expect(allowed.structuredContent).toMatchObject({ ready: expect.any(Boolean) });

    const { entries } = await running.invoke<{
      entries: { tool: string; client: string; outcome: string }[];
    }>('mcp:activity');
    const makeReady = entries.filter((e) => e.tool === 'rig_make_ready');
    expect(makeReady.map((e) => e.outcome)).toEqual(['ok', 'denied']);
    expect(makeReady.every((e) => e.client === 'Test assistant')).toBe(true);
  });

  it('MCP-007 the Safety page names the assistant beside its change, and undo works the same', async () => {
    const { app: running, url, token } = await started();
    await running.invoke('mcp:setOptions', { confirm: 'never' });
    const client = await connect(url, token);
    const created = await client.callTool({
      name: 'setup_create_from_rig',
      arguments: { name: 'Made by an assistant' },
    });
    expect(created.isError, text(created)).toBeFalsy();
    const id = (created.structuredContent as { id: string }).id;
    const removed = await client.callTool({
      name: 'rigready_call',
      arguments: { channel: 'profiles:remove', input: { id } },
    });
    expect(removed.isError, text(removed)).toBeFalsy();

    type View = { groups: { id: string; by?: string; undone: boolean }[] };
    const view = await running.invoke<View>('safety:journal');
    const change = view.groups[0]!;
    expect(change.by).toBe('Test assistant');

    // Undoing the assistant's change is the same undo as any other.
    const after = await running.invoke<View>('safety:undo', { groupId: change.id });
    expect(after.groups.find((g) => g.id === change.id)).toMatchObject({
      undone: true,
      by: 'Test assistant',
    });
    const setups = await running.invoke<{ id: string }[]>('profiles:list');
    expect(setups.map((s) => s.id)).toContain(id);
  });

  it('refuses a channel that is not offered, even through rigready_call', async () => {
    const { url, token } = await started();
    const client = await connect(url, token);
    const refused = await client.callTool({
      name: 'rigready_call',
      arguments: { channel: 'settings:setAiKey', input: { key: 'sk-ant-something-long' } },
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('mcp.off');
  });

  it('answers nothing without a token, or with a revoked one', async () => {
    const { app: running, url, token } = await started();
    const bare = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(bare.status).toBe(401);
    await expect(connect(url, `rr_${'0'.repeat(64)}`)).rejects.toThrow();

    const status = await running.invoke<McpStatus>('mcp:status');
    const pairing = status.pairings.find((p) => p.name === 'Test assistant')!;
    await running.invoke('mcp:revoke', { id: pairing.id });
    await expect(connect(url, token)).rejects.toThrow();
  });

  it('a page served elsewhere cannot reach it: another Origin is refused', async () => {
    const { url, token } = await started();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        origin: 'https://evil.example',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('keeps the bridge token in a file of its own and only its hash in mcp.json', async () => {
    const { app: running } = await started();
    const secret = await running.ports.files.readText(
      path.join(running.ports.folders.dataRoot(), BRIDGE_TOKEN_FILE)
    );
    expect(secret.ok && secret.value).toMatch(/^rr_[0-9a-f]{64}$/);
    const file = await running.ports.files.readText(`${running.ports.folders.dataRoot()}/mcp.json`);
    expect(file.ok).toBe(true);
    if (file.ok && secret.ok) expect(file.value).not.toContain(secret.value!);
  });
  it('listens again when RigReady starts with the server left on, and not before every feature is wired', async () => {
    app = await wiredApp('flying-all-good', {
      beforeWiring: async (rig) => {
        const file = path.join(rig.ports.folders.dataRoot(), 'mcp.json');
        const written = await rig.ports.files.write(
          file,
          JSON.stringify({ schemaVersion: 1, enabled: true, port: 0, pairings: [] }),
          { reason: 'test' }
        );
        expect(written.ok).toBe(true);
      },
    });
    const before = await app.invoke<McpStatus>('mcp:status');
    expect(before.enabled).toBe(true);
    expect(before.running).toBe(false);
    const mcp = app.wiring.features.find((f) => f.id === 'mcp')!;
    await mcp.start?.();
    const after = await app.invoke<McpStatus>('mcp:status');
    expect(after.running).toBe(true);
    expect(after.pairings.some((p) => p.kind === 'bridge')).toBe(true);
  });
  it('every task-level tool does what its page does, under the "never ask" policy', async () => {
    const { app: running, url, token } = await started();
    await running.invoke('mcp:setOptions', { confirm: 'never' });
    const client = await connect(url, token);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${text(result)}`).toBeFalsy();
      return result.structuredContent as Record<string, unknown>;
    };
    const { setups } = (await call('setups_list', {})) as { setups: { id: string }[] };
    const setup = setups[0]!.id;
    const report = (await call('rig_check', { setup })) as { items: { itemId: string }[] };
    const explained = await call('check_explain', { setup, item: report.items[0]!.itemId });
    expect(explained).toMatchObject({ type: expect.any(String), details: expect.any(Array) });
    const launched = await call('rig_launch', { setup });
    expect(['launched', 'paused', 'failed']).toContain(launched['outcome']);
    const down = await call('rig_stand_down', { setup });
    expect(down['headline']).toEqual(expect.any(String));
    const created = (await call('setup_create_from_rig', { name: 'Made by an assistant' })) as {
      id: string;
      checks: unknown[];
    };
    expect(created.checks.length).toBeGreaterThan(0);
    const after = (await call('setups_list', {})) as { setups: { id: string }[] };
    expect(after.setups.map((s) => s.id)).toContain(created.id);
    const found = (await call('manual_search', { query: 'make ready' })) as { hits: unknown[] };
    expect(found.hits.length).toBeGreaterThan(0);
  });
});
