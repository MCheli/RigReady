import { describe, expect, it } from 'vitest';
import type { DisplayInfo, DisplayTarget } from '../../../shared/models';
import { matchMonitors, modelOf } from './identity';
import { checkMonitorName, monitorLabels, monitorNumbers, orientationText } from './labels';
import { analyzeLayout, joinNames } from './plan';

const mfd = (instance: string, x: number, extra: Partial<DisplayInfo> = {}): DisplayInfo => ({
  id: `\\\\?\\display#reg0319#${instance}&0&uid256#{e6f07b5f}`,
  name: 'USB_Monitor',
  edid: 'REG0319',
  enabled: true,
  primary: false,
  x,
  y: 0,
  width: 768,
  height: 1024,
  rotation: 90,
  ...extra,
});

const ultrawide: DisplayInfo = {
  id: '\\\\?\\display#sam7053#5&1509d400&0&uid4357#{e6f07b5f}',
  name: 'LC49G95T',
  edid: 'SAM7053',
  enabled: true,
  primary: true,
  x: 0,
  y: 0,
  width: 5120,
  height: 1440,
  rotation: 0,
};

const asTarget = (d: DisplayInfo): DisplayTarget => ({
  id: d.id,
  name: d.name,
  enabled: d.enabled,
  primary: d.primary,
  x: d.x,
  y: d.y,
  width: d.width,
  height: d.height,
  rotation: d.rotation,
});

describe('monitor identity', () => {
  it('reads the EDID model from a monitor id', () => {
    expect(modelOf(ultrawide.id)).toBe('SAM7053');
    expect(modelOf('something else')).toBeUndefined();
  });

  it('matches two monitors with identical EDID data to the right layout entries by connector', () => {
    const a = mfd('a&2c1ac5a9', 5120);
    const b = mfd('a&270816bc', 5888);
    // Listed in the other order, and with the ids in another case: still each to its own.
    const matches = matchMonitors(
      [asTarget(b), asTarget(a)],
      [{ ...a, id: a.id.toUpperCase() }, b].map((d) => ({ ...d, id: d.id.toLowerCase() }))
    );
    expect(matches.map((m) => [m.expected.x, m.actual?.x, m.how])).toEqual([
      [5888, 5888, 'id'],
      [5120, 5120, 'id'],
    ]);
  });

  it('finds a unique monitor that moved to another connector by its model', () => {
    const moved = { ...ultrawide, id: '\\\\?\\display#sam7053#5&1509d400&0&uid9999#{e6f07b5f}' };
    const [match] = matchMonitors([asTarget(ultrawide)], [moved]);
    expect(match).toMatchObject({ how: 'model', actual: { id: moved.id } });
  });

  it('does not guess between identical monitors that all moved', () => {
    const expected = [mfd('a&1', 5120), mfd('a&2', 5888)].map(asTarget);
    const now = [mfd('b&1', 5120), mfd('b&2', 5888)];
    const matches = matchMonitors(expected, now);
    expect(matches.map((m) => [m.actual, m.lookalikes])).toEqual([
      [undefined, 2],
      [undefined, 2],
    ]);
    const analysis = analyzeLayout(expected, now);
    expect(analysis.differences[0]).toBe(
      'USB_Monitor (1 of 2) was not found where it was: 2 identical monitors are connected elsewhere, so RigReady cannot tell which one it is'
    );
    expect(analysis.missing).toEqual(['USB_Monitor (1 of 2)', 'USB_Monitor (2 of 2)']);
  });
});

