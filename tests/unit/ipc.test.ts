import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { err, ok } from '../../src/core/result';
import { bind } from '../../src/core/feature';
import { CHANNEL_PATTERN, EVENT_PATTERN, channelName, eventName } from '../../src/shared/channels';
import {
  channel,
  createClient,
  createInvoker,
  defineContract,
  noInput,
  type Bridge,
} from '../../src/shared/ipc';
import { appContract } from '../../src/shared/appContract';

const contract = defineContract(
  'demo',
  {
    add: channel(z.object({ a: z.number(), b: z.number() }), z.object({ sum: z.number() })),
    ping: channel(noInput, z.string()),
    fails: channel(noInput, z.string()),
    throws: channel(noInput, z.string()),
    lies: channel(noInput, z.string()),
  },
  { changed: z.object({ id: z.string() }) }
);

const handlers = {
  add: async ({ a, b }: { a: number; b: number }) => ok({ sum: a + b }),
  ping: async () => ok('pong'),
  fails: async () => err('demo.no', 'Expected failure'),
  throws: async (): Promise<never> => {
    throw new Error('bug');
  },
  lies: async () => ok(5 as unknown as string),
};

describe('contracts', () => {
  it('names channels and events from the feature id and matches the preload patterns', () => {
    expect(channelName('demo', 'add')).toBe('demo:add');
    expect(eventName('demo', 'changed')).toBe('demo:event:changed');
    expect(CHANNEL_PATTERN.test('demo:add')).toBe(true);
    expect(CHANNEL_PATTERN.test('demo:event:changed')).toBe(false);
    expect(CHANNEL_PATTERN.test('../evil')).toBe(false);
    expect(EVENT_PATTERN.test('demo:event:changed')).toBe(true);
    expect(() => defineContract('Bad Name', {})).toThrow(/Invalid feature id/);
    expect(appContract.feature).toBe('app');
  });
});

describe('createInvoker', () => {
  const onError = vi.fn();
  const invoke = createInvoker(contract, handlers, onError);

  it('validates input, runs the handler and validates output', async () => {
    expect(await invoke('add', { a: 2, b: 3 })).toEqual(ok({ sum: 5 }));
    expect(await invoke('ping', undefined)).toEqual(ok('pong'));
    expect(await invoke('ping', null)).toEqual(ok('pong'));
  });

  it('rejects invalid input without calling the handler', async () => {
    expect(await invoke('add', { a: '2', b: 3 })).toMatchObject({
      ok: false,
      error: { code: 'ipc.input' },
    });
    expect(await invoke('add', undefined)).toMatchObject({
      ok: false,
      error: { code: 'ipc.input' },
    });
  });

  it('passes expected failures through and contains unexpected ones', async () => {
    expect(await invoke('fails', undefined)).toEqual(err('demo.no', 'Expected failure'));
    expect(await invoke('throws', undefined)).toMatchObject({
      ok: false,
      error: { code: 'ipc.handler', detail: 'bug' },
    });
    expect(await invoke('lies', undefined)).toMatchObject({
      ok: false,
      error: { code: 'ipc.output' },
    });
    expect(await invoke('nope', undefined)).toMatchObject({
      ok: false,
      error: { code: 'ipc.unknown' },
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('bind pairs a contract with handlers', () => {
    const binding = bind(contract, handlers);
    expect(binding.contract.feature).toBe('demo');
    expect(Object.keys(binding.handlers)).toContain('add');
  });
});

describe('createClient', () => {
  it('calls through the bridge with generated channel names', async () => {
    const calls: [string, unknown][] = [];
    const bridge: Bridge = {
      invoke: async (name, input) => {
        calls.push([name, input]);
        return ok({ sum: 9 });
      },
      on: () => () => {},
    };
    const client = createClient(contract, bridge);
    expect(await client.add({ a: 4, b: 5 })).toEqual(ok({ sum: 9 }));
    await client.ping();
    expect(calls).toEqual([
      ['demo:add', { a: 4, b: 5 }],
      ['demo:ping', undefined],
    ]);
  });

  it('subscribes to events, validates payloads and unsubscribes', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const bridge: Bridge = {
      invoke: async () => ok(null),
      on: (name, listener) => {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
    };
    const client = createClient(contract, bridge);
    const seen: string[] = [];
    const off = client.on('changed', (payload) => seen.push(payload.id));
    listeners.get('demo:event:changed')!({ id: 'a' });
    listeners.get('demo:event:changed')!({ wrong: true });
    expect(seen).toEqual(['a']);
    off();
    expect(listeners.size).toBe(0);
    expect(() => client.on('nope' as 'changed', () => {})).toThrow(/Unknown event/);
  });
});
