import { describe, expect, it } from 'vitest';
import type { DisplayInfo, DisplayTarget } from '../../../shared/models';
import { monitorKeys, notAsAsked, proofOf, sameProof } from './proven';

/** "Known to work on this PC": what counts as the same change with the same monitors. */

const dell: DisplayInfo = {
  id: '\\\\?\\display#deld139#5&1509d400&0&uid4355#{e6f07b5f}',
  name: 'DELL G3223D',
  enabled: true,
  primary: true,
  x: 0,
  y: 0,
  width: 2560,
  height: 1440,
  rotation: 0,
  refreshHz: 60,
};
const wide: DisplayInfo = {
  id: '\\\\?\\display#sam7053#5&1509d400&0&uid4357#{e6f07b5f}',
  name: 'LC49G95T',
  enabled: true,
  primary: false,
  x: 2560,
  y: 0,
  width: 5120,
  height: 1440,
  rotation: 0,
  refreshHz: 120,
};
const mfd = (port: string, usbSerial: string, x: number): DisplayInfo => ({
  id: `\\\\?\\display#reg0319#${port}&0&uid256#{e6f07b5f}`,
  name: 'USB_Monitor',
  enabled: true,
  primary: false,
  x,
  y: 0,
  width: 1024,
  height: 768,
  rotation: 0,
  usbSerial,
});
const left = mfd('a&2c1ac5a9', 'WWIN-1', 7680);
const right = mfd('a&270816bc', 'WWIN-2', 8704);
const desk = (): DisplayInfo[] => [dell, wide, left, right].map((d) => ({ ...d }));

const on = (d: DisplayInfo, extra: Partial<DisplayTarget>): DisplayTarget => ({
  id: d.id,
  name: d.name,
  enabled: true,
  primary: false,
  x: 0,
  y: 0,
  rotation: 0,
  ...extra,
});
const off = (d: DisplayInfo): DisplayTarget => ({
  id: d.id,
  name: d.name,
  enabled: false,
  primary: false,
  x: 0,
  y: 0,
  rotation: 0,
});
/** Flying: the Dell off, the ultrawide the main display, both small screens in portrait. */
const flying = (): DisplayTarget[] => [
  on(wide, { primary: true, width: 5120, height: 1440 }),
  on(left, { x: 5120, width: 768, height: 1024, rotation: 90 }),
  on(right, { x: 5888, width: 768, height: 1024, rotation: 90 }),
  off(dell),
];

describe('what a monitor is known by', () => {
  it('is the USB serial of a USB screen, which follows it to any port, and otherwise its id', () => {
    const keys = monitorKeys(desk());
    expect(keys.get(left.id)).toBe('usb:WWIN-1');
    expect(keys.get(right.id)).toBe('usb:WWIN-2');
    expect(keys.get(dell.id)).toBe(`id:${dell.id}`);
  });

  it('falls back to the id when two connected screens report the same USB serial', () => {
    const twin = { ...right, usbSerial: 'WWIN-1' };
    const keys = monitorKeys([left, twin]);
    expect(keys.get(left.id)).toBe(`id:${left.id}`);
    expect(keys.get(twin.id)).toBe(`id:${twin.id}`);
  });
});

