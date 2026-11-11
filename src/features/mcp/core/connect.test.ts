import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { isOpenableLink } from '../../../core/links';
import type { ChangePreview } from '../../../shared/changePreview';
import type { McpStatus } from '../contract';
import {
  claudeCodeAddArgs,
  detectClients,
  entryState,
  installLink,
  mergeEntry,
  type DetectedClient,
} from './connect';

const self = {
  exe: 'C:\\Users\\Pilot One\\AppData\\Local\\Programs\\RigReady\\RigReady.exe',
  args: [],
};
const entry = { command: self.exe, args: ['--mcp'] };

describe('MCP-011 merging RigReady into an assistant settings file', () => {
  it('adds RigReady and keeps every other server and setting', () => {
    const before = JSON.stringify({
      globalShortcut: 'Ctrl+Space',
      mcpServers: { files: { command: 'npx', args: ['-y', 'files'] } },
    });
    const merged = mergeEntry(before, 'mcpServers', entry);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.changed).toBe(true);
    const after = JSON.parse(merged.value.text) as Record<string, unknown>;
    expect(after['globalShortcut']).toBe('Ctrl+Space');
    expect(after['mcpServers']).toEqual({
      files: { command: 'npx', args: ['-y', 'files'] },
      rigready: entry,
    });
  });

  it('is idempotent: a second merge changes nothing', () => {
    const first = mergeEntry(undefined, 'mcpServers', entry);
    if (!first.ok) throw new Error('first');
    const second = mergeEntry(first.value.text, 'mcpServers', entry);
    expect(second.ok && second.value).toEqual({ text: first.value.text, changed: false });
  });

  it('starts a missing or empty file, and reads one with a byte order mark', () => {
    for (const text of [undefined, '', '  \n', '\uFEFF{}']) {
      const merged = mergeEntry(text, 'mcpServers', entry);
      expect(merged.ok && JSON.parse(merged.value.text)).toEqual({
        mcpServers: { rigready: entry },
      });
    }
  });

  it('refuses a file that is not valid JSON, not an object, or whose server list is not one', () => {
    for (const text of [
      '{ "mcpServers": { ',
      '[1, 2]',
      '"text"',
      '{"mcpServers": []}',
      '{"mcpServers": 3}',
    ]) {
      const merged = mergeEntry(text, 'mcpServers', entry);
      expect(merged.ok, text).toBe(false);
      if (!merged.ok) expect(merged.error.code).toBe('mcp.clientFile');
    }
  });

  it('replaces an older RigReady entry and says when one points elsewhere', () => {
    const old = { mcpServers: { rigready: { command: 'D:\\Old\\RigReady.exe', args: ['--mcp'] } } };
    expect(entryState(old, 'mcpServers', entry)).toBe('different');
    const merged = mergeEntry(JSON.stringify(old), 'mcpServers', entry);
    expect(merged.ok && JSON.parse(merged.value.text)).toEqual({ mcpServers: { rigready: entry } });
    expect(entryState({ mcpServers: { rigready: entry } }, 'mcpServers', entry)).toBe('connected');
    expect(entryState({}, 'mcpServers', entry)).toBe('absent');
  });
});

describe('MCP-011 install links and the Claude Code command', () => {
  it('builds the documented install links from the fixed entry', () => {
    const cursor = installLink('cursor', self)!;
    expect(
      cursor.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=rigready&config=')
    ).toBe(true);
    const config = decodeURIComponent(new URL(cursor).searchParams.get('config') ?? '');
    expect(JSON.parse(Buffer.from(config, 'base64').toString('utf8'))).toEqual(entry);

    const vscode = installLink('vscode', self)!;
    expect(vscode.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(vscode.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'rigready',
      type: 'stdio',
      ...entry,
    });

    const lmstudio = installLink('lm-studio', self)!;
    expect(lmstudio.startsWith('lmstudio://add_mcp?name=rigready&config=')).toBe(true);
    const lmConfig = new URL(lmstudio).searchParams.get('config') ?? '';
    expect(JSON.parse(Buffer.from(lmConfig, 'base64').toString('utf8'))).toEqual(entry);

    for (const link of [cursor, vscode, lmstudio]) {
      expect(isOpenableLink(link), link).toBe(true);
      expect(link).not.toMatch(/\s/);
    }
    expect(installLink('claude-desktop', self)).toBeUndefined();
  });

  it('opens only the schemes it knows', () => {
    for (const bad of [
      'file:///C:/Windows/System32/calc.exe',
      'ms-settings:',
      'javascript:alert(1)',
      'C:\\x.exe',
      'cursor://a b',
      'not a link',
    ]) {
      expect(isOpenableLink(bad), bad).toBe(false);
    }
    expect(isOpenableLink('https://rigready.app')).toBe(true);
  });

  it('gives Claude Code an argument list, for every folder, never a command string', () => {
    expect(claudeCodeAddArgs(self)).toEqual([
      'mcp',
      'add',
      '--transport',
      'stdio',
      '--scope',
      'user',
      'rigready',
      '--',
      self.exe,
      '--mcp',
    ]);
  });
});

