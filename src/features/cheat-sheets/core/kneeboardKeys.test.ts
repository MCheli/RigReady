import { afterEach, describe, expect, it } from 'vitest';
import type { BoundAction, BoundDevice, BoundInput } from '../../../core/bindings';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { KneeboardKeysView } from '../contract';
import { kneeboardKeyOf, kneeboardKeys } from './kneeboardKeys';

/**
 * The keys a kneeboard needs: at the sitting the owner bound show or hide to a button and
 * found in the cockpit that nothing on his controllers turned the pages.
 */

const action = (id: string, name: string): BoundAction => ({
  id,
  name,
  category: ['Kneeboard'],
  kind: 'button',
  editable: true,
});
const ACTIONS = [
  action('show', 'Kneeboard ON/OFF'),
  action('glance', 'Kneeboard glance view'),
  action('next', 'Kneeboard Next Page'),
  action('prev', 'Kneeboard Previous Page'),
  action('mark', 'Kneeboard current position mark point'),
  action('gear', 'Landing Gear Control Handle - UP/DOWN'),
];

const bound = (
  actionId: string,
  input: string,
  inputLabel: string,
  modifiers: string[] = []
): BoundInput => ({
  input,
  inputLabel,
  kind: 'button',
  modifiers,
  actionId,
  action: ACTIONS.find((a) => a.id === actionId)!.name,
  category: ['Kneeboard'],
  source: 'default',
});

const keyboard = (bindings: BoundInput[]): BoundDevice => ({
  kind: 'keyboard',
  name: 'Keyboard',
  connected: true,
  bindings,
});
const throttle = (bindings: BoundInput[]): BoundDevice => ({
  kind: 'controller',
  name: 'WINWING THROTTLE BASE',
  givenName: 'Throttle',
  guid: 'A',
  connected: true,
  bindings,
});

const DEFAULT_KEYS = [
  bound('show', 'K', 'K', ['RShift']),
  bound('glance', 'K', 'K'),
  bound('next', ']', ']'),
  bound('prev', '[', '['),
];

describe('which kneeboard key an action is', () => {
  it("reads it from the game's name for the action", () => {
    expect(kneeboardKeyOf('Kneeboard ON/OFF')).toBe('show');
    expect(kneeboardKeyOf('Kneeboard Show/Hide')).toBe('show');
    expect(kneeboardKeyOf('Kneeboard Next Page')).toBe('next');
    expect(kneeboardKeyOf('Kneeboard Previous Page')).toBe('previous');
  });

  it('leaves out the glance view, the mark point and everything that is not the kneeboard', () => {
    expect(kneeboardKeyOf('Kneeboard glance view')).toBeUndefined();
    expect(kneeboardKeyOf('Kneeboard current position mark point')).toBeUndefined();
    // DCS's shortcuts jump between marked pages: "Next Shortcut" does not turn a page.
    expect(kneeboardKeyOf('Kneeboard Next Shortcut')).toBeUndefined();
    expect(kneeboardKeyOf('Kneeboard Previous Shortcut')).toBeUndefined();
    expect(kneeboardKeyOf('Kneeboard Make Shortcut')).toBeUndefined();
    expect(kneeboardKeyOf('Kneeboard Jump To Shortcut  1')).toBeUndefined();
    expect(kneeboardKeyOf('Next Waypoint')).toBeUndefined();
    expect(kneeboardKeyOf('Show controls indicator')).toBeUndefined();
  });
});

