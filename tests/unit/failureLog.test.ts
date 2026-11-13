import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { logFailures, SAME_FAILURE_EVERY_MS } from '../../src/core/failureLog';
import { bind } from '../../src/core/feature';
import { createLogger, createRedactor, parseLog } from '../../src/core/logger';
import { err, ok } from '../../src/core/result';
import { channel, defineContract } from '../../src/shared/ipc';
import { mutate, TestClock } from '../helpers';
import { loggedApp } from '../loggedApp';

/**
 * A feature that answers with an error leaves a line in the log, so a support export says
 * what the user was told. What the line may hold is as narrow as it can be: the channel, the
 * error's code and its message.
 */

const contract = defineContract('demo', {
  save: channel(z.object({ text: z.string() }), z.object({ saved: z.boolean() }), {
    describe: 'Saves.',
    tier: 'change',
  }),
  stop: channel(z.object({}), z.object({}), { describe: 'Stops.', tier: 'read' }),
  stopAssistant: channel(z.object({}), z.object({}), { describe: 'Stops.', tier: 'read' }),
});

function wired(outcome: 'fails' | 'works') {
  const lines: string[] = [];
  const clock = new TestClock();
  const log = createLogger({ write: (line) => lines.push(line) }, clock, 'info', 'demo', {
    redact: createRedactor(),
  });
  const binding = logFailures(
    bind(contract, {
      save: async () =>
        outcome === 'works'
          ? ok({ saved: true })
          : err('demo.full', 'The folder is full.', 'ENOSPC at C:\\Users\\jane\\x.yaml'),
      stop: async () => err('http.cancelled', 'Stopped.'),
      // What the built-in assistant answers when the user presses its Stop (ai-assist wire.ts).
      stopAssistant: async () =>
        err('ai.stopped', 'Stopped before the answer came. Nothing was changed.'),
    }),
    log,
    clock
  );
  const call = (key: string, input: unknown): Promise<unknown> =>
    binding.handlers[key]!(input as never);
  return { call, clock, entries: () => parseLog(lines.join('')) };
}

describe('PLAT-018 a channel that answers with an error leaves a line in the log', () => {
  it('writes the channel, the code and the message, and passes the answer on unchanged', async () => {
    const { call, entries } = wired('fails');
    const answer = await call('save', { text: 'SECRET-WORDS-OF-THE-USER' });
    expect(answer).toMatchObject({ ok: false, error: { code: 'demo.full' } });
    const lines = entries();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('info');
    expect(lines[0]!.text).toContain('demo:save answered with an error');
    expect(lines[0]!.text).toContain('"code":"demo.full"');
    expect(lines[0]!.text).toContain('The folder is full.');
  });

  it('never writes what the channel was given, nor the detail of the error', async () => {
    const { call, entries } = wired('fails');
    await call('save', { text: 'SECRET-WORDS-OF-THE-USER' });
    const all = entries()
      .map((e) => e.text)
      .join('\n');
    expect(all).not.toContain('SECRET-WORDS-OF-THE-USER');
    expect(all).not.toContain('ENOSPC');
    expect(all).not.toContain('jane');
  });

  it('writes nothing for an answer that worked, nor for a Stop the user pressed', async () => {
    const { call, entries } = wired('works');
    expect(await call('save', { text: 'x' })).toMatchObject({ ok: true });
    expect(await call('stop', {})).toMatchObject({ ok: false });
    expect(await call('stopAssistant', {})).toMatchObject({ ok: false });
    expect(entries()).toEqual([]);
  });

  it('cuts a very long message, so one failure never fills the log', async () => {
    const lines: string[] = [];
    const clock = new TestClock();
    const log = createLogger({ write: (line) => lines.push(line) }, clock, 'info');
    const binding = logFailures(
      bind(contract, {
        save: async () => err('demo.long', 'x'.repeat(5000)),
        stop: async () => ok({}),
        stopAssistant: async () => ok({}),
      }),
      log,
      clock
    );
    await binding.handlers['save']!({ text: '' } as never);
    expect(lines.join('').length).toBeLessThan(600);
  });

  it('a page that keeps asking fills no log: the same error once a minute, with a count', async () => {
    const { call, clock, entries } = wired('fails');
    for (let i = 0; i < 5; i++) await call('save', { text: '' });
    expect(entries()).toHaveLength(1);
    clock.advance(SAME_FAILURE_EVERY_MS);
    await call('save', { text: '' });
    const lines = entries();
    expect(lines).toHaveLength(2);
    expect(lines[1]!.text).toContain('"moreSinceTheLastLine":4');
  });
});

describe('PLAT-018 every feature of the app writes that line, whatever it is', () => {
  it('a failing path of each of these features leaves a line with its channel and code', async () => {
    const app = await loggedApp('generic-fresh', { files: [] });
    try {
      await mutate(app.rig, [{ op: 'failProvider', port: 'audio', message: 'No audio service.' }]);
      // One call that cannot work, per feature: what a click on a stale screen would send.
      const failing: [channel: string, input: unknown][] = [
        ['audio:view', undefined],
        ['diagnostics:copyError', { id: 'no-such-error' }],
        ['backup:restoreSnapshotPreview', { id: 'no-such-snapshot' }],
        ['ai-assist:assistantSend', { requestId: 'no-such-request' }],
        ['ai-assist:send', { requestId: 'no-such-request' }],
        ['mcp:clientConfig', { kind: 'no-such-client' }],
      ];
      const codes: string[] = [];
      for (const [channel, input] of failing) {
        const answer = await app.invoke(channel, input);
        expect(answer.ok, channel).toBe(false);
        if (!answer.ok) codes.push(answer.error.code);
      }
      const lines = (await app.logText()).split('\n');
      failing.forEach(([channel], i) => {
        const line = lines.find((l) => l.includes(`${channel} answered with an error`));
        // A call the contract refuses before the feature sees it is in the detailed log only.
        if (codes[i] === 'ipc.input') return;
        expect(line, channel).toBeDefined();
        expect(line).toContain(`[${channel.split(':')[0]}]`);
        expect(line).toContain(`"code":"${codes[i]}"`);
      });
      expect(lines.filter((l) => l.includes('answered with an error')).length).toBeGreaterThan(3);
      // And the export a user sends holds the same lines.
      const zip = await app.exported();
      expect(zip['logs/rigready.log']).toContain('audio:view answered with an error');
      expect(zip['logs/rigready.log']).toContain('No audio service.');
    } finally {
      await app.close();
    }
  });
});
