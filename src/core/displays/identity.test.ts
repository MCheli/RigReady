import { describe, expect, it } from 'vitest';
import type { DisplayInfo, DisplayTarget } from '../../shared/models';
import { connectorName, monitorInstanceId, parseEdid, usbIdentity } from './edid';
import { findMonitor, matchMonitors, modelOf } from './identity';
import { layoutToTargets } from './layouts';

const GUID = '{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}';
const id = (model: string, instance: string): string =>
  `\\\\?\\display#${model}#${instance}#${GUID}`;

const monitor = (
  model: string,
  instance: string,
  x: number,
  extra: Partial<DisplayInfo> = {}
): DisplayInfo => ({
  id: id(model, instance),
  name: model === 'reg0319' ? 'USB_Monitor' : model,
  edid: model.toUpperCase(),
  enabled: true,
  primary: x === 0,
  x,
  y: 0,
  width: 1024,
  height: 768,
  rotation: 0,
  ...extra,
});

const target = (d: DisplayInfo): DisplayTarget => layoutToTargets({ displays: [d] })[0]!;

/** A 128-byte EDID with a numeric serial and optional text descriptors. */
function edid(numeric: number, text?: string, name?: string): Uint8Array {
  const bytes = new Uint8Array(128);
  bytes.set([0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0]);
  bytes[12] = numeric & 0xff;
  bytes[13] = (numeric >> 8) & 0xff;
  bytes[14] = (numeric >> 16) & 0xff;
  bytes[15] = (numeric >> 24) & 0xff;
  const descriptor = (at: number, tag: number, value: string): void => {
    bytes.set([0, 0, 0, tag, 0], at);
    const padded = (value + '\n').padEnd(13, ' ');
    for (let i = 0; i < 13; i++) bytes[at + 5 + i] = padded.charCodeAt(i);
  };
  // The first descriptor is a timing (non-zero start), as in a real EDID.
  bytes.set([0x56, 0x5e, 0x00], 54);
  if (text) descriptor(72, 0xff, text);
  if (name) descriptor(90, 0xfc, name);
  return bytes;
}

describe('EDID', () => {
  it('reads the text serial, falls back to the numeric one, and treats zero as none', () => {
    expect(parseEdid(edid(16843009, 'H4ZR900542', 'LC49G95T'))).toEqual({
      serial: 'H4ZR900542',
      name: 'LC49G95T',
    });
    expect(parseEdid(edid(1))).toEqual({ serial: '1' });
    expect(parseEdid(edid(0))).toEqual({});
    expect(parseEdid(edid(0, '0000000000000'))).toEqual({});
    expect(parseEdid(edid(77, '0000'))).toEqual({ serial: '77' });
    // As the registry port returns a binary value.
    const hex = Buffer.from(edid(0, '12NFXG3')).toString('hex');
    expect(parseEdid(hex)).toEqual({ serial: '12NFXG3' });
  });

  it('ignores blocks that are not an EDID', () => {
    expect(parseEdid(new Uint8Array(10))).toEqual({});
    expect(parseEdid(new Uint8Array(128))).toEqual({});
    expect(parseEdid('zz')).toEqual({});
  });

  it('names connectors, and finds the device ids behind a monitor path', () => {
    expect([0, 4, 5, 6, 10, 11, 15, 16, 17, 0x80000000, -1, 99].map(connectorName)).toEqual([
      'VGA',
      'DVI',
      'HDMI',
      'LVDS',
      'DisplayPort',
      'DisplayPort',
      'Wireless',
      'USB',
      'USB',
      'Internal',
      'Other',
      'Other',
    ]);
    expect(monitorInstanceId(id('reg0319', 'a&2c1ac5a9&0&uid256'))).toBe(
      'DISPLAY\\REG0319\\A&2C1AC5A9&0&UID256'
    );
    expect(monitorInstanceId('nonsense')).toBeUndefined();
    expect(usbIdentity('USB\\VID_17E9&PID_FF00\\WWIN29320221210163532')).toEqual({
      usbId: '17E9:FF00',
      usbSerial: 'WWIN29320221210163532',
    });
    // An invented instance suffix, an interface of a composite device and a hub: no serial.
    expect(usbIdentity('USB\\VID_05E3&PID_0626\\7&277bbe51&0&4')).toBeUndefined();
    expect(usbIdentity('USB\\VID_17E9&PID_FF00&MI_00\\9&19d1e6f3&0&0000')).toBeUndefined();
    expect(usbIdentity('PCI\\VEN_10DE')).toBeUndefined();
    expect(modelOf(id('deld139', 'x'))).toBe('DELD139');
    expect(modelOf('DISPLAY1')).toBeUndefined();
  });
});

