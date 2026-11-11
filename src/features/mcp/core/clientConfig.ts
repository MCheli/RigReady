import { MCP_PATH } from '../server/constants';

/**
 * What to paste into each client to reach RigReady. Two ways in: the stdio bridge
 * (`RigReady.exe --mcp`, which needs no token because it reads the bridge's own from the
 * encrypted store) and the HTTP endpoint with a pairing's token. Both texts are made here
 * so the Settings page, the manual and a test say the same thing.
 */

export const CLIENT_KIND_IDS = [
  'claude-desktop',
  'lm-studio',
  'anythingllm',
  'jan',
  'msty',
  'goose',
  'claude-code',
  'claude-code-http',
  'cursor',
  'cursor-http',
  'vscode',
  'windsurf',
  'http',
] as const;
export type ClientKind = (typeof CLIENT_KIND_IDS)[number];

export const CLIENT_KINDS: { kind: ClientKind; title: string; sub: string }[] = [
  {
    kind: 'claude-desktop',
    title: 'Claude Desktop',
    sub: 'claude_desktop_config.json (Settings > Developer > Edit Config), then restart Claude.',
  },
  {
    kind: 'lm-studio',
    title: 'LM Studio',
    sub: 'Program > Install > Edit mcp.json, then merge this into mcpServers.',
  },
  {
    kind: 'anythingllm',
    title: 'AnythingLLM',
    sub: 'storage\\plugins\\anythingllm_mcp_servers.json in its AppData folder, then restart AnythingLLM.',
  },
  {
    kind: 'jan',
    title: 'Jan',
    sub: 'Settings > MCP Servers > +: the name, the command and the argument below.',
  },
  {
    kind: 'msty',
    title: 'Msty Studio',
    sub: 'Toolbox > add a tool > STDIO / JSON, then paste this.',
  },
  {
    kind: 'goose',
    title: 'Goose',
    sub: 'Add this under extensions in %APPDATA%\\Block\\goose\\config\\config.yaml, then restart Goose.',
  },
  {
    kind: 'claude-code',
    title: 'Claude Code',
    sub: 'One command in a terminal; --scope user makes it work in every folder.',
  },
  {
    kind: 'claude-code-http',
    title: 'Claude Code, over HTTP',
    sub: 'The same without the bridge: Claude Code talks to the running RigReady directly.',
  },
  { kind: 'cursor', title: 'Cursor', sub: '~/.cursor/mcp.json or .cursor/mcp.json in a project.' },
  {
    kind: 'cursor-http',
    title: 'Cursor, over HTTP',
    sub: 'The same with the endpoint and the token.',
  },
  { kind: 'vscode', title: 'VS Code', sub: '.vscode/mcp.json, or MCP: Open User Configuration.' },
  {
    kind: 'windsurf',
    title: 'Windsurf',
    sub: 'Cascade > MCP servers > View raw config (mcp_config.json), merge this into mcpServers.',
  },
  { kind: 'http', title: 'Any other client', sub: 'The endpoint and the header to send.' },
];

export interface ConfigInputs {
  /** How this copy of RigReady is started: the program and the arguments that come first. */
  exe: string;
  args: string[];
  /** The port the server listens on, when it does. */
  port: number;
  /** A pairing's token, for the HTTP forms. Absent: a placeholder the user replaces. */
  token?: string;
}

export const endpointUrl = (port: number): string => `http://127.0.0.1:${port}${MCP_PATH}`;

const TOKEN_PLACEHOLDER = '<token from the Settings page>';

/** The text for one client. */
export function clientConfig(kind: ClientKind, inputs: ConfigInputs): string {
  const stdio = { command: inputs.exe, args: [...inputs.args, '--mcp'] };
  const url = endpointUrl(inputs.port);
  const bearer = `Bearer ${inputs.token ?? TOKEN_PLACEHOLDER}`;
  switch (kind) {
    case 'claude-desktop':
    case 'lm-studio':
    case 'anythingllm':
    case 'windsurf':
      return JSON.stringify({ mcpServers: { rigready: stdio } }, null, 2);
    case 'msty':
      return JSON.stringify(stdio, null, 2);
    case 'jan':
      return [
        'Server Name: rigready',
        `Command: ${stdio.command}`,
        `Arguments: ${stdio.args.join(' ')}`,
      ].join('\n');
    case 'goose':
      // Double-quoted YAML strings take the same escapes as JSON.
      return [
        'extensions:',
        '  rigready:',
        '    name: RigReady',
        '    type: stdio',
        `    cmd: ${JSON.stringify(stdio.command)}`,
        `    args: [${stdio.args.map((a) => JSON.stringify(a)).join(', ')}]`,
        '    enabled: true',
        '    timeout: 300',
      ].join('\n');
    case 'claude-code':
      return `claude mcp add --transport stdio --scope user rigready -- ${quote(stdio.command)}${stdio.args.map((a) => ` ${quote(a)}`).join('')}`;
    case 'claude-code-http':
      return `claude mcp add --transport http rigready ${url} --header "Authorization: ${bearer}"`;
    case 'cursor':
      return JSON.stringify({ mcpServers: { rigready: stdio } }, null, 2);
    case 'cursor-http':
      return JSON.stringify(
        { mcpServers: { rigready: { url, headers: { Authorization: bearer } } } },
        null,
        2
      );
    case 'vscode':
      return JSON.stringify({ servers: { rigready: { type: 'stdio', ...stdio } } }, null, 2);
    case 'http':
      return [
        `Endpoint: ${url}`,
        `Header: Authorization: ${bearer}`,
        'Transport: Streamable HTTP (POST only for 2025-era clients; sessions are not kept).',
      ].join('\n');
  }
}

/**
 * A command-line argument quoted the way Windows splits a command line
 * (CommandLineToArgvW): backslashes are literal except in a run before a double quote,
 * where each must be doubled, as must a run at the very end inside the quotes. Windows
 * paths keep their single backslashes.
 */
export function quote(value: string): string {
  if (!/[\s"]/.test(value)) return value;
  const escaped = value
    .replace(/(\\*)"/g, (_m, slashes: string) => `${slashes}${slashes}\\"`)
    .replace(/(\\+)$/, (_m, slashes: string) => `${slashes}${slashes}`);
  return `"${escaped}"`;
}
