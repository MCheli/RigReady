import { describe, expect, it } from 'vitest';
import { CLIENT_KINDS, clientConfig, quote } from './clientConfig';

const exe = 'C:\Users\Pilot One\AppData\Local\Programs\RigReady\RigReady.exe';
const token = `rr_${'a'.repeat(64)}`;

describe('MCP-005 what to paste into each assistant', () => {
  it('gives every client the text that reaches this RigReady, stdio through --mcp and HTTP with the token', () => {
    for (const { kind } of CLIENT_KINDS) {
      const text = clientConfig(kind, { exe, args: [], port: 29170, token });
      const json = ['claude-desktop', 'lm-studio', 'anythingllm', 'windsurf', 'cursor', 'vscode'];
      if (json.includes(kind)) {
        const parsed = JSON.parse(text) as Record<
          string,
          Record<string, { command: string; args: string[] }>
        >;
        const server = (parsed['mcpServers'] ?? parsed['servers'])!['rigready']!;
        expect(server.command, kind).toBe(exe);
        expect(server.args, kind).toEqual(['--mcp']);
        expect(text, kind).not.toContain(token);
      } else if (kind === 'msty') {
        expect(JSON.parse(text)).toEqual({ command: exe, args: ['--mcp'] });
      } else if (kind === 'jan' || kind === 'goose') {
        expect(text, kind).toContain(kind === 'goose' ? JSON.stringify(exe) : exe);
        expect(text, kind).toContain('--mcp');
        expect(text, kind).not.toContain(token);
      } else if (kind === 'claude-code') {
        expect(text).toBe(
          `claude mcp add --transport stdio --scope user rigready -- "${exe}" --mcp`
        );
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

describe('quoting an argument for a Windows command line', () => {
  const bs = String.fromCharCode(92);
  it('leaves a plain argument alone and keeps the single backslashes of a path', () => {
    expect(quote('--mcp')).toBe('--mcp');
    const path = ['C:', 'Program Files', 'RigReady', 'RigReady.exe'].join(bs);
    expect(quote(path)).toBe(`"${path}"`);
  });

  it('escapes a quote, doubles the backslashes before it, and doubles a trailing run', () => {
    expect(quote('say "hi"')).toBe(`"say ${bs}"hi${bs}""`);
    expect(quote(`a${bs}"b c`)).toBe(`"a${bs}${bs}${bs}"b c"`);
    expect(quote(`C:${bs}My Folder${bs}`)).toBe(`"C:${bs}My Folder${bs}${bs}"`);
  });
});
