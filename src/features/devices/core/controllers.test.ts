import { describe, expect, it } from 'vitest';
import type { InputDevice } from '../../../shared/models';
import { controllerChanges, controllersSignature, ownerOf, sameController } from './controllers';

const controller = (index: number, name: string, guid: string): InputDevice => ({
  index,
  name,
  guid,
  productGuid: '',
  vendorId: '',
  productId: '',
  numAxes: 8,
  numButtons: 32,
  numHats: 1,
  axisNames: [],
});

// The flying layout: the controllers are numbered by their place in a list sorted by name.
const panel = controller(0, 'R-VPC Panel #1', 'AAAA0000-0000-0000-0000-000000000001');
const rudder = controller(1, 'T-Pendular-Rudder', 'AAAA0000-0000-0000-0000-000000000002');
const stick = controller(
  2,
  'WINWING Orion Joystick Base 2',
  'AAAA0000-0000-0000-0000-000000000003'
);
// The racing layout, after the swap: the wheel base (two controllers) has the first numbers.
const wheel1 = controller(
  0,
  'FANATEC Podium Wheel Base DD2',
  'BBBB0000-0000-0000-0000-000000000001'
);
const wheel2 = controller(
  1,
  'FANATEC Podium Wheel Base DD2',
  'BBBB0000-0000-0000-0000-000000000002'
);

/** The Devices overview as a screen may still hold it from before the swap. */
const before = [
  { name: 'Button box', controllers: [panel] },
  { name: 'Rudder pedals', controllers: [rudder] },
  { name: 'Stick', controllers: [stick] },
];

describe('which controller is which, across a plug or unplug', () => {
  it('knows a controller by its GUID, not by its number', () => {
    expect(sameController(panel, { ...panel, index: 7 })).toBe(true);
    expect(sameController(panel, { ...panel, guid: panel.guid.toLowerCase() })).toBe(true);
    // The same number and even the same name do not make two controllers one.
    expect(sameController(wheel1, wheel2)).toBe(false);
    expect(sameController(panel, wheel1)).toBe(false);
    // Without a GUID on both sides, only the same number with the same name is the same.
    const bare = { index: 3, guid: '', name: 'Pad' };
    expect(sameController(bare, { ...bare })).toBe(true);
    expect(sameController(bare, { ...bare, name: 'Other pad' })).toBe(false);
    expect(sameController(bare, { ...bare, guid: 'X' })).toBe(false);
  });

  it('never finds a device for a controller that only has the number of one of its controllers', () => {
    // The wheel has the numbers the button box and the rudder had, and a list from before.
    expect(ownerOf(before, wheel1)).toBeUndefined();
    expect(ownerOf(before, wheel2)).toBeUndefined();
    // A controller the list does have is found wherever it sits now.
    expect(ownerOf(before, { ...stick, index: 0 })).toEqual({ device: before[2], position: 0 });
    // Its place among the device's controllers is what "controller 2 of 2" is counted from.
    const base = { name: 'Wheel base', controllers: [wheel1, wheel2] };
    expect(ownerOf([base], wheel2)).toEqual({ device: base, position: 1 });
  });

  it('says which numbers passed to another controller, and whether anything changed at all', () => {
    const flying = [panel, rudder, stick];
    expect(controllerChanges(flying, flying)).toEqual({ changed: false, vacated: [] });

    // One model replaces another: every number has another controller or none.
    expect(controllerChanges(flying, [wheel1, wheel2])).toEqual({
      changed: true,
      vacated: [0, 1, 2],
    });

    // The first is unplugged: the others move up, so each number has another controller.
    const movedUp = [
      { ...rudder, index: 0 },
      { ...stick, index: 1 },
    ];
    expect(controllerChanges(flying, movedUp)).toEqual({ changed: true, vacated: [0, 1, 2] });

    // The last is unplugged: the two before it keep their numbers and what was learnt.
    expect(controllerChanges(flying, [panel, rudder])).toEqual({ changed: true, vacated: [2] });

    // One comes at the end: nothing that was known is void.
    const pad = controller(3, 'Xbox pad', 'CCCC0000-0000-0000-0000-000000000001');
    expect(controllerChanges(flying, [...flying, pad])).toEqual({ changed: true, vacated: [] });

    // The same model comes back with the same GUID at the same number: nothing changed.
    expect(controllerChanges(flying, [panel, rudder, { ...stick }]).changed).toBe(false);
  });

  it('writes a line for a list that differs whenever who sits where does', () => {
    const flying = [panel, rudder, stick];
    expect(controllersSignature(flying)).toBe(controllersSignature(flying.map((d) => ({ ...d }))));
    expect(controllersSignature(flying)).not.toBe(controllersSignature([wheel1, wheel2, stick]));
    expect(controllersSignature([wheel1, wheel2])).not.toBe(
      controllersSignature([wheel1, { ...wheel2, index: 2 }])
    );
    expect(controllersSignature([])).toBe('[]');
  });
});