// ------------------------------------------------------------- against the wired app

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

async function put(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

describe('MCP-011 finding the assistants on this PC', () => {
  it('finds nothing on a PC without assistants, and reads nothing to say so', async () => {
    app = await wiredApp('generic-fresh');
    const found = await app.invoke<{ clients: DetectedClient[] }>('mcp:clients');
    expect(found.clients).toEqual([]);
    expect((await app.ports.files.journal()).ok).toBe(true);
  });

  it('finds installed assistants by their folders, general ones first, with their state', async () => {
    app = await wiredApp('generic-fresh');
    const { folders } = app.ports;
    await put(
      path.join(folders.appData(), 'Claude', 'claude_desktop_config.json'),
      '{"mcpServers":{}}'
    );
    await fs.mkdir(path.join(folders.home(), '.cursor'), { recursive: true });
    await fs.mkdir(path.join(folders.home(), '.lmstudio'), { recursive: true });
    await put(path.join(folders.appData(), 'Code', 'User', 'mcp.json'), '{ not json');
    await fs.mkdir(path.join(folders.appData(), 'Jan'), { recursive: true });
    const found = await detectClients(
      { files: app.ports.files, folders },
      { exe: app.ports.shortcuts.self().exe, args: app.ports.shortcuts.self().args }
    );
    expect(found.map((c) => c.id)).toEqual([
      'claude-desktop',
      'lm-studio',
      'jan',
      'cursor',
      'vscode',
    ]);
    expect(found.map((c) => c.group)).toEqual([
      'assistant',
      'assistant',
      'assistant',
      'developer',
      'developer',
    ]);
    expect(found.find((c) => c.id === 'claude-desktop')!.state).toBe('absent');
    expect(found.find((c) => c.id === 'vscode')!.problem).toMatch(/not valid JSON/);
    expect(found.find((c) => c.id === 'cursor')!.method).toBe('link');
  });

  it('writes the Store version of Claude Desktop where that version reads it', async () => {
    app = await wiredApp('generic-fresh');
    const pkg = path.join(app.ports.folders.localAppData(), 'Packages', 'Claude_pzs8sxrjxfjjc');
    await fs.mkdir(path.join(pkg, 'LocalCache', 'Roaming', 'Claude'), { recursive: true });
    await app.invoke('mcp:setOptions', { port: 0 });
    const preview = await app.invoke<ChangePreview>('mcp:connectPreview', {
      client: 'claude-desktop',
    });
    expect(preview.files.map((f) => f.path)).toEqual([
      path.join(pkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    ]);
    expect(preview.files[0]!.change).toBe('created');
  });
});

describe('MCP-011 connecting Claude Desktop through FileStore', () => {
  it('previews, turns the server on, merges, reads back, journals, and undoes', async () => {
    app = await wiredApp('generic-fresh');
    const file = path.join(app.ports.folders.appData(), 'Claude', 'claude_desktop_config.json');
    const before = `${JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['files'] } } }, null, 2)}\n`;
    await put(file, before);
    await app.invoke('mcp:setOptions', { port: 0 });

    const preview = await app.invoke<ChangePreview>('mcp:connectPreview', {
      client: 'claude-desktop',
    });
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0]!.change).toBe('modified');
    expect((await app.ports.files.journal()).ok && (await app.ports.files.journal())).toMatchObject(
      { value: [] }
    );

    const done = await app.invoke<{ done: string; message: string; status: McpStatus }>(
      'mcp:connect',
      {
        client: 'claude-desktop',
      }
    );
    expect(done.done).toBe('written');
    expect(done.message).toMatch(/Restart|start it again/i);
    // Turned on, with the confirm policy left at "Always ask".
    expect(done.status.running).toBe(true);
    expect(done.status.confirm).toBe('ask');

    const after = JSON.parse(await fs.readFile(file, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(after.mcpServers)).toEqual(['files', 'rigready']);

    const groups = await app.ports.files.journalGroups();
    if (!groups.ok) throw new Error('journal');
    const group = groups.value.find((g) => g.reason === 'Connect Claude Desktop to RigReady')!;
    expect(group).toBeTruthy();

    // A second press writes nothing.
    const again = await app.invoke<{ done: string }>('mcp:connect', { client: 'claude-desktop' });
    expect(again.done).toBe('already');
    const groupsAgain = await app.ports.files.journalGroups();
    expect(groupsAgain.ok && groupsAgain.value.length).toBe(groups.value.length);

    const listed = await app.invoke<{ clients: DetectedClient[] }>('mcp:clients');
    expect(listed.clients.find((c) => c.id === 'claude-desktop')!.state).toBe('connected');

    const undone = await app.ports.files.undoGroup(group.id);
    expect(undone.ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('refuses a settings file that is not valid JSON and leaves it alone', async () => {
    app = await wiredApp('generic-fresh');
    const file = path.join(app.ports.folders.appData(), 'Claude', 'claude_desktop_config.json');
    await put(file, '{ "mcpServers": { "files": ');
    await app.invoke('mcp:setOptions', { port: 0 });
    await expect(app.invoke('mcp:connectPreview', { client: 'claude-desktop' })).rejects.toThrow(
      /mcp.clientFile/
    );
    await expect(app.invoke('mcp:connect', { client: 'claude-desktop' })).rejects.toThrow(
      /mcp.clientFile/
    );
    expect(await fs.readFile(file, 'utf8')).toBe('{ "mcpServers": { "files": ');
  });

  it('does not say it is connected when the file does not hold RigReady afterwards', async () => {
    app = await wiredApp('generic-fresh');
    const file = path.join(app.ports.folders.appData(), 'Claude', 'claude_desktop_config.json');
    await put(file, '{}');
    await app.invoke('mcp:setOptions', { port: 0 });
    const files = app.ports.files;
    const write = files.write.bind(files);
    // Another program puts its own copy back right after the write.
    files.write = async (target, content, options) => {
      const written = await write(target, content, options);
      await fs.writeFile(target, '{}');
      return written;
    };
    await expect(app.invoke('mcp:connect', { client: 'claude-desktop' })).rejects.toThrow(
      /does not hold RigReady/
    );
  });
});

describe('MCP-011 the other ways in', () => {
  it('hands Cursor its install link and says only that it asked', async () => {
    app = await wiredApp('generic-fresh');
    await fs.mkdir(path.join(app.ports.folders.home(), '.cursor'), { recursive: true });
    await app.invoke('mcp:setOptions', { port: 0 });
    const done = await app.invoke<{ done: string; message: string }>('mcp:connect', {
      client: 'cursor',
    });
    expect(done.done).toBe('linkOpened');
    expect(done.message).toMatch(/^Asked Cursor/);
    expect(app.ports.window.links).toHaveLength(1);
    expect(app.ports.window.links[0]).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/
    );
  });

  it('runs Claude Code with an argument array and believes it only after reading its settings', async () => {
    app = await wiredApp('generic-fresh');
    const home = app.ports.folders.home();
    const cli = path.join(home, '.local', 'bin', 'claude.exe');
    await put(cli, '');
    await put(path.join(home, '.claude.json'), '{}');
    await app.invoke('mcp:setOptions', { port: 0 });

    // The fake CLI answers 0 and writes nothing: RigReady must not call that connected.
    await expect(app.invoke('mcp:connect', { client: 'claude-code' })).rejects.toThrow(
      /not in its settings/
    );
    const call = app.ports.shell.calls.at(-1)!;
    expect(call.exe).toBe(cli);
    expect(call.args).toEqual(claudeCodeAddArgs(app.ports.shortcuts.self()));

    // A CLI that does what it says.
    const run = app.ports.shell.run.bind(app.ports.shell);
    app.ports.shell.run = async (exe, args, options) => {
      const result = await run(exe, args, options);
      const command = args[args.indexOf('--') + 1]!;
      await fs.writeFile(
        path.join(home, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            rigready: { type: 'stdio', command, args: args.slice(args.indexOf('--') + 2) },
          },
        })
      );
      return result;
    };
    const done = await app.invoke<{ done: string }>('mcp:connect', { client: 'claude-code' });
    expect(done.done).toBe('commandRan');
  });

  it('a paste-only assistant is not connected by a button', async () => {
    app = await wiredApp('generic-fresh');
    await fs.mkdir(path.join(app.ports.folders.appData(), 'Jan'), { recursive: true });
    await app.invoke('mcp:setOptions', { port: 0 });
    await expect(app.invoke('mcp:connect', { client: 'jan' })).rejects.toThrow(/pasting/);
  });
});
