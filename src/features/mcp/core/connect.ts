import path from 'node:path';
import { type ConnectClient, type ConnectMethod, type DetectedClient } from './connectSchema';
import type { FileStore, KnownFolders } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { clientConfig, type ClientKind } from './clientConfig';

/**
 * "Connect an assistant": which AI assistants are on this PC, whether RigReady is already
 * in their settings, and the simplest safe way to put it there. Detection only reads
 * (folders and files that exist); the ways in are:
 *
 * - `config`: RigReady merges its entry into the assistant's own JSON file, through
 *   FileStore (backup, preview, journal, undo on the Safety page). Other servers are kept;
 *   a file that is not valid JSON is refused, never replaced.
 * - `link`: the assistant's own install link (Cursor, VS Code, LM Studio), built from a
 *   fixed configuration; the assistant asks the user before it adds anything.
 * - `command`: Claude Code's one command, shown with a copy button, and run with an
 *   argument array when the CLI is found and the user presses "Run it".
 * - `paste`: the text to paste, for an assistant that keeps its servers in its own screens.
 *
 * Research and sources: docs/research/mcp-one-click.md.
 */

export type { ConnectClient, DetectedClient } from './connectSchema';

export const SERVER_NAME = 'rigready';

/** How this copy of RigReady is started: the program and the arguments that come first. */
export interface Self {
  exe: string;
  args: string[];
}

export const stdioEntry = (self: Self): { command: string; args: string[] } => ({
  command: self.exe,
  args: [...self.args, '--mcp'],
});

type Files = Pick<FileStore, 'exists' | 'readText' | 'list'>;
interface Env {
  files: Files;
  folders: Pick<KnownFolders, 'home' | 'appData' | 'localAppData'>;
}

interface ClientDef {
  id: ConnectClient;
  title: string;
  group: 'assistant' | 'developer';
  method: ConnectMethod;
  kind: ClientKind;
  after: string;
  /** Folders or files whose presence says it is installed, in order of preference. */
  marks(env: Env): Promise<string[]>;
  /** The JSON file that holds its servers, and the key they are under. */
  config?(env: Env, found: string): { file: string; key: 'mcpServers' | 'servers' };
  /** Claude Code's CLI. */
  cli?(env: Env): string[];
}

const join = path.win32.join;

/** Claude Desktop from the Microsoft Store keeps its settings inside its package folder. */
async function claudePackages(env: Env): Promise<string[]> {
  const packages = join(env.folders.localAppData(), 'Packages');
  const names = await env.files.list(packages);
  if (!names.ok) return [];
  return names.value
    .filter((name) => /^Claude_[a-z0-9]+$/i.test(name))
    .map((name) => join(packages, name, 'LocalCache', 'Roaming', 'Claude'));
}

