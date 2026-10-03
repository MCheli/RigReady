import { describe, expect, it } from 'vitest';
import { paintBadge, TONE_RGB, trayMenu, trayTone } from '../../src/main/trayModel';

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
    expect(pixel(24, 24)).toEqual([0x4b, 0x53, 0xe5, 255]);
    // ...and the top-left of the icon untouched.
    expect(pixel(2, 2)).toEqual([7, 7, 7, 7]);
    expect(icon[(24 * size + 24) * 4]).toBe(7);
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
