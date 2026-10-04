import { describe, expect, it } from 'vitest';
import {
  paintBadge,
  TONE_RGB,
  TONE_SHAPE,
  trayMenu,
  trayStatusLine,
  trayTone,
  trayTooltip,
} from '../../src/main/trayModel';

describe('tray', () => {
  it('the icon badge follows readiness: none until checked, then green, yellow or red', () => {
    expect(trayTone({})).toBeUndefined();
    expect(trayTone({ profileId: 'a' })).toBeUndefined();
    expect(trayTone({ profileId: 'a', ready: true, warnings: 0 })).toBe('ok');
    expect(trayTone({ profileId: 'a', ready: true, warnings: 2 })).toBe('warn');
    expect(trayTone({ profileId: 'a', ready: false, failed: 1 })).toBe('bad');
  });

  it('paints the badge into the bottom-right of the icon and leaves the rest alone', () => {
    const size = 32;
    const icon = new Uint8Array(size * size * 4).fill(7);
    const painted = paintBadge(icon, size, TONE_RGB.bad);
    const pixel = (x: number, y: number): number[] => {
      const i = (y * size + x) * 4;
      return [...painted.subarray(i, i + 4)];
    };
    // BGRA: the red tone, fully opaque, at the badge's centre...
    expect(pixel(24, 24)).toEqual([0x5b, 0x63, 0xee, 255]);
    // ...and the top-left of the icon untouched.
    expect(pixel(2, 2)).toEqual([7, 7, 7, 7]);
    expect(icon[(24 * size + 24) * 4]).toBe(7);
  });

  it('never says it by colour alone: each tone has its own badge shape and its words', () => {
    // NFR-011. Three tones, three shapes.
    expect(new Set(Object.values(TONE_SHAPE)).size).toBe(Object.keys(TONE_RGB).length);
    const size = 32;
    const blank = new Uint8Array(size * size * 4);
    /** Per row of the icon: how many pixels the badge covers. */
    const footprint = (tone: keyof typeof TONE_RGB): number[] => {
      const painted = paintBadge(blank, size, TONE_RGB[tone]);
      const rows: number[] = [];
      for (let y = 0; y < size; y++) {
        let covered = 0;
        for (let x = 0; x < size; x++) if (painted[(y * size + x) * 4 + 3] === 255) covered++;
        rows.push(covered);
      }
      return rows;
    };
    const shapes = (['ok', 'warn', 'bad'] as const).map(footprint);
    // The outlines differ, whatever the colour: a dot, a triangle and a square.
    expect(new Set(shapes.map((rows) => rows.join(','))).size).toBe(3);
    const width = (rows: number[], line: number): number => rows[line]!;
    const [dot, triangle, square] = shapes as [number[], number[], number[]];
    // Two rows above the centre (y = 22) and two rows above the bottom (y = 28).
    expect(width(square, 16)).toBe(width(square, 28));
    expect(width(triangle, 16)).toBeLessThan(width(triangle, 28));
    expect(width(dot, 14)).toBeLessThan(width(dot, 22));
    expect(width(dot, 30)).toBeLessThan(width(dot, 22));

    // And the words: whenever there is a tone, the tooltip and the menu say the status.
    const cases = [
      { status: { profileId: 'a', profileName: 'A', ready: true, warnings: 0 }, says: 'A: Ready' },
      {
        status: { profileId: 'a', profileName: 'A', ready: true, warnings: 2 },
        says: 'A: Ready (2 warnings)',
      },
      {
        status: { profileId: 'a', profileName: 'A', ready: false, failed: 1 },
        says: 'A: Not ready (1 problem)',
      },
    ];
    for (const { status, says } of cases) {
      expect(trayTone(status)).toBeDefined();
      expect(trayStatusLine(status)).toBe(says);
      expect(trayTooltip(status)).toBe(`RigReady - ${says}`);
      expect(trayMenu(status).find((item) => item.id === 'status')?.label).toBe(says);
    }
    // No tone, and the words still say why.
    expect(trayTooltip({ profileId: 'a', profileName: 'A' })).toBe('RigReady - A: not checked yet');
  });

  it('lists the setups for a quick switch, and Launch only for a setup that can launch', () => {
    const status = {
      profileId: 'a',
      profileName: 'A',
      ready: true,
      profiles: [
        { id: 'a', name: 'A', canLaunch: false },
        { id: 'b', name: 'B', canLaunch: true },
      ],
    };
    const menu = trayMenu(status);
    expect(menu.map((i) => i.id)).toEqual([
      'open',
      'separator',
      'status',
      'setups',
      'makeReady',
      'launch',
      'standDown',
      'separator',
      'quit',
    ]);
    expect(menu.find((i) => i.id === 'setups')?.submenu).toEqual([
      { id: 'profile:a', label: 'A', enabled: true, checked: true },
      { id: 'profile:b', label: 'B', enabled: true, checked: false },
    ]);
    expect(menu.find((i) => i.id === 'launch')?.enabled).toBe(false);
    expect(trayMenu({ ...status, profileId: 'b' }).find((i) => i.id === 'launch')?.enabled).toBe(
      true
    );
    const busy = trayMenu(status, true);
    expect(
      busy
        .filter((i) => ['makeReady', 'launch', 'standDown', 'setups'].includes(i.id))
        .every((i) => !i.enabled)
    ).toBe(true);
  });
});