describe('the keys a kneeboard needs', () => {
  it('says the pages turn only from the keyboard when show or hide is on a button', () => {
    const keys = kneeboardKeys(
      [keyboard(DEFAULT_KEYS), throttle([bound('show', 'JOY_BTN12', 'Button 12')])],
      ACTIONS
    );
    expect(keys.pages).toBe('keyboard');
    expect(keys.keys).toEqual([
      {
        key: 'show',
        action: 'Kneeboard ON/OFF',
        // The controller first: that is where the hands are.
        bound: ['Button 12 on Throttle', 'RShift + K on the keyboard'],
        onController: true,
      },
      {
        key: 'next',
        action: 'Kneeboard Next Page',
        bound: ['] on the keyboard'],
        onController: false,
      },
      {
        key: 'previous',
        action: 'Kneeboard Previous Page',
        bound: ['[ on the keyboard'],
        onController: false,
      },
    ]);
  });

  it('has nothing to say once both page keys are on a controller', () => {
    const keys = kneeboardKeys(
      [
        keyboard(DEFAULT_KEYS),
        throttle([
          bound('next', 'JOY_BTN_POV1_R', 'Hat 1 right'),
          bound('prev', 'JOY_BTN_POV1_L', 'Hat 1 left'),
        ]),
      ],
      ACTIONS
    );
    expect(keys.pages).toBeUndefined();
    expect(keys.keys.map((k) => [k.key, k.onController])).toEqual([
      ['show', false],
      ['next', true],
      ['previous', true],
    ]);
  });

  it('says nothing turns the pages when a page key is bound to nothing at all', () => {
    const keys = kneeboardKeys([keyboard([bound('next', ']', ']')])], ACTIONS);
    expect(keys.pages).toBe('unbound');
    expect(keys.keys.find((k) => k.key === 'previous')).toEqual({
      key: 'previous',
      action: 'Kneeboard Previous Page',
      bound: [],
      onController: false,
    });
  });

  it('a shortcut key on a controller does not count as a page key', () => {
    const shortcut: BoundInput = {
      ...bound('next', 'JOY_BTN7', 'Button 7'),
      actionId: 'next-shortcut',
      action: 'Kneeboard Next Shortcut',
    };
    const keys = kneeboardKeys([keyboard(DEFAULT_KEYS), throttle([shortcut])], ACTIONS);
    expect(keys.pages).toBe('keyboard');
    expect(keys.keys.find((k) => k.key === 'next')).toEqual({
      key: 'next',
      action: 'Kneeboard Next Page',
      bound: ['] on the keyboard'],
      onController: false,
    });
  });

  it('one page key on a controller is not enough', () => {
    const keys = kneeboardKeys(
      [keyboard(DEFAULT_KEYS), throttle([bound('next', 'JOY_BTN4', 'Button 4')])],
      ACTIONS
    );
    expect(keys.pages).toBe('keyboard');
  });

  it('has nothing to say about an aircraft that has no kneeboard actions', () => {
    const keys = kneeboardKeys([keyboard([])], [action('gear', 'Landing Gear')]);
    expect(keys.pages).toBeUndefined();
    expect(keys.keys.map((k) => [k.key, k.action, k.bound])).toEqual([
      ['show', undefined, []],
      ['next', undefined, []],
      ['previous', undefined, []],
    ]);
  });

  it('finds the keys from the bindings alone when the game cannot list its actions', () => {
    const keys = kneeboardKeys([keyboard(DEFAULT_KEYS)]);
    expect(keys.pages).toBe('keyboard');
    expect(keys.keys.map((k) => k.action)).toEqual([
      'Kneeboard ON/OFF',
      'Kneeboard Next Page',
      'Kneeboard Previous Page',
    ]);
  });
});

describe('the kneeboard keys of the Hornet on the recorded rig', () => {
  let app: WiredApp;
  afterEach(() => app?.cleanup());

  const FILES = [
    'Saved Games/DCS/**',
    'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
    'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
    'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
  ];

  it("reads DCS's own keys, finds none on a controller, and offers the page to bind them on", async () => {
    app = await wiredApp('cheat-sheets-hornet', { files: FILES });
    const keys = await app.invoke<KneeboardKeysView>('cheat-sheets:kneeboardKeys', {
      game: 'dcs',
      aircraftId: 'FA-18C_hornet',
    });
    expect(keys.keys.map((k) => [k.key, k.action, k.bound, k.onController])).toEqual([
      ['show', 'Kneeboard ON/OFF', ['RShift + K on the keyboard'], false],
      ['next', 'Kneeboard Next Page', ['] on the keyboard'], false],
      ['previous', 'Kneeboard Previous Page', ['[ on the keyboard'], false],
    ]);
    expect(keys.pages).toBe('keyboard');
    // The DCS bindings page, on this aircraft's actions, looking for the kneeboard.
    expect(keys.route).toBe(
      '/configure/dcs-bindings/actions?aircraft=FA-18C_hornet&find=kneeboard'
    );
  });

  it('is for a game with a kneeboard only', async () => {
    app = await wiredApp('cheat-sheets-hornet', { files: FILES });
    await expect(
      app.invoke('cheat-sheets:kneeboardKeys', { game: 'iracing', aircraftId: 'all' })
    ).rejects.toThrow(/kneeboard\.game/);
  });
});
