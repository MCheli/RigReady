import { describe, expect, it } from 'vitest';
import type { DisplayInfo } from '../../../shared/models';
import {
  mainScreen,
  overlayScreens,
  placeSignature,
  resolvePlace,
  screenNames,
  storedMonitor,
} from './place';

const idOf = (model: string, connector: number): string =>
  `\\\\?\\display#${model}#5&1f2e3d4c&0&uid${connector}#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}`;

const monitor = (
  model: string,
  connector: number,
  name: string,
  box: { x: number; y: number; width: number; height: number },
  more: Partial<DisplayInfo> = {}
): DisplayInfo => ({
  id: idOf(model, connector),
  name,
  enabled: true,
  primary: false,
  rotation: 0,
  ...box,
  ...more,
});

const off = (display: DisplayInfo): DisplayInfo => ({
  ...display,
  enabled: false,
  primary: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});

const WIDE = monitor(
  'wid4900',
  256,
  'Wide 49',
  { x: 0, y: 0, width: 5120, height: 1440 },
  {
    primary: true,
  }
);
const DESK = monitor('dsk2700', 257, 'Desk 27', { x: 5120, y: 0, width: 2560, height: 1440 });
const MFD_LEFT = monitor(
  'mfd0800',
  258,
  'USB_Monitor',
  { x: -768, y: 0, width: 768, height: 1024 },
  {
    serial: '1001',
  }
);
const MFD_RIGHT = monitor(
  'mfd0800',
  259,
  'USB_Monitor',
  { x: 7680, y: 0, width: 768, height: 1024 },
  {
    serial: '1002',
  }
);
const FLYING = [WIDE, DESK, MFD_LEFT, MFD_RIGHT];

describe('the main screen', () => {
  it('is the one Windows calls primary', () => {
    expect(mainScreen([DESK, WIDE])?.id).toBe(WIDE.id);
  });

  it('is the first that is on when none is marked, and none when every screen is off', () => {
    expect(mainScreen([off(WIDE), DESK])?.id).toBe(DESK.id);
    expect(mainScreen([off(WIDE), off(DESK)])).toBeUndefined();
    expect(mainScreen([])).toBeUndefined();
  });
});

describe('the names of the screens', () => {
  it('the name the owner gave comes first, then the monitor’s own', () => {
    const names = screenNames(FLYING, { [DESK.id.toLowerCase()]: 'Desk monitor' });
    expect(names.get(DESK.id.toLowerCase())).toBe('Desk monitor');
    expect(names.get(WIDE.id.toLowerCase())).toBe('Wide 49');
  });

  it('monitors that share a name are numbered, and one without a name is a screen', () => {
    const names = screenNames([
      ...FLYING,
      monitor('gen0001', 260, '', { x: 0, y: 1440, width: 800, height: 600 }),
    ]);
    expect(names.get(MFD_LEFT.id.toLowerCase())).toBe('USB_Monitor (1 of 2)');
    expect(names.get(MFD_RIGHT.id.toLowerCase())).toBe('USB_Monitor (2 of 2)');
    expect(names.get(idOf('gen0001', 260).toLowerCase())).toBe('Screen');
  });

  it('the page is offered the screens that are on: the main one first, then left to right', () => {
    const screens = overlayScreens([DESK, off(MFD_RIGHT), MFD_LEFT, WIDE], {
      [MFD_LEFT.id.toLowerCase()]: 'MFD left',
    });
    expect(screens).toEqual([
      { id: WIDE.id, name: 'Wide 49', primary: true, width: 5120, height: 1440 },
      { id: MFD_LEFT.id, name: 'MFD left', primary: false, width: 768, height: 1024 },
      { id: DESK.id, name: 'Desk 27', primary: false, width: 2560, height: 1440 },
    ]);
  });
});

describe('what is kept of a screen', () => {
  it('its id, its serials when it has them, and the name it had', () => {
    expect(storedMonitor(MFD_LEFT, 'MFD left')).toEqual({
      id: MFD_LEFT.id,
      serial: '1001',
      name: 'MFD left',
    });
    expect(storedMonitor(WIDE, 'Wide 49')).toEqual({ id: WIDE.id, name: 'Wide 49' });
    expect(storedMonitor({ ...DESK, usbSerial: 'USB77' }, 'Desk')).toEqual({
      id: DESK.id,
      usbSerial: 'USB77',
      name: 'Desk',
    });
  });
});

