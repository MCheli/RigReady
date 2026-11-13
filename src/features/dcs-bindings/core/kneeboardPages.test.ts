import { afterEach, describe, expect, it } from 'vitest';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { BINDING_FILES, HORNET, HUEY, bindingsFor } from '../../../../tests/dcsBindings';
import type { DcsBindings } from './bindings';
import { applyEdits, type BindingOp } from './edits';
import { kneeboardActionOf, kneeboardPagesNote } from './kneeboardPages';
import type { AircraftView, DeviceView } from './model';

let rig: TestRig;
let bindings: DcsBindings;
afterEach(() => rig?.cleanup());

async function start(): Promise<void> {
  rig = await scenarioRig('flying-fresh', { files: BINDING_FILES });
  bindings = bindingsFor(rig);
}

async function view(aircraft = HORNET): Promise<AircraftView> {
  const result = await bindings.view(aircraft);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const id = (v: AircraftView, name: string): string => {
  const found = v.commands.find((c) => c.name === name);
  if (!found) throw new Error(`no action "${name}"`);
  return found.id;
};

const stickOf = (v: AircraftView): DeviceView =>
  v.devices.find((d) => d.name.startsWith('WINWING Orion Joystick'))!;

const bind = (
  v: AircraftView,
  device: DeviceView,
  action: string,
  key: string,
  aircraft = HORNET
): Extract<BindingOp, { op: 'bind' }> => ({
  op: 'bind',
  aircraft,
  deviceId: device.id,
  commandId: id(v, action),
  combo: { key, reformers: [] },
});

const SHOW = 'Kneeboard ON/OFF';
const NEXT = 'Kneeboard Next Page';
const PREVIOUS = 'Kneeboard Previous Page';

describe('which kneeboard action an action is', () => {
  it("reads the three from DCS's names, and takes the glance view, the mark point and the shortcuts for none", () => {
    expect(kneeboardActionOf('Kneeboard ON/OFF')).toBe('show');
    expect(kneeboardActionOf('Kneeboard Next Page')).toBe('next');
    expect(kneeboardActionOf('Kneeboard Previous Page')).toBe('previous');
    expect(kneeboardActionOf('Kneeboard glance view')).toBeUndefined();
    expect(kneeboardActionOf('Kneeboard current position mark point')).toBeUndefined();
    expect(kneeboardActionOf('Kneeboard Next Shortcut')).toBeUndefined();
    expect(kneeboardActionOf('Paste From Clipboard to Kneeboard')).toBeUndefined();
    expect(kneeboardActionOf('Weapon Release Button')).toBeUndefined();
  });
});

describe('the note for binding show or hide the kneeboard', () => {
  it('on the recorded Hornet, says the two page actions are on the keyboard and on no controller', async () => {
    await start();
    const v = await view();
    const note = kneeboardPagesNote(v, id(v, SHOW));
    expect(note).toEqual({
      lead: 'This shows and hides the kneeboard. Its pages turn with two other actions, and neither is on a controller yet.',
      missing: [
        {
          key: 'next',
          commandId: id(v, NEXT),
          name: NEXT,
          bound: ['] on the keyboard'],
          editable: true,
        },
        {
          key: 'previous',
          commandId: id(v, PREVIOUS),
          name: PREVIOUS,
          bound: ['[ on the keyboard'],
          editable: true,
        },
      ],
      advice: 'Bind each to a button too, to turn the pages from your stick or throttle.',
      offer: [id(v, NEXT), id(v, PREVIOUS)],
      offerLabel: 'Add this and bind them next',
    });
  });

  it('says the same for the UH-1H, whose page actions are its own', async () => {
    await start();
    const v = await view(HUEY);
    const note = kneeboardPagesNote(v, id(v, SHOW));
    expect(note?.missing.map((m) => [m.name, m.bound])).toEqual([
      [NEXT, ['] on the keyboard']],
      [PREVIOUS, ['[ on the keyboard']],
    ]);
  });

  it('says nothing for any other action, the glance view and the page actions included', async () => {
    await start();
    const v = await view();
    expect(kneeboardPagesNote(v, undefined)).toBeUndefined();
    expect(kneeboardPagesNote(v, 'key:no-such-action')).toBeUndefined();
    for (const name of ['Kneeboard glance view', NEXT, PREVIOUS, 'Weapon Release Button']) {
      expect(kneeboardPagesNote(v, id(v, name)), name).toBeUndefined();
    }
  });

  it('counts a page action that waits to be saved as bound, and has nothing to say once both wait', async () => {
    await start();
    const v = await view();
    const stick = stickOf(v);
    const next = bind(v, stick, NEXT, 'JOY_BTN33');
    const previous = bind(v, stick, PREVIOUS, 'JOY_BTN35');

    const one = kneeboardPagesNote(v, id(v, SHOW), [next]);
    expect(one?.lead).toBe(
      'This shows and hides the kneeboard. Its pages turn with two other actions, and one of them is not on a controller yet.'
    );
    expect(one?.missing.map((m) => m.name)).toEqual([PREVIOUS]);
    expect(one?.advice).toBe(
      'Bind it to a button too, to turn the pages both ways from your stick or throttle.'
    );
    expect(one?.offer).toEqual([id(v, PREVIOUS)]);
    expect(one?.offerLabel).toBe('Add this and bind it next');

    expect(kneeboardPagesNote(v, id(v, SHOW), [next, previous])).toBeUndefined();
    // Taken off again before saving: the note is back.
    expect(
      kneeboardPagesNote(v, id(v, SHOW), [next, previous, { ...previous, op: 'unbind' as const }])
        ?.missing
    ).toHaveLength(1);
    expect(
      kneeboardPagesNote(v, id(v, SHOW), [
        next,
        previous,
        { op: 'clearDevice', aircraft: HORNET, deviceId: stick.id },
      ])?.missing
    ).toHaveLength(2);
  });

  it('is gone once both page actions are written to the stick, and back when the button of one is given to show or hide', async () => {
    await start();
    const before = await view();
    const ops = [
      bind(before, stickOf(before), NEXT, 'JOY_BTN33'),
      bind(before, stickOf(before), PREVIOUS, 'JOY_BTN35'),
    ];
    const applied = await applyEdits(bindings, ops);
    if (!applied.ok) throw new Error(applied.error.message);

    const v = await view();
    const stick = stickOf(v);
    expect(kneeboardPagesNote(v, id(v, SHOW))).toBeUndefined();
    // Show or hide on a free button changes nothing about the pages.
    expect(kneeboardPagesNote(v, id(v, SHOW), [bind(v, stick, SHOW, 'JOY_BTN14')])).toBeUndefined();
    // On the button that turns to the next page, it takes that button away from there.
    const taken = kneeboardPagesNote(v, id(v, SHOW), [bind(v, stick, SHOW, 'JOY_BTN33')]);
    expect(taken?.missing.map((m) => m.name)).toEqual([NEXT]);
    expect(taken?.missing[0]?.bound).toEqual(['] on the keyboard']);
  });

  it('does not count a binding on a control the device does not have', async () => {
    await start();
    const v = await view();
    const stick = stickOf(v);
    const inert: AircraftView = {
      ...v,
      devices: v.devices.map((d) =>
        d.id !== stick.id
          ? d
          : {
              ...d,
              bindings: [
                ...d.bindings,
                {
                  commandId: id(v, NEXT),
                  combo: { key: 'JOY_BTN99', reformers: [] },
                  label: 'Button 99',
                  source: 'user' as const,
                  filterChanged: false,
                  inert: true,
                },
              ],
            }
      ),
    };
    expect(kneeboardPagesNote(inert, id(v, SHOW))?.missing).toHaveLength(2);
  });

  it('says a page action is bound to nothing when it is on no keyboard key either', async () => {
    await start();
    const v = await view();
    const bare: AircraftView = {
      ...v,
      devices: v.devices.map((d) =>
        d.type !== 'keyboard'
          ? d
          : { ...d, bindings: d.bindings.filter((b) => b.commandId !== id(v, NEXT)) }
      ),
    };
    const note = kneeboardPagesNote(bare, id(v, SHOW));
    expect(note?.missing.map((m) => [m.name, m.bound])).toEqual([
      [NEXT, []],
      [PREVIOUS, ['[ on the keyboard']],
    ]);
  });

  it('offers only what RigReady can bind, and says where to bind the rest', async () => {
    await start();
    const v = await view();
    const unknown: AircraftView = {
      ...v,
      commands: v.commands.map((c) => (c.name === NEXT ? { ...c, editable: false } : c)),
    };
    const note = kneeboardPagesNote(unknown, id(v, SHOW));
    expect(note?.missing).toHaveLength(2);
    expect(note?.cannot).toBe(
      'RigReady cannot write a binding for "Kneeboard Next Page" yet. Bind it in DCS\'s own controls screen.'
    );
    expect(note?.offer).toEqual([id(v, PREVIOUS)]);
    expect(note?.offerLabel).toBe('Add this and bind it next');

    const none: AircraftView = {
      ...v,
      commands: v.commands.map((c) =>
        c.name === NEXT || c.name === PREVIOUS ? { ...c, editable: false } : c
      ),
    };
    const stuck = kneeboardPagesNote(none, id(v, SHOW));
    expect(stuck?.cannot).toBe(
      'RigReady cannot write a binding for "Kneeboard Next Page" and "Kneeboard Previous Page" yet. Bind them in DCS\'s own controls screen.'
    );
    expect(stuck?.offer).toEqual([]);
    expect(stuck?.offerLabel).toBeUndefined();
  });

  it('has nothing to say for an aircraft with no action that turns a page', async () => {
    await start();
    const v = await view();
    const without: AircraftView = {
      ...v,
      commands: v.commands.filter((c) => c.name !== NEXT && c.name !== PREVIOUS),
    };
    expect(kneeboardPagesNote(without, id(v, SHOW))).toBeUndefined();

    const onlyNext: AircraftView = {
      ...v,
      commands: v.commands.filter((c) => c.name !== PREVIOUS),
    };
    const note = kneeboardPagesNote(onlyNext, id(v, SHOW));
    expect(note?.lead).toBe(
      'This shows and hides the kneeboard. Its pages turn with another action, and that is not on a controller yet.'
    );
    expect(note?.advice).toBe(
      'Bind it to a button too, to turn the pages from your stick or throttle.'
    );
  });
});
