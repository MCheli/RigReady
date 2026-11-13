import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedApp, type LoggedApp } from '../../../../tests/loggedApp';
import { ErrorCenter } from '../../../core/errorCenter';
import { createRedactor, maskSecrets } from '../../../core/logger';
import { BRIDGE_TOKEN_FILE } from '../../../core/mcpBridge';
import type { McpStatus } from '../contract';
import type { ActivityEntry } from './activity';
import { CLIENT_KINDS, clientConfig, needsToken } from './clientConfig';
import type { ConfirmRequest } from './confirm';

/**
 * A pairing's token lets an assistant use RigReady from this PC. These tests follow one
 * through everything the app does with it and then read what a support export, the log, the
 * clipboard after Copy diagnostics, a notice and the list of what assistants did would show:
 * none of them holds a token. Every token here is made up or was made for the test's own
 * throwaway data folder.
 */

const MADE_UP = `rr_${'5c'.repeat(32)}`;
const TOKEN_SHAPE = /rr_[0-9a-f]{16}/i;

let app: LoggedApp | undefined;
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  await app?.close();
  app = undefined;
});

async function started(): Promise<{ app: LoggedApp; url: string; token: string; bridge: string }> {
  app = await loggedApp('flying-all-good');
  expect((await app.invoke('mcp:setOptions', { port: 0 })).ok).toBe(true);
  const status = await app.invoke<McpStatus>('mcp:enable');
  if (!status.ok) throw new Error(status.error.message);
  const paired = await app.invoke<{ token: string }>('mcp:pair', { name: 'Workshop agent' });
  if (!paired.ok) throw new Error(paired.error.message);
  const bridge = await app.rig.ports.files.readText(
    path.join(app.rig.ports.folders.dataRoot(), BRIDGE_TOKEN_FILE)
  );
  if (!bridge.ok || !bridge.value) throw new Error('The bridge has no token file.');
  return {
    app,
    url: status.value.endpoint!.url,
    token: paired.value.token,
    bridge: bridge.value.trim(),
  };
}

const post = (url: string, headers: Record<string, string>): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

const caller = () => ({
  id: 'builtin-assistant',
  name: 'Built-in assistant',
  signal: new AbortController().signal,
});

/** Answers the next question an assistant's call raises, as the window would. */
function answerNextQuestion(running: LoggedApp, allow: boolean): void {
  const seen = running.events.length;
  const timer = setInterval(() => {
    const asked = running.events.slice(seen).find((e) => e.channel === 'mcp:event:confirm');
    if (!asked) return;
    clearInterval(timer);
    void running.invoke('mcp:answer', { id: (asked.payload as ConfirmRequest).id, allow });
  }, 10);
}

/** Every text a support request could carry: the log, Copy diagnostics and each file of the export. */
async function supportTexts(running: LoggedApp): Promise<Record<string, string>> {
  const exported = await running.exported();
  return {
    'the log': await running.logText(),
    'Copy diagnostics': await running.copied(),
    ...Object.fromEntries(Object.entries(exported).map(([name, text]) => [`export ${name}`, text])),
  };
}