export const CLIENTS: readonly ClientDef[] = [
  {
    id: 'claude-desktop',
    title: 'Claude Desktop',
    group: 'assistant',
    method: 'config',
    kind: 'claude-desktop',
    after: 'Quit Claude Desktop (from the tray too) and start it again.',
    marks: async (env) => [
      ...(await claudePackages(env)),
      join(env.folders.appData(), 'Claude'),
      join(env.folders.localAppData(), 'AnthropicClaude'),
    ],
    config: (env, found) => ({
      // The Store version reads the file in its package folder; every other install the
      // one in AppData\Roaming\Claude.
      file: join(
        /LocalCache/i.test(found) ? found : join(env.folders.appData(), 'Claude'),
        'claude_desktop_config.json'
      ),
      key: 'mcpServers',
    }),
  },
  {
    id: 'lm-studio',
    title: 'LM Studio',
    group: 'assistant',
    method: 'link',
    kind: 'lm-studio',
    after: 'LM Studio shows what will be added; confirm it there.',
    marks: async (env) => [join(env.folders.home(), '.lmstudio')],
    config: (env) => ({
      file: join(env.folders.home(), '.lmstudio', 'mcp.json'),
      key: 'mcpServers',
    }),
  },
  {
    id: 'anythingllm',
    title: 'AnythingLLM',
    group: 'assistant',
    method: 'config',
    kind: 'anythingllm',
    after: 'Restart AnythingLLM, or press Refresh on its Agent Skills page.',
    marks: async (env) => [join(env.folders.appData(), 'anythingllm-desktop')],
    config: (env) => ({
      file: join(
        env.folders.appData(),
        'anythingllm-desktop',
        'storage',
        'plugins',
        'anythingllm_mcp_servers.json'
      ),
      key: 'mcpServers',
    }),
  },
  {
    id: 'jan',
    title: 'Jan',
    group: 'assistant',
    method: 'paste',
    kind: 'jan',
    after: 'In Jan: Settings > MCP Servers > +, and fill in the three fields.',
    marks: async (env) => [join(env.folders.appData(), 'Jan')],
  },
  {
    id: 'msty',
    title: 'Msty Studio',
    group: 'assistant',
    method: 'paste',
    kind: 'msty',
    after: 'In Msty Studio: Toolbox > add a tool > STDIO / JSON, and paste.',
    marks: async (env) => [
      join(env.folders.appData(), 'MstyStudio'),
      join(env.folders.appData(), 'Msty'),
      join(env.folders.localAppData(), 'Programs', 'MstyStudio'),
      join(env.folders.localAppData(), 'Programs', 'Msty'),
    ],
  },
  {
    id: 'goose',
    title: 'Goose',
    group: 'assistant',
    method: 'paste',
    kind: 'goose',
    after: 'Add it to config.yaml under extensions, then restart Goose.',
    marks: async (env) => [join(env.folders.appData(), 'Block', 'goose')],
  },
  {
    id: 'claude-code',
    title: 'Claude Code',
    group: 'developer',
    method: 'command',
    kind: 'claude-code',
    after: 'Start a new Claude Code session; /mcp lists RigReady.',
    marks: async (env) => [
      join(env.folders.home(), '.claude.json'),
      join(env.folders.home(), '.claude'),
    ],
    config: (env) => ({ file: join(env.folders.home(), '.claude.json'), key: 'mcpServers' }),
    cli: (env) => [
      join(env.folders.home(), '.local', 'bin', 'claude.exe'),
      join(env.folders.appData(), 'npm', 'claude.cmd'),
    ],
  },
  {
    id: 'cursor',
    title: 'Cursor',
    group: 'developer',
    method: 'link',
    kind: 'cursor',
    after: 'Cursor opens its MCP settings with RigReady filled in; press Install there.',
    marks: async (env) => [
      join(env.folders.home(), '.cursor'),
      join(env.folders.localAppData(), 'Programs', 'cursor'),
    ],
    config: (env) => ({ file: join(env.folders.home(), '.cursor', 'mcp.json'), key: 'mcpServers' }),
  },
  {
    id: 'vscode',
    title: 'VS Code',
    group: 'developer',
    method: 'link',
    kind: 'vscode',
    after: 'VS Code shows the server; press Install there, then Start in the chat tools list.',
    marks: async (env) => [
      join(env.folders.appData(), 'Code', 'User'),
      join(env.folders.localAppData(), 'Programs', 'Microsoft VS Code'),
    ],
    config: (env) => ({
      file: join(env.folders.appData(), 'Code', 'User', 'mcp.json'),
      key: 'servers',
    }),
  },
  {
    id: 'windsurf',
    title: 'Windsurf',
    group: 'developer',
    method: 'paste',
    kind: 'windsurf',
    after: 'In Windsurf: Cascade > MCP servers > View raw config, merge and save.',
    marks: async (env) => [join(env.folders.home(), '.codeium', 'windsurf')],
  },
];

export const clientDef = (id: ConnectClient): ClientDef => CLIENTS.find((c) => c.id === id)!;

/** A JSON file as text: the BOM some editors write is not part of it. */
const stripBom = (text: string): string => text.replace(/^﻿/, '');

type Parsed = { ok: true; value: Record<string, unknown> } | { ok: false; why: string };

/** Parses an assistant's settings file. Empty is an empty object; anything but an object is refused. */
export function parseSettings(text: string | undefined): Parsed {
  const body = stripBom(text ?? '').trim();
  if (body === '') return { ok: true, value: {} };
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (e) {
    // Reported to the user as the reason the file is left alone.
    return { ok: false, why: `It is not valid JSON (${(e as Error).message}).` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, why: 'It does not hold a JSON object.' };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

const sameEntry = (found: unknown, entry: { command: string; args: string[] }): boolean => {
  if (typeof found !== 'object' || found === null) return false;
  const f = found as { command?: unknown; args?: unknown };
  return (
    typeof f.command === 'string' &&
    f.command.toLowerCase() === entry.command.toLowerCase() &&
    Array.isArray(f.args) &&
    JSON.stringify(f.args) === JSON.stringify(entry.args)
  );
};

/** Whether `settings` already has RigReady under `key`, pointing at this copy. */
export function entryState(
  settings: Record<string, unknown>,
  key: string,
  entry: { command: string; args: string[] }
): 'connected' | 'different' | 'absent' {
  const servers = settings[key];
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return 'absent';
  const found = (servers as Record<string, unknown>)[SERVER_NAME];
  if (found === undefined) return 'absent';
  return sameEntry(found, entry) ? 'connected' : 'different';
}

/**
 * The file with RigReady's entry merged in. Every other key and every other server stays as
 * it was; an entry named rigready is replaced by this one. Unchanged when it is already
 * there (so a second press writes nothing). Refuses a file that is not a JSON object, or
 * whose server list is not an object, rather than replace what the user has.
 */
export function mergeEntry(
  text: string | undefined,
  key: 'mcpServers' | 'servers',
  entry: { command: string; args: string[] }
): Result<{ text: string; changed: boolean }> {
  const parsed = parseSettings(text);
  if (!parsed.ok) {
    return err('mcp.clientFile', `RigReady will not change this file. ${parsed.why}`);
  }
  const settings = parsed.value;
  const servers = settings[key];
  if (
    servers !== undefined &&
    (typeof servers !== 'object' || servers === null || Array.isArray(servers))
  ) {
    return err(
      'mcp.clientFile',
      `RigReady will not change this file: "${key}" is not a list of servers.`
    );
  }
  if (entryState(settings, key, entry) === 'connected') {
    return ok({ text: text ?? '', changed: false });
  }
  const next = {
    ...settings,
    [key]: { ...((servers as Record<string, unknown> | undefined) ?? {}), [SERVER_NAME]: entry },
  };
  return ok({ text: `${JSON.stringify(next, null, 2)}\n`, changed: true });
}

const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

/** The install link of a `link` client, built from the fixed entry and nothing else. */
export function installLink(id: ConnectClient, self: Self): string | undefined {
  const entry = stdioEntry(self);
  switch (id) {
    case 'cursor':
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(base64(JSON.stringify(entry)))}`;
    case 'vscode':
      return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: 'stdio', ...entry }))}`;
    case 'lm-studio':
      return `lmstudio://add_mcp?name=${SERVER_NAME}&config=${encodeURIComponent(base64(JSON.stringify(entry)))}`;
    default:
      return undefined;
  }
}

/** The arguments of `claude mcp add` for this copy of RigReady, for every folder (user scope). */
export const claudeCodeAddArgs = (self: Self): string[] => {
  const entry = stdioEntry(self);
  return [
    'mcp',
    'add',
    '--transport',
    'stdio',
    '--scope',
    'user',
    SERVER_NAME,
    '--',
    entry.command,
    ...entry.args,
  ];
};
export const claudeCodeRemoveArgs = (): string[] => [
  'mcp',
  'remove',
  '--scope',
  'user',
  SERVER_NAME,
];

/** The text a client's fallback shows: the same as the Settings page's "by hand" form. */
export const pasteText = (id: ConnectClient, self: Self, port: number): string =>
  clientConfig(clientDef(id).kind, { exe: self.exe, args: self.args, port });

async function firstExisting(files: Files, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) if (await files.exists(candidate)) return candidate;
  return undefined;
}

