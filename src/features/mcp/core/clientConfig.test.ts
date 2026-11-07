import { describe, expect, it } from 'vitest';
import { CLIENT_KINDS, clientConfig } from './clientConfig';

const exe = 'C:\Users\Pilot One\AppData\Local\Programs\RigReady\RigReady.exe';
const token = `rr_${'a'.repeat(64)}`;

describe('MCP-005 what to paste into each assistant', () => {
  it('gives every client the text that reaches this RigReady, stdio through --mcp and HTTP with the token', () => {
    for (const { kind } of CLIENT_KINDS) {
      const text = clientConfig(kind, { exe, args: [], port: 29170, token });
      if (kind.startsWith('claude-desktop') || kind === 'cursor' || kind === 'vscode') {
        const parsed = JSON.parse(text) as Record<
          string,
          Record<string, { command: string; args: string[] }>
        >;
        const server = (parsed['mcpServers'] ?? parsed['servers'])!['rigready']!;
        expect(server.command, kind).toBe(exe);
        expect(server.args, kind).toEqual(['--mcp']);
        expect(text, kind).not.toContain(token);
      } else if (kind === 'claude-code') {
        expect(text).toBe(`claude mcp add --transport stdio rigready -- "${exe}" --mcp`);
      } else {
        expect(text, kind).toContain('http://127.0.0.1:29170/mcp');
        expect(text, kind).toContain(`Bearer ${token}`);
      }
    }
  });

  it('shows a placeholder where a token belongs until one is paired, and passes the arguments a dev build needs', () => {
    const text = clientConfig('cursor-http', { exe, args: [], port: 29170 });
    expect(text).toContain('<token from the Settings page>');
    const dev = JSON.parse(
      clientConfig('claude-desktop', { exe: 'electron.exe', args: ['C:\repo'], port: 1 })
    ) as { mcpServers: { rigready: { args: string[] } } };
    expect(dev.mcpServers.rigready.args).toEqual(['C:\repo', '--mcp']);
  });
});