describe('MCP-014 a pairing token never reaches the log, a support export or a notice', () => {
  it('pairing, the text to paste, Copy, a new bridge token and a refused request leave no token behind', async () => {
    const { app: running, url, token, bridge } = await started();

    // Everything the Settings page does with a token.
    for (const { kind } of CLIENT_KINDS) {
      const shown = await running.invoke<{ text: string }>('mcp:clientConfig', { kind, token });
      expect(shown.ok, kind).toBe(true);
      expect((await running.invoke('mcp:copyClientConfig', { kind, token })).ok, kind).toBe(true);
    }
    // Copy is the one place a token goes on purpose: the text the user asked for.
    expect(running.rig.ports.clipboard.copied.at(-1)).toContain(`Bearer ${token}`);

    // A request with a token of no pairing, one with none, and one from a page elsewhere.
    expect((await post(url, { authorization: `Bearer ${MADE_UP}` })).status).toBe(401);
    expect((await post(url, {})).status).toBe(401);
    const elsewhere = await post(url, {
      authorization: `Bearer ${token}`,
      origin: 'https://example.invalid',
    });
    expect(elsewhere.status).toBeGreaterThanOrEqual(400);
    // A request that is let in, so the token has been through the whole listener.
    expect((await post(url, { authorization: `Bearer ${token}` })).status).not.toBe(401);

    expect((await running.invoke('mcp:rotateBridgeToken')).ok).toBe(true);
    const rotated = await running.rig.ports.files.readText(
      path.join(running.rig.ports.folders.dataRoot(), BRIDGE_TOKEN_FILE)
    );
    const bridgeNow = rotated.ok && rotated.value ? rotated.value.trim() : '';
    expect(bridgeNow).toMatch(/^rr_[0-9a-f]{64}$/);
    expect(bridgeNow).not.toBe(bridge);

    const texts = await supportTexts(running);
    expect(Object.keys(texts)).toContain('export logs/rigready.log');
    const fingerprint = createHash('sha256').update(token).digest('hex');
    for (const [name, text] of Object.entries(texts)) {
      for (const secret of [token, bridge, bridgeNow, MADE_UP, fingerprint]) {
        expect(text.includes(secret), `${name} holds a token or its fingerprint`).toBe(false);
      }
      expect(TOKEN_SHAPE.test(text), `${name} holds something shaped like a token`).toBe(false);
      expect(/bearer\s+(?!\*)\S/i.test(text), `${name} holds an Authorization value`).toBe(false);
    }
    // Neither the token file nor the list of pairings is a file of the export.
    for (const name of Object.keys(await running.exported())) {
      expect(name).not.toMatch(/mcp|bridge|pairing/i);
    }

    // The refused requests are in the log all the same, by their reason.
    const log = texts['the log']!;
    expect(log).toContain('mcp request refused: its token belongs to no pairing');
    expect(log).toContain('mcp request refused: it carried no token');
    expect(log).toContain('mcp request refused: it came from a web page on another origin');
  });

  it('a caller that keeps trying a wrong token fills no log: one line, then a count', async () => {
    const { app: running, url } = await started();
    for (let i = 0; i < 25; i++) {
      expect((await post(url, { authorization: `Bearer ${MADE_UP}` })).status).toBe(401);
    }
    const lines = (await running.logText())
      .split('\n')
      .filter((line) => line.includes('mcp request refused'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(TOKEN_SHAPE);
  });

  it('a token in what an assistant sends or is answered is not in the question, the list or the log', async () => {
    const { app: running } = await started();
    const host = running.wiring.context.mcp.host()!;

    // In the input of a read, whole and where the length limit falls inside it.
    await host.call(caller(), 'rigready_call', {
      channel: 'profiles:get',
      input: { id: `Bearer ${MADE_UP}` },
    });
    await host.call(caller(), 'rigready_call', {
      channel: 'profiles:get',
      input: { id: `${'x'.repeat(84)} ${MADE_UP}` },
    });
    // In the input of a change: the question shows the call, and the user says no.
    answerNextQuestion(running, false);
    const refused = await host.call(caller(), 'rigready_call', {
      channel: 'profiles:remove',
      input: { id: MADE_UP },
    });
    expect(refused.ok).toBe(false);

    const asked = running.events
      .filter((e) => e.channel === 'mcp:event:confirm')
      .map((e) => e.payload as ConfirmRequest);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.detail).toContain('profiles:remove');
    const shown = running.events
      .filter((e) => e.channel === 'mcp:event:activity')
      .map((e) => e.payload as ActivityEntry);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    const listed = await running.invoke<{ entries: ActivityEntry[] }>('mcp:activity', {});
    expect(listed.ok && listed.value.entries.length).toBeGreaterThanOrEqual(3);

    const onScreen = JSON.stringify([asked, shown, listed]);
    expect(onScreen).not.toContain(MADE_UP);
    expect(onScreen).not.toMatch(TOKEN_SHAPE);
    expect(onScreen).toContain('rr_***');

    const log = await running.logText();
    expect(log).not.toMatch(TOKEN_SHAPE);
    // The refusal itself is in the log: who, which tool, how it ended.
    expect(log).toContain('an assistant call did not go through');
    expect(log).toContain('"outcome":"denied"');
    expect(log).toContain('Built-in assistant');
  });

  it('every form that starts RigReady carries no token, and only the forms by address do', () => {
    const exe = 'C:\\Program Files\\RigReady\\RigReady.exe';
    for (const { kind, title, sub } of CLIENT_KINDS) {
      const text = clientConfig(kind, { exe, args: [], port: 29170, token: MADE_UP });
      if (needsToken(kind)) {
        expect(text, kind).toContain(`Bearer ${MADE_UP}`);
        // The picker says so before the text is ever pasted anywhere.
        expect(title, kind).toContain('needs a token');
        expect(`${title} ${sub}`, kind).toMatch(/token/);
      } else {
        expect(text, kind).not.toMatch(/rr_|bearer|authorization/i);
        expect(text, kind).toContain('--mcp');
      }
    }
    // The forms with no token come first: they are what the page opens with.
    const kinds = CLIENT_KINDS.map((c) => c.kind);
    const firstByAddress = kinds.findIndex((kind) => needsToken(kind));
    expect(kinds.slice(firstByAddress).every((kind) => needsToken(kind))).toBe(true);
    expect(needsToken(kinds[0]!)).toBe(false);
  });

  it('the Claude Code form by address says where its command leaves the token, and that Forget cuts it off', async () => {
    app = await loggedApp('flying-all-good');
    const shown = await app.invoke<{ text: string; hint: string }>('mcp:clientConfig', {
      kind: 'claude-code-http',
    });
    if (!shown.ok) throw new Error(shown.error.message);
    expect(shown.value.text).toMatch(/^claude mcp add --transport http rigready /);
    expect(shown.value.hint).toContain(
      "leaves the pairing's token in your terminal's history and in Claude Code's settings, both in plain text"
    );
    expect(shown.value.hint).toContain('Forget on that pairing, below, cuts it off at once.');
  });
});

describe('MCP-014 the masking itself', () => {
  it('masks a token wherever it stands: bare, in a header, in JSON, or cut short', () => {
    const redact = createRedactor(['C:\\Users\\jane']);
    const cases = [
      `token ${MADE_UP} was used`,
      `Authorization: Bearer ${MADE_UP}`,
      `{"headers":{"Authorization":"Bearer ${MADE_UP}"}}`,
      `claude mcp add --transport http rigready http://127.0.0.1:29170/mcp --header "Authorization: Bearer ${MADE_UP}"`,
      `id=x${MADE_UP}y`,
      `cut short: ${MADE_UP.slice(0, 30)}`,
      MADE_UP.toUpperCase().replace('RR_', 'rr_'),
    ];
    for (const text of cases) {
      for (const masked of [redact(text), maskSecrets(text)]) {
        expect(masked, text).not.toMatch(TOKEN_SHAPE);
        expect(masked, text).not.toContain('5c5c5c5c');
      }
    }
    // What is not a secret stays as it was, so a line can still be read.
    expect(maskSecrets('profiles:remove {"id":"f18-carrier"}')).toBe(
      'profiles:remove {"id":"f18-carrier"}'
    );
    expect(maskSecrets('C:\\Users\\jane\\Saved Games')).toBe('C:\\Users\\jane\\Saved Games');
  });

  it('a notice about an unexpected error shows no token', () => {
    const center = new ErrorCenter(() => new Date('2026-11-12T10:00:00Z'));
    const report = center.report(
      'main',
      new Error(`fetch failed for Authorization: Bearer ${MADE_UP}`),
      `at connect (${MADE_UP})`
    );
    expect(`${report.message}\n${report.detail ?? ''}`).not.toMatch(TOKEN_SHAPE);
    expect(report.message).toContain('fetch failed');
  });
});

describe('PLAT-018 a failure of the MCP server can be explained from a support export', () => {
  it('a port another program holds: the export says which channel failed and why', async () => {
    const other = http.createServer();
    servers.push(other);
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    const taken = (other.address() as { port: number }).port;

    app = await loggedApp('flying-all-good');
    expect((await app.invoke('mcp:setOptions', { port: taken })).ok).toBe(true);
    const turnedOn = await app.invoke('mcp:enable');
    expect(turnedOn.ok).toBe(false);

    const exported = await app.exported();
    const log = exported['logs/rigready.log']!;
    expect(log).toContain('mcp:enable answered with an error');
    expect(log).toContain('"code":"mcp.portInUse"');
    expect(log).toContain(`Port ${taken} is in use by another program`);
  });

  it('a change an assistant made, and a call that failed, each leave a line with who and what', async () => {
    const { app: running } = await started();
    const host = running.wiring.context.mcp.host()!;
    const failed = await host.call(caller(), 'rigready_call', {
      channel: 'profiles:get',
      input: { id: 'no-such-setup' },
    });
    expect(failed.ok).toBe(false);
    // A read that works, and a change the user allows.
    expect((await host.call(caller(), 'rigready_channels', {})).ok).toBe(true);
    const setups = await running.invoke<{ id: string }[]>('profiles:list');
    if (!setups.ok) throw new Error(setups.error.message);
    answerNextQuestion(running, true);
    const removed = await host.call(caller(), 'rigready_call', {
      channel: 'profiles:remove',
      input: { id: setups.value[0]!.id },
    });
    expect(removed.ok).toBe(true);

    const lines = (await running.logText()).split('\n');
    const failedLine = lines.find((l) => l.includes('an assistant call did not go through'));
    expect(failedLine, 'the failed call left a line').toBeDefined();
    expect(failedLine).toContain('"client":"Built-in assistant"');
    expect(failedLine).toContain('"tool":"rigready_call"');
    expect(failedLine).toContain('"outcome":"error"');
    const ranLines = lines.filter((l) => l.includes('an assistant call ran'));
    expect(ranLines).toHaveLength(1);
    expect(ranLines[0]).toContain('"channel":"profiles:remove"');
    expect(ranLines[0]).toContain('"tier":"change"');
    // A read that worked is in the detailed log only: the normal log is not a list of reads.
    expect(lines.join('\n')).not.toContain('"tool":"rigready_channels"');
  });
});