describe('the same change with the same monitors', () => {
  it('is the same whatever order the monitors are listed in and however the ids are cased', () => {
    const a = proofOf(flying(), desk())!;
    const b = proofOf(
      flying()
        .reverse()
        .map((t) => ({ ...t, id: t.id.toUpperCase() })),
      desk().reverse()
    )!;
    expect(a).toBeDefined();
    expect(sameProof(a, b)).toBe(true);
    expect(a.monitors).toHaveLength(4);
    expect(a.asked).toHaveLength(4);
    expect(a.others).toEqual([]);
  });

  it('is the same from any arrangement the monitors start in: what counts is where they end', () => {
    const fromDesk = proofOf(flying(), desk())!;
    const turned = desk().map((d) =>
      d.id === left.id ? { ...d, rotation: 90 as const, width: 768, height: 1024 } : d
    );
    expect(sameProof(fromDesk, proofOf(flying(), turned)!)).toBe(true);
  });

  it('is the same when a USB screen was moved to another port', () => {
    const before = proofOf(flying(), desk())!;
    const moved = { ...left, id: left.id.replace('a&2c1ac5a9', 'b&11111111') };
    const connected = desk().map((d) => (d.id === left.id ? moved : d));
    const targets = flying().map((t) => (t.id === left.id ? { ...t, id: moved.id } : t));
    expect(sameProof(before, proofOf(targets, connected)!)).toBe(true);
  });

  it('is a different one when a monitor was added or taken away', () => {
    const before = proofOf(flying(), desk())!;
    const tv: DisplayInfo = { ...dell, id: '\\\\?\\display#tv00001#5&1&0&uid1#{x}', name: 'TV' };
    expect(sameProof(before, proofOf(flying(), [...desk(), { ...tv, enabled: false }])!)).toBe(
      false
    );
    const without = flying().filter((t) => t.id !== right.id);
    expect(
      sameProof(
        before,
        proofOf(
          without,
          desk().filter((d) => d.id !== right.id)
        )!
      )
    ).toBe(false);
  });

  it('is a different one when a monitor it does not mention is on instead of off, or the other way', () => {
    const partial = flying().filter((t) => t.id !== dell.id);
    const dellOn = proofOf(partial, desk())!;
    const dellOff = proofOf(
      partial,
      desk().map((d) => (d.id === dell.id ? { ...d, enabled: false } : d))
    )!;
    expect(dellOn.others).toEqual([`id:${dell.id}|on`]);
    expect(dellOff.others).toEqual([`id:${dell.id}|off`]);
    expect(sameProof(dellOn, dellOff)).toBe(false);
  });

  it('is a different one for any other place, size, rotation, main display or refresh rate', () => {
    const kept = proofOf(flying(), desk())!;
    const changed = (change: (t: DisplayTarget) => DisplayTarget): boolean =>
      sameProof(kept, proofOf(flying().map(change), desk())!);
    const onLeft = (extra: Partial<DisplayTarget>) => (t: DisplayTarget) =>
      t.id === left.id ? { ...t, ...extra } : t;
    expect(changed((t) => t)).toBe(true);
    expect(changed(onLeft({ x: 5121 }))).toBe(false);
    expect(changed(onLeft({ y: 1 }))).toBe(false);
    expect(changed(onLeft({ rotation: 270 }))).toBe(false);
    expect(changed(onLeft({ width: 1024, height: 768, rotation: 0 }))).toBe(false);
    expect(changed(onLeft({ refreshHz: 60 }))).toBe(false);
    expect(changed(onLeft({ enabled: false }))).toBe(false);
    expect(
      changed((t) =>
        t.id === wide.id ? { ...t, primary: false } : t.id === left.id ? { ...t, primary: true } : t
      )
    ).toBe(false);
  });

  it('takes the size a monitor has now when the change gives none, turned when the change turns it', () => {
    const sized = proofOf([on(left, { x: 100, rotation: 90 })], desk())!;
    expect(sized.asked).toEqual(['usb:WWIN-1|on|not main|100,0|768x1024|90deg|any rate']);
    const same = proofOf([on(left, { x: 100, rotation: 90, width: 768, height: 1024 })], desk())!;
    expect(sameProof(sized, same)).toBe(true);
  });
});

describe('when it cannot be said for certain what a change comes to', () => {
  it('there is no proof: a monitor it names is not connected', () => {
    expect(
      proofOf(
        flying(),
        desk().filter((d) => d.id !== right.id)
      )
    ).toBeUndefined();
  });

  it('there is no proof: a monitor that is off would come on at a size the change does not give', () => {
    const dark = desk().map((d) =>
      d.id === left.id ? { ...d, enabled: false, width: 0, height: 0 } : d
    );
    expect(proofOf([on(left, { x: 100 })], dark)).toBeUndefined();
    // With the size given it can be said.
    expect(proofOf([on(left, { x: 100, width: 1024, height: 768 })], dark)).toBeDefined();
  });

  it('there is no proof: the change names a monitor twice, or names none', () => {
    expect(proofOf([off(dell), off(dell)], desk())).toBeUndefined();
    expect(proofOf([], desk())).toBeUndefined();
  });
});

describe('reading the monitors back', () => {
  const after = (): DisplayInfo[] => [
    { ...dell, enabled: false, primary: false, width: 0, height: 0 },
    { ...wide, primary: true, x: 0 },
    { ...left, x: 5120, width: 768, height: 1024, rotation: 90 },
    { ...right, x: 5888, width: 768, height: 1024, rotation: 90 },
  ];

  it('finds nothing wrong when they are as the change asked', () => {
    expect(notAsAsked(flying(), after())).toEqual([]);
  });

  it('says each thing that is not as asked', () => {
    const now = after().map((d) => {
      if (d.id === dell.id) return { ...dell };
      if (d.id === wide.id) return { ...d, primary: false, refreshHz: 60 };
      if (d.id === left.id) return { ...d, rotation: 0 as const, width: 1024, height: 768 };
      if (d.id === right.id) return { ...d, x: 6144 };
      return d;
    });
    const asked = flying().map((t) => (t.id === wide.id ? { ...t, refreshHz: 120 } : t));
    expect(notAsAsked(asked, now)).toEqual([
      'LC49G95T is not the main display',
      'LC49G95T runs at 60 Hz, asked 120 Hz',
      'USB_Monitor is rotated 0°, asked 90°',
      'USB_Monitor is 1024x768, asked 768x1024',
      'USB_Monitor is at 6144,0, asked 5888,0',
      'DELL G3223D is on, asked off',
    ]);
    expect(
      notAsAsked(
        flying(),
        after().filter((d) => d.id !== right.id)
      )
    ).toEqual(['USB_Monitor is not connected']);
    expect(
      notAsAsked(
        flying(),
        after().map((d) => (d.id === left.id ? { ...d, enabled: false } : d))
      )
    ).toEqual(['USB_Monitor is off, asked on']);
  });
});