describe('labels', () => {
  it('uses the given name, otherwise the EDID name with a count for identical monitors', () => {
    const labels = monitorLabels(
      [
        { id: 'A', name: 'USB_Monitor' },
        { id: 'b', name: '' },
        { id: 'c', name: 'USB_Monitor' },
      ],
      { c: 'MFD right' }
    );
    expect([...labels.entries()]).toEqual([
      ['a', 'USB_Monitor (1 of 2)'],
      ['b', 'Monitor'],
      ['c', 'MFD right'],
    ]);
  });

  it('numbers the monitors that are on from left to right', () => {
    const off = { ...mfd('a&3', 0), enabled: false };
    const numbers = monitorNumbers([mfd('a&2', 5888), off, ultrawide, mfd('a&1', 5120)]);
    expect([...numbers.values()]).toEqual([1, 2, 3]);
    expect(numbers.get(ultrawide.id.toLowerCase())).toBe(1);
    expect(numbers.has(off.id.toLowerCase())).toBe(false);
  });

  it("describes rotations in Windows' words", () => {
    expect([0, 90, 180, 270].map((r) => orientationText(r as 0))).toEqual([
      'Landscape',
      'Portrait',
      'Landscape (flipped)',
      'Portrait (flipped)',
    ]);
  });

  it('checks monitor names: trimmed, not too long, not used twice', () => {
    expect(checkMonitorName('  MFD   left ', 'x', {})).toEqual({ ok: true, name: 'MFD left' });
    expect(checkMonitorName('', 'x', { x: 'old' })).toEqual({ ok: true, name: '' });
    expect(checkMonitorName('a'.repeat(41), 'x', {})).toMatchObject({ ok: false });
    expect(checkMonitorName('mfd LEFT', 'y', { x: 'MFD left' })).toEqual({
      ok: false,
      message: 'Another monitor is already called "MFD left".',
    });
    expect(checkMonitorName('MFD left', 'X', { x: 'MFD left' })).toMatchObject({ ok: true });
  });

  it('joins names in plain English', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['TV'])).toBe('TV');
    expect(joinNames(['MFD left', 'TV'])).toBe('MFD left and TV');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('analyzeLayout', () => {
  const now = [ultrawide, mfd('a&1', 5120), mfd('a&2', 5888)];

  it('moves the main display to 0,0 so a layout saved elsewhere still matches', () => {
    const shifted = now.map((d) => ({ ...asTarget(d), x: d.x + 100, y: d.y - 50 }));
    const analysis = analyzeLayout(shifted, now);
    expect(analysis.differences).toEqual([]);
    expect(analysis.targets.map((t) => [t.x, t.y, t.primary])).toEqual([
      [0, 0, true],
      [5120, 0, false],
      [5888, 0, false],
    ]);
    expect(analysis.primaryLabel).toBe('LC49G95T');
  });

  it('rejects monitors that overlap, but not monitors that only touch', () => {
    const touching = analyzeLayout(now.map(asTarget), now);
    expect(touching.problems).toEqual([]);
    const overlapping = now.map((d, i) => ({ ...asTarget(d), x: i === 2 ? 5500 : d.x }));
    expect(analyzeLayout(overlapping, now).problems).toEqual([
      'USB_Monitor (1 of 2) and USB_Monitor (2 of 2) overlap.',
    ]);
  });

  it('uses the connected size, turned, when a layout entry has none', () => {
    const landscape = { ...mfd('a&1', 5120), width: 1024, height: 768, rotation: 0 as const };
    const target: DisplayTarget = { ...asTarget(landscape), rotation: 90 };
    delete target.width;
    delete target.height;
    const overlapping = analyzeLayout(
      [asTarget(ultrawide), { ...target, x: 5000 }],
      [ultrawide, landscape]
    );
    expect(overlapping.problems).toEqual(['LC49G95T and USB_Monitor overlap.']);
    expect(overlapping.targets[1]).not.toHaveProperty('width');
  });

  it('when the main display is missing another one takes over', () => {
    const dell: DisplayTarget = {
      id: '\\\\?\\display#deld139#x#{y}',
      name: 'DELL G3223D',
      enabled: true,
      primary: true,
      x: 0,
      y: 0,
      width: 2560,
      height: 1440,
      rotation: 0,
    };
    const desk = [dell, { ...asTarget(ultrawide), primary: false, x: 2560 }];
    const analysis = analyzeLayout(desk, [ultrawide]);
    expect(analysis.missing).toEqual(['DELL G3223D']);
    expect(analysis.primaryMissing).toBe('DELL G3223D');
    expect(analysis.primaryLabel).toBe('LC49G95T');
    expect(analysis.targets).toEqual([
      expect.objectContaining({ id: ultrawide.id, primary: true, x: 0, y: 0 }),
    ]);
    expect(analysis.changes).toEqual([]);
  });

  it('refuses to turn every monitor off', () => {
    const allOff = now.map((d) => ({ ...asTarget(d), enabled: false }));
    expect(analyzeLayout(allOff, now).problems).toEqual([
      'The layout would turn every monitor off.',
    ]);
  });
});
