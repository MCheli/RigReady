import { afterEach, describe, expect, it, vi } from 'vitest';
import { wiredApp, type WiredApp } from '../../../tests/helpers';
import type { InputDevice, InputState } from '../../shared/models';
import type { LiveDevice } from './core/live';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

/** A controller with these buttons held and everything else at rest. */
const stateOf = (device: InputDevice, buttons: number[] = []): InputState => ({
  index: device.index,
  name: device.name,
  axes: Array.from({ length: device.numAxes }, () => 0),
  buttons: Array.from({ length: device.numButtons }, (_, i) => buttons.includes(i + 1)),
  hats: Array.from({ length: device.numHats }, (): [number, number] => [0, 0]),
  timestamp: 1,
});

describe('live input for the windows', () => {
  it('tells a window that starts to listen later where the controls rest', async () => {
    app = await wiredApp('cheat-sheets-hornet');
    const said = (): { devices: LiveDevice[]; rest?: boolean }[] =>
      app!.events
        .filter((e) => e.channel === 'cheat-sheets:event:input')
        .map((e) => e.payload as { devices: LiveDevice[]; rest?: boolean });
    const stick = app.ports.input.devices()[0]!;
    const guid = stick.guid.toUpperCase();

    // The pop-out listens first, and the stick says what it holds: a switch that is on.
    await app.invoke('cheat-sheets:watch', { client: 'pop-out', on: true });
    app.ports.input.emit([stateOf(stick, [2])]);
    await vi.waitFor(() => expect(said()).toHaveLength(1));
    expect(said()[0]).toMatchObject({ devices: [{ guid, pressed: ['button:2'] }] });
    expect(said()[0]!.rest).toBeUndefined();

    // A button goes down, and before that has been sent on the trainer opens in the other
    // window. The press goes out first, as the press it is. Then the trainer is told where
    // every control is, marked as such: without it, the first thing it heard of the stick
    // would be a press with the switch in it, and it could not tell which of the two was
    // new. The mark keeps the window that listened already from taking it for a press.
    app.ports.input.emit([stateOf(stick, [2, 7])]);
    await app.invoke('cheat-sheets:watch', { client: 'trainer', on: true });
    expect(said()).toHaveLength(3);
    expect(said()[1]).toMatchObject({ devices: [{ guid, pressed: ['button:2', 'button:7'] }] });
    expect(said()[1]!.rest).toBeUndefined();
    expect(said()[2]).toEqual({
      devices: [expect.objectContaining({ guid, pressed: ['button:2', 'button:7'], moved: [] })],
      rest: true,
    });

    // Once the last window stops listening nothing is remembered: the next one to listen
    // is told by the reader itself, as the first one was.
    await app.invoke('cheat-sheets:watch', { client: 'pop-out', on: false });
    await app.invoke('cheat-sheets:watch', { client: 'trainer', on: false });
    await app.invoke('cheat-sheets:watch', { client: 'trainer', on: true });
    await vi.waitFor(() => expect(said()).toHaveLength(4));
    expect(said()[3]).toMatchObject({ devices: [{ guid, pressed: ['button:2', 'button:7'] }] });
    expect(said()[3]!.rest).toBeUndefined();
  });
});