async function readSettings(
  files: Files,
  file: string
): Promise<{ parsed?: Parsed; text?: string; missing: boolean; error?: string }> {
  if (!(await files.exists(file))) return { missing: true };
  const text = await files.readText(file);
  if (!text.ok) return { missing: false, error: text.error.message };
  return { parsed: parseSettings(text.value), text: text.value, missing: false };
}

/** One client, when it is installed: where, whether RigReady is in it, and what can be done. */
export async function detectClient(
  env: Env,
  def: ClientDef,
  self: Self
): Promise<DetectedClient | undefined> {
  const found = await firstExisting(env.files, await def.marks(env));
  if (!found) return undefined;
  const view: DetectedClient = {
    id: def.id,
    title: def.title,
    group: def.group,
    method: def.method,
    found,
    state: 'unknown',
    after: def.after,
    kind: def.kind,
  };
  if (def.cli) {
    const cli = await firstExisting(env.files, def.cli(env));
    if (cli) view.cli = cli;
  }
  if (def.config) {
    const { file, key } = def.config(env, found);
    view.file = file;
    const read = await readSettings(env.files, file);
    if (read.missing) view.state = 'absent';
    else if (read.error) view.problem = read.error;
    else if (read.parsed && !read.parsed.ok)
      view.problem = `RigReady will not change ${path.win32.basename(file)}. ${read.parsed.why}`;
    else if (read.parsed?.ok) view.state = entryState(read.parsed.value, key, stdioEntry(self));
  }
  return view;
}

/** Every assistant found on this PC, general assistants first. Reads only. */
export async function detectClients(env: Env, self: Self): Promise<DetectedClient[]> {
  const found: DetectedClient[] = [];
  for (const def of CLIENTS) {
    const client = await detectClient(env, def, self);
    if (client) found.push(client);
  }
  return found;
}

/** The planned write of a `config` client: its file, and the text with RigReady merged in. */
export async function configPlan(
  env: Env,
  id: ConnectClient,
  self: Self
): Promise<Result<{ file: string; text: string; changed: boolean; title: string }>> {
  const def = clientDef(id);
  if (def.method !== 'config' || !def.config) {
    return err('mcp.connect', `${def.title} is not connected by changing a file.`);
  }
  const found = await firstExisting(env.files, await def.marks(env));
  if (!found) return err('mcp.connect', `${def.title} was not found on this PC.`);
  const { file, key } = def.config(env, found);
  const read = await readSettings(env.files, file);
  if (read.error) return err('mcp.clientFile', `Could not read ${file}.`, read.error);
  const merged = mergeEntry(read.text, key, stdioEntry(self));
  if (!merged.ok) return merged;
  return ok({ file, ...merged.value, title: def.title });
}

/** Read back after a write or a command: is RigReady in the file now? */
export async function connectedIn(env: Env, id: ConnectClient, self: Self): Promise<boolean> {
  const def = clientDef(id);
  const found = await firstExisting(env.files, await def.marks(env));
  if (!found || !def.config) return false;
  const { file, key } = def.config(env, found);
  const read = await readSettings(env.files, file);
  return (
    read.parsed?.ok === true && entryState(read.parsed.value, key, stdioEntry(self)) === 'connected'
  );
}