describe('where a widget is shown', () => {
  const AT = { x: 0.5, y: 1 };

  it('nowhere when no screen is on', () => {
    expect(resolvePlace(undefined, AT, [])).toBeUndefined();
    expect(resolvePlace(undefined, AT, [off(WIDE)])).toBeUndefined();
  });

  it('never placed: its own default place on the main screen', () => {
    expect(resolvePlace(undefined, AT, FLYING)).toEqual({ display: WIDE, at: AT, own: true });
  });

  it('placed without a screen: that place on the main screen, whichever that is', () => {
    const stored = { at: { x: 0, y: 0 } };
    expect(resolvePlace(stored, AT, FLYING)?.display.id).toBe(WIDE.id);
    expect(resolvePlace(stored, AT, [off(WIDE), DESK])).toEqual({
      display: DESK,
      at: { x: 0, y: 0 },
      own: true,
    });
  });

  it('placed on a screen: that screen, at that place', () => {
    const stored = { monitor: storedMonitor(MFD_RIGHT, 'MFD right'), at: { x: 1, y: 0.25 } };
    expect(resolvePlace(stored, AT, FLYING)).toEqual({
      display: MFD_RIGHT,
      at: { x: 1, y: 0.25 },
      own: true,
    });
  });

  it('the screen is found again after the layout changed: by what it is, not where it is', () => {
    const stored = { monitor: storedMonitor(MFD_RIGHT, 'MFD right'), at: { x: 1, y: 0.25 } };
    // Another layout: the same monitor at another spot on the desktop.
    const moved = { ...MFD_RIGHT, x: -1536, y: 200 };
    expect(resolvePlace(stored, AT, [WIDE, MFD_LEFT, moved])?.display).toEqual(moved);
    // On another connector: found by its serial among the two of its model.
    const replugged = { ...MFD_RIGHT, id: idOf('mfd0800', 300) };
    expect(resolvePlace(stored, AT, [WIDE, MFD_LEFT, replugged])?.display.id).toBe(replugged.id);
  });

  it('its screen is off: the main screen stands in at the same place, and it says which is away', () => {
    const stored = { monitor: storedMonitor(MFD_RIGHT, 'MFD right'), at: { x: 1, y: 0.25 } };
    expect(resolvePlace(stored, AT, [WIDE, DESK, off(MFD_LEFT), off(MFD_RIGHT)])).toEqual({
      display: WIDE,
      at: { x: 1, y: 0.25 },
      own: false,
      away: 'MFD right',
    });
  });

  it('a screen that is off is not taken for its twin that is on', () => {
    const stored = { monitor: storedMonitor(MFD_RIGHT, 'MFD right'), at: { x: 0, y: 0 } };
    const place = resolvePlace(stored, AT, [WIDE, MFD_LEFT, off(MFD_RIGHT)]);
    expect(place?.display.id).toBe(WIDE.id);
    expect(place?.away).toBe('MFD right');
  });

  it('its screen is unplugged: the same, by the name it had, or by a few words when it had none', () => {
    const stored = { monitor: storedMonitor(DESK, 'Desk 27'), at: { x: 0, y: 0 } };
    expect(resolvePlace(stored, AT, [WIDE])?.away).toBe('Desk 27');
    const nameless = { monitor: storedMonitor(DESK, ''), at: { x: 0, y: 0 } };
    expect(resolvePlace(nameless, AT, [WIDE])?.away).toBe('the screen it was on');
    // Connected but off, and stored without a name: the name the monitor has now.
    expect(resolvePlace(nameless, AT, [WIDE, off(DESK)])?.away).toBe('Desk 27');
  });
});

describe('whether a panel has to be shown again', () => {
  const place = resolvePlace(undefined, { x: 0.5, y: 1 }, FLYING)!;
  const size = { width: 396, height: 300 };

  it('not while nothing about it changed', () => {
    expect(placeSignature(place, size, false)).toBe(
      placeSignature({ ...place }, { ...size }, false)
    );
  });

  it('when the screen, its position on the desktop, the place, the size or the mode changed', () => {
    const same = placeSignature(place, size, false);
    expect(placeSignature({ ...place, display: DESK }, size, false)).not.toBe(same);
    expect(placeSignature({ ...place, display: { ...WIDE, x: 768 } }, size, false)).not.toBe(same);
    expect(placeSignature({ ...place, display: { ...WIDE, width: 3840 } }, size, false)).not.toBe(
      same
    );
    expect(placeSignature({ ...place, at: { x: 0, y: 1 } }, size, false)).not.toBe(same);
    expect(placeSignature(place, { width: 396, height: 248 }, false)).not.toBe(same);
    expect(placeSignature(place, size, true)).not.toBe(same);
  });
});
