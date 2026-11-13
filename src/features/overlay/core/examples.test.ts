import { describe, expect, it } from 'vitest';
import type { BoundDevice } from '../../../core/bindings';
import type { BoundControl, BoundInputs } from '../../../core/boundInputs';
import { EXAMPLE_DEVICE, examplePresses, pressActions } from './examples';

type Action = string | { action: string; modifiers?: string[]; source?: 'user' | 'default' };

/** A control with what is on it: a name alone is something the user bound, with nothing held. */
const control = (input: string, actions: Action[]): BoundControl => ({
  input,
  label: input,
  actions: actions.map((given) => {
    const action = typeof given === 'string' ? { action: given } : given;
    return {
      action: action.action,
      category: [],
      source: action.source ?? 'user',
      modifiers: action.modifiers ?? [],
    };
  }),
  duplicate: false,
});

/** What the game binds by itself. */
const shipped = (action: string): Action => ({ action, source: 'default' });

const device = (guid: string, name: string, connected = true): BoundDevice => ({
  kind: 'controller',
  name,
  guid,
  connected,
  bindings: [],
});

const bound = (controllers: { guid: string; controls: BoundControl[] }[]): BoundInputs => ({
  game: 'dcs',
  gameName: 'DCS World',
  aircraft: { id: 'FA-18C_hornet', name: 'F/A-18C' },
  controllers: controllers.map((c) => ({ ...c, route: '/dcs-bindings' })),
});

const byName = (d: BoundDevice): string => d.name;

/** Each line as the control, the controller and the first thing the press does. */
const said = (lines: ReturnType<typeof examplePresses>): string[][] =>
  lines.map((line) => [line.control, line.device, line.actions[0]?.action ?? '']);

const PLAIN = [
  { control: 'Button 1', device: 'Your controller', actions: [], known: false },
  { control: 'Hat 1 up', device: 'Your controller', actions: [], known: false },
];

