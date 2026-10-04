import { describe, expect, it } from 'vitest';
import { chipNames, deviceKind, KIND_ICON, KIND_NAME, type DeviceKind } from './deviceKind';

describe('names short enough for a chip', () => {
  it('leaves out the word most of the devices begin with: their maker', () => {
    expect(
      chipNames([
        'WINWING Orion Joystick Base 2 + JGRIP-F16',
        'WINWING MFD1-L',
        'WINWING UFC1 + HUD1',
        'WINWING F18 STARTUP PANEL',
        'T-Pendular-Rudder',
        'TrackIR 5',
        'Stream Deck XL',
      ])
    ).toEqual([
      'Orion Joystick Base 2 + JGRIP-F16',
      'MFD1-L',
      'UFC1 + HUD1',
      'F18 STARTUP PANEL',
      'T-Pendular-Rudder',
      'TrackIR 5',
      'Stream Deck XL',
    ]);
    // Whatever the case it is written in.
    expect(chipNames(['Winwing MFD1-L', 'WINWING MFD1-R', 'VKB Gladiator'])).toEqual([
      'MFD1-L',
      'MFD1-R',
      'VKB Gladiator',
    ]);
  });

  it('keeps whole names when no word is shared by more than half of them', () => {
    expect(chipNames(['FANATEC Podium Wheel Base DD2'])).toEqual(['FANATEC Podium Wheel Base DD2']);
    const mixed = ['WINWING MFD1-L', 'WINWING MFD1-R', 'T-Pendular-Rudder', 'TrackIR 5'];
    expect(chipNames(mixed)).toEqual(mixed);
    // "Left" and "Right" are what tells these apart, not a maker.
    const sides = ['Left MFD', 'Left panel', 'Right MFD', 'Right panel'];
    expect(chipNames(sides)).toEqual(sides);
  });

  it('never shortens to nothing, to a number as a make, or to names that no longer differ', () => {
    expect(chipNames(['Panel', 'Panel 2', 'Panel'])).toEqual(['Panel', 'Panel 2', 'Panel']);
    expect(chipNames(['2 Left', '2 Right'])).toEqual(['2 Left', '2 Right']);
    // Without the maker, two of these would read the same.
    const same = ['WINWING MFD', 'MFD', 'WINWING UFC'];
    expect(chipNames(same)).toEqual(same);
    expect(chipNames(['  WINWING MFD1-L ', 'WINWING UFC1'])).toEqual(['MFD1-L', 'UFC1']);
    expect(chipNames([])).toEqual([]);
  });
});

describe('what kind of device a name is', () => {
  it('knows the gear of a flying rig by its names', () => {
    const names: [string, DeviceKind][] = [
      ['WINWING Orion Joystick Base 2 + JGRIP-F16', 'stick'],
      ['WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R', 'throttle'],
      ['T-Pendular-Rudder', 'pedals'],
      ['WINWING MFD1-L', 'display'],
      ['WINWING UFC1 + HUD1', 'display'],
      ['WINWING F18 STARTUP PANEL', 'panel'],
      ['WINWING F18 TAKEOFF PANEL 2', 'panel'],
      ['R-VPC Panel #1', 'panel'],
      ['TrackIR 5', 'tracker'],
      ['Stream Deck XL', 'deck'],
      ['Logitech Extreme 3D Joystick', 'stick'],
      ['VKB Gladiator NXT', 'stick'],
      ['Thrustmaster TWCS Throttle', 'throttle'],
      ['Collective', 'throttle'],
    ];
    for (const [name, kind] of names) expect(deviceKind(name), name).toBe(kind);
  });

  it('knows the gear of a racing rig', () => {
    const names: [string, DeviceKind][] = [
      ['FANATEC Podium Wheel Base DD2', 'wheel'],
      ['ClubSport Pedals V3', 'pedals'],
      ['Heusinkveld Sprint pedals', 'pedals'],
      ['Sequential shifter', 'shifter'],
      ['Handbrake', 'shifter'],
      ['Button box', 'panel'],
    ];
    for (const [name, kind] of names) expect(deviceKind(name), name).toBe(kind);
  });

  it('a base is what is mounted on it: a throttle base and a wheel base are not sticks', () => {
    expect(deviceKind('Orion Throttle Base II')).toBe('throttle');
    expect(deviceKind('Wheel Base')).toBe('wheel');
    expect(deviceKind('Joystick Base')).toBe('stick');
  });

  it('goes by the name the owner gave as well', () => {
    expect(deviceKind('Left MFD')).toBe('display');
    expect(deviceKind('My pedals')).toBe('pedals');
    expect(deviceKind('Headset')).toBe('headset');
    expect(deviceKind('Keyboard')).toBe('keyboard');
    expect(deviceKind('Trackball mouse')).toBe('mouse');
  });

  it('a name it does not recognise is a device, never a guess', () => {
    expect(deviceKind('USB Composite Device')).toBe('other');
    expect(deviceKind('')).toBe('other');
    // Part of a word is not the word.
    expect(deviceKind('Debased')).toBe('other');
    expect(deviceKind('Wheelbarrow')).toBe('other');
  });

  it('has a picture and a word for every kind', () => {
    for (const kind of Object.keys(KIND_ICON) as DeviceKind[]) {
      expect(KIND_ICON[kind]).toMatch(/^mdi-[a-z-]+$/);
      expect(KIND_NAME[kind].length).toBeGreaterThan(2);
    }
    expect(Object.keys(KIND_NAME).sort()).toEqual(Object.keys(KIND_ICON).sort());
  });
});
