import { afterEach, describe, expect, it } from 'vitest';
import type { InputState } from '../../src/shared/models';
import { wiredApp, type WiredApp } from '../helpers';

/**
 * WiredApp.event: how a unit test waits for an event of the main side. It is settled by the
 * sending of the event and by nothing else, so it cannot give up early on a loaded PC.
 */

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const press = (button: number): InputState => ({
  index: 10,
  name: 'controller 10',
  axes: [],
  buttons: Array.from({ length: 8 }, (_, i) => i + 1 === button),
  hats: [],
  timestamp: 0,
});

/** Whether a promise is settled already, asked without waiting for it. */
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => (done = true));
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

const pressed = (payload: { states: InputState[] }): number[] =>
  payload.states.map((s) => s.buttons.indexOf(true) + 1);

describe('waiting for an event of the wired app', () => {
  it('hands back an event that was sent before the test asked', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    await app.invoke('devices:watchInput', { client: 'a', on: true });
    const sent = app.events.find((e) => e.channel === 'devices:event:controllers')!;
    expect(sent).toBeDefined();
    expect(await app.event('devices:event:controllers')).toBe(sent.payload);
  });

  it('waits for an event that comes later and is settled when it is sent, not before', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    await app.invoke('devices:watchInput', { client: 'a', on: true });
    const input = app.event<{ states: InputState[] }>('devices:event:input');
    const again = app.event<{ states: InputState[] }>('devices:event:input');
    // Events on other channels were sent; none on this one.
    expect(app.events.length).toBeGreaterThan(0);
    expect(await settled(input)).toBe(false);

    app.ports.input.emit([press(3)]);
    const payload = await input;
    expect(pressed(payload)).toEqual([3]);
    // It is the event that is in the list, and everyone who waited for it has it.
    expect(app.events.filter((e) => e.channel === 'devices:event:input')).toEqual([
      { channel: 'devices:event:input', payload },
    ]);
    expect(await again).toBe(payload);
  });

  it('with a place to look from, leaves out the events before it', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    await app.invoke('devices:watchInput', { client: 'a', on: true });
    app.ports.input.emit([press(3)]);
    const first = await app.event<{ states: InputState[] }>('devices:event:input');

    const next = app.event<{ states: InputState[] }>('devices:event:input', app.events.length);
    expect(await settled(next)).toBe(false);
    app.ports.input.emit([press(5)]);
    expect(pressed(await next)).toEqual([5]);
    // Without a place to look from it is still the first one.
    expect(await app.event('devices:event:input')).toBe(first);
  });
});