describe('the example lines of the preview', () => {
  it('with no bindings to go by: a button and a hat as a press shows them there, and no hardware by name', () => {
    expect(examplePresses(undefined, [], byName)).toEqual(PLAIN);
    expect(EXAMPLE_DEVICE).toBe('Your controller');
    // Controllers alone say nothing about what a press does.
    expect(examplePresses(undefined, [device('AAAA', 'Some Stick')], byName)).toEqual(PLAIN);
  });

  it('from the bindings: two buttons that do something, in the order of the buttons, as a press shows them', () => {
    const lines = examplePresses(
      bound([
        {
          guid: 'AAAA',
          controls: [
            control('JOY_BTN7', ['Flaps down']),
            // An axis is never a press.
            control('JOY_X', ['Roll']),
            control('JOY_BTN_POV1_U', ['Trim nose down']),
            control('JOY_BTN2', [{ action: 'Chaff', modifiers: ['JOY_BTN4'] }, 'Weapon release']),
            // On the list of the game with nothing on it.
            control('JOY_BTN1', []),
            control('JOY_BTN12', ['Gear up']),
          ],
        },
      ]),
      // The game and Windows do not write a GUID the same way.
      [device('aaaa', 'Stick of the test')],
      byName
    );
    expect(lines).toEqual([
      {
        control: 'Button 2',
        device: 'Stick of the test',
        // What works on its own before what needs something held.
        actions: [
          { action: 'Weapon release', modifiers: [] },
          { action: 'Chaff', modifiers: ['JOY_BTN4'] },
        ],
        known: true,
      },
      {
        control: 'Button 7',
        device: 'Stick of the test',
        actions: [{ action: 'Flaps down', modifiers: [] }],
        known: true,
      },
    ]);
  });

  it('what the user bound, on the controller with the most of it, before what the game binds by itself', () => {
    const lines = examplePresses(
      bound([
        // First in the game's order, with nothing on it but what the game ships: the hat of a
        // wheel base looks around in an aircraft.
        {
          guid: 'AAAA',
          controls: [
            control('JOY_BTN1', [shipped('Shipped on button 1')]),
            control('JOY_BTN_POV1_D', [shipped('View down slow')]),
          ],
        },
        { guid: 'BBBB', controls: [control('JOY_BTN1', ['One of one'])] },
        {
          guid: 'CCCC',
          controls: [
            control('JOY_BTN1', [shipped('Shipped on the panel')]),
            control('JOY_BTN6', ['Six of two']),
            control('JOY_BTN4', ['Four of two']),
          ],
        },
      ]),
      [device('AAAA', 'Wheel base'), device('BBBB', 'Stick'), device('CCCC', 'Panel')],
      byName
    );
    expect(said(lines)).toEqual([
      ['Button 4', 'Panel', 'Four of two'],
      ['Button 6', 'Panel', 'Six of two'],
    ]);
  });

  it('a controller that is attached before one that is not, and a hat when its buttons run out', () => {
    const lines = examplePresses(
      bound([
        {
          guid: 'AAAA',
          controls: [
            control('JOY_BTN1', ['Away 1']),
            control('JOY_BTN2', ['Away 2']),
            control('JOY_BTN3', ['Away 3']),
          ],
        },
        {
          guid: 'BBBB',
          controls: [control('JOY_BTN_POV1_L', ['Look left']), control('JOY_BTN9', ['Here 9'])],
        },
      ]),
      [device('AAAA', 'Unplugged', false), device('BBBB', 'Plugged in')],
      (d) => `the ${d.name}`
    );
    expect(said(lines)).toEqual([
      ['Button 9', 'the Plugged in', 'Here 9'],
      ['Hat 1 left', 'the Plugged in', 'Look left'],
    ]);
  });

  it('with nothing bound by the user: what the game binds by itself, buttons before hats', () => {
    const lines = examplePresses(
      bound([
        { guid: 'AAAA', controls: [control('JOY_BTN_POV1_D', [shipped('View down slow')])] },
        {
          guid: 'BBBB',
          controls: [
            control('JOY_BTN2', [shipped('Shipped two')]),
            control('JOY_BTN1', [shipped('Shipped one')]),
          ],
        },
      ]),
      [device('AAAA', 'Wheel base'), device('BBBB', 'Stick')],
      byName
    );
    expect(said(lines)).toEqual([
      ['Button 1', 'Stick', 'Shipped one'],
      ['Button 2', 'Stick', 'Shipped two'],
    ]);
  });

  it('one line from each of two controllers with one button each, and one line when that is all there is', () => {
    const two = examplePresses(
      bound([
        { guid: 'AAAA', controls: [control('JOY_BTN3', ['Only one'])] },
        { guid: 'BBBB', controls: [control('JOY_BTN1', ['Next one'])] },
      ]),
      [device('AAAA', 'First'), device('BBBB', 'Second')],
      byName
    );
    expect(said(two)).toEqual([
      ['Button 3', 'First', 'Only one'],
      ['Button 1', 'Second', 'Next one'],
    ]);
    const one = examplePresses(
      bound([{ guid: 'AAAA', controls: [control('JOY_BTN3', ['Only one'])] }]),
      [device('AAAA', 'First')],
      byName
    );
    expect(said(one)).toEqual([['Button 3', 'First', 'Only one']]);
  });

  it('bindings with no button or hat on them, or for controllers that are not known: the plain lines', () => {
    expect(
      examplePresses(
        bound([{ guid: 'AAAA', controls: [control('JOY_X', ['Roll']), control('JOY_BTN1', [])] }]),
        [device('AAAA', 'First')],
        byName
      )
    ).toEqual(PLAIN);
    expect(
      examplePresses(
        bound([{ guid: 'AAAA', controls: [control('JOY_BTN1', ['Something'])] }]),
        [],
        byName
      )
    ).toEqual(PLAIN);
  });
});

describe('what a press lists', () => {
  it('what works on its own first, and nothing for a control the game does not have', () => {
    expect(
      pressActions(
        control('JOY_BTN1', [
          { action: 'With shift', modifiers: ['JOY_BTN4'] },
          'Plain one',
          'Plain two',
        ])
      )
    ).toEqual([
      { action: 'Plain one', modifiers: [] },
      { action: 'Plain two', modifiers: [] },
      { action: 'With shift', modifiers: ['JOY_BTN4'] },
    ]);
    expect(pressActions(undefined)).toEqual([]);
  });
});