describe('telling monitors apart', () => {
  const ultrawide = monitor('sam7053', '5&1509d400&0&uid4357', 0, { serial: 'H4ZR900542' });
  const left = monitor('reg0319', 'a&2c1ac5a9&0&uid256', 5120, {
    serial: '1',
    usbSerial: 'WWIN-A',
  });
  const centre = monitor('reg0319', 'a&270816bc&0&uid256', 5888, {
    serial: '1',
    usbSerial: 'WWIN-B',
  });
  const right = monitor('reg0319', 'a&2f291759&0&uid256', 6656, {
    serial: '1',
    usbSerial: 'WWIN-C',
  });
  const saved = [ultrawide, left, centre, right].map(target);

  it('matches two monitors with identical EDID data and different target ids to the right entries', () => {
    const noSerials = [left, centre].map((d) => {
      const { serial: _serial, usbSerial: _usb, ...rest } = d;
      return rest as DisplayInfo;
    });
    // Connected in the other order: the id, not the position in the list, decides.
    const matches = matchMonitors(noSerials.map(target), [noSerials[1]!, noSerials[0]!]);
    expect(matches.map((m) => [m.actual?.id, m.how])).toEqual([
      [noSerials[0]!.id, 'id'],
      [noSerials[1]!.id, 'id'],
    ]);
  });

  it('keeps the identity of identical USB screens when every one of them moves to another USB port', () => {
    // New ports, new ids, and one id is even reused by a different screen.
    const moved = [
      { ...centre, id: left.id },
      { ...right, id: id('reg0319', 'a&11111111&0&uid256') },
      { ...left, id: id('reg0319', 'a&22222222&0&uid256') },
      ultrawide,
    ];
    const matches = matchMonitors(saved, moved);
    expect(matches.map((m) => [m.actual?.usbSerial ?? m.actual?.serial, m.how])).toEqual([
      ['H4ZR900542', 'id'],
      ['WWIN-A', 'usb'],
      ['WWIN-B', 'usb'],
      ['WWIN-C', 'usb'],
    ]);
    // The same EDID serial on all three ("1") never identifies one of them.
    const withoutUsb = moved.map((d) => {
      const { usbSerial: _usb, ...rest } = d;
      return rest as DisplayInfo;
    });
    const savedWithoutUsb = saved.map((t) => {
      const { usbSerial: _usb, ...rest } = t;
      return rest as DisplayTarget;
    });
    const blind = matchMonitors(savedWithoutUsb, withoutUsb);
    // One id is still there (taken at its word); the other two cannot be told apart.
    expect(blind.map((m) => [m.how, m.lookalikes])).toEqual([
      ['id', 0],
      ['id', 0],
      [undefined, 2],
      [undefined, 2],
    ]);
  });

  it('follows a monitor to another connector by its EDID serial, or by being the only one of its model', () => {
    const dell = monitor('deld139', '5&1509d400&0&uid4355', 0, { serial: '12NFXG3' });
    const dellMoved = { ...dell, id: id('deld139', '5&1509d400&0&uid4999') };
    const twin = { ...dell, id: id('deld139', '5&1509d400&0&uid5000'), serial: 'OTHER' };
    expect(matchMonitors([target(dell)], [twin, dellMoved])[0]).toMatchObject({
      how: 'serial',
      actual: { id: dellMoved.id },
    });
    const { serial: _serial, ...plain } = dellMoved;
    expect(matchMonitors([target(dell)], [plain as DisplayInfo])[0]).toMatchObject({
      how: 'model',
    });
    expect(findMonitor(saved[2]!, saved, [right, centre, left])?.usbSerial).toBe('WWIN-B');
    expect(findMonitor(target(dell), [], [left])).toBeUndefined();
  });
});
