import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { err, ok } from '../../../core/result';
import type { McpStatus } from '../contract';
import path from 'node:path';
import { BRIDGE_TOKEN_FILE } from '../../../core/mcpBridge';
import { endpointUrl, NOT_RUNNING, runBridge } from '../../../core/mcpBridge';

/**
 * `RigReady.exe --mcp` without Electron: the bridge between a stdio client (here the
 * official client over an in-memory pair, standing in for stdin and stdout) and the
 * running app's HTTP endpoint, with the bridge's own token from the encrypted store.
 */

let app: WiredApp | undefined;
const closers: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
});

describe('MCP-003 the stdio bridge reaches the running RigReady', () => {
  it('passes a whole session through with the bridge token', async () => {
    app = await wiredApp('flying-all-good');
    await app.invoke('mcp:setOptions', { port: 0 });
    const status = await app.invoke<McpStatus>('mcp:enable');
    const token = await app.ports.files.readText(
      path.join(app.ports.folders.dataRoot(), BRIDGE_TOKEN_FILE)
    );
    expect(token.ok && token.value).toBeTruthy();
    const [clientSide, bridgeSide] = InMemoryTransport.createLinkedPair();
    const notes: string[] = [];
    void runBridge({
      downstream: bridgeSide,
      note: (line) => notes.push(line),
      connect: async () => {
        const url = endpointUrl({
          running: true,
          port: status.endpoint!.port,
          pid: 1,
          startedAt: '',
          protocolVersion: '',
          version: '',
        });
        if (!url.ok) return url;
        const transport = new StreamableHTTPClientTransport(url.value, {
          requestInit: {
            headers: { Authorization: `Bearer ${token.ok ? token.value : ''}` },
          },
        });
        await transport.start();
        return ok(transport);
      },
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    closers.push(() => client.close());
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('rig_check');
    const listed = await client.callTool({ name: 'setups_list', arguments: {} });
    expect(listed.isError).toBeFalsy();
    const guide = await client.readResource({ uri: 'rigready://guide' });
    expect((guide.contents[0] as { text: string }).text).toContain('How to work with RigReady');
    // The call is recorded under the bridge's pairing.
    const { entries } = await app.invoke<{ entries: { client: string }[] }>('mcp:activity');
    expect(entries[0]?.client).toContain('bridge');
  });

  it('says plainly that RigReady is not running, and does not crash', async () => {
    const [clientSide, bridgeSide] = InMemoryTransport.createLinkedPair();
    const notes: string[] = [];
    void runBridge({
      downstream: bridgeSide,
      note: (line) => notes.push(line),
      connect: async () => err('mcp.notRunning', 'No MCP server is listening.'),
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    closers.push(() => client.close());
    await expect(client.connect(clientSide)).rejects.toThrow(/RigReady is not running/);
    expect(notes.join('\n')).toContain('No MCP server is listening');
    expect(NOT_RUNNING).toContain('Settings page');
  });

  it('reads no endpoint as not running', () => {
    expect(endpointUrl(undefined).ok).toBe(false);
    const stopped = endpointUrl({
      running: false,
      port: 29170,
      pid: 1,
      startedAt: '',
      protocolVersion: '',
      version: '',
    });
    expect(stopped.ok).toBe(false);
  });
});
