import { describe, expect, it } from 'vitest';
import {
  paintBadge,
  statusFromFlyResponse,
  TONE_RGB,
  TONE_SHAPE,
  TOOLTIP_MAX,
  trayClick,
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

  it('the tooltip names the setup, its state and what is wrong, within what Windows shows', () => {
    const base = { profileId: 'a', profileName: 'DCS F/A-18C' };
    expect(trayTooltip({})).toBe('RigReady - No setup yet');
    expect(trayTooltip(base)).toBe('RigReady - DCS F/A-18C: not checked yet');
    expect(trayTooltip({ ...base, ready: true, warnings: 0, problems: [], warningNames: [] })).toBe(
      'RigReady - DCS F/A-18C: Ready'
    );
    expect(
      trayTooltip({ ...base, ready: false, failed: 2, problems: ['TrackIR5', 'Monitor layout'] })
    ).toBe('RigReady - DCS F/A-18C: Not ready (2 problems): TrackIR5, Monitor layout');
    expect(
      trayTooltip({ ...base, ready: true, warnings: 1, warningNames: ['Stream Deck XL'] })
    ).toBe('RigReady - DCS F/A-18C: Ready (1 warning): Stream Deck XL');
    // A warning is not named while something required is missing: that comes first.
    expect(
      trayTooltip({
        ...base,
        ready: false,
        failed: 1,
        warnings: 1,
        problems: ['T-Pendular-Rudder'],
        warningNames: ['Stream Deck XL'],
      })
    ).toBe('RigReady - DCS F/A-18C: Not ready (1 problem): T-Pendular-Rudder');

    // More than fits: the first ones, and how many more. Never longer than Windows shows.
    const many = Array.from({ length: 12 }, (_, i) => `WINWING panel number ${i + 1}`);
    const long = trayTooltip({ ...base, ready: false, failed: 12, problems: many });
    expect(long.length).toBeLessThanOrEqual(TOOLTIP_MAX);
    expect(long).toBe(
      'RigReady - DCS F/A-18C: Not ready (12 problems): WINWING panel number 1, WINWING panel number 2 and 10 more'
    );
    // A name that cannot fit at all is left out: the count still says it.
    const endless = trayTooltip({ ...base, ready: false, failed: 1, problems: ['x'.repeat(200)] });
    expect(endless).toBe('RigReady - DCS F/A-18C: Not ready (1 problem)');
    const longName = { profileId: 'a', profileName: 'S'.repeat(140), ready: true };
    expect(trayTooltip(longName).length).toBe(TOOLTIP_MAX);

    // While Make ready, Launch or Stand down runs, it says so.
    expect(trayTooltip({ ...base, ready: false, failed: 1, problems: ['TrackIR5'] }, true)).toBe(
      'RigReady - DCS F/A-18C: working...'
    );
    expect(trayTooltip({}, true)).toBe('RigReady - No setup yet');
  });

  it('what is not met is read from the checklist report, by title', () => {
    const report = {
      profileId: 'a',
      ready: false,
      failed: 2,
      warnings: 1,
      fixable: 1,
      results: [
        { itemId: 'c1', title: 'Stick', required: true, status: 'pass' },
        { itemId: 'c2', title: 'TrackIR5', required: true, status: 'fail' },
        { itemId: 'c3', title: 'Stream Deck XL', required: false, status: 'warn' },
        { itemId: 'c4', title: 'Script', required: true, status: 'error' },
        // Switched off in the setup: not checked, so not a problem.
        { itemId: 'c5', title: 'Off', required: true, status: 'pass', disabled: true },
        'not a result',
      ],
    };
    const current = { profileId: 'a', profileName: 'A', profiles: [] };
    const status = statusFromFlyResponse('fly:check', report, current)!;
    expect(status.problems).toEqual(['TrackIR5', 'Script']);
    expect(status.warningNames).toEqual(['Stream Deck XL']);
    expect(trayTooltip(status)).toBe('RigReady - A: Not ready (2 problems): TrackIR5, Script');
    // Make ready and Stand down carry the report one level down.
    const made = statusFromFlyResponse('fly:makeReady', { steps: [], report }, current)!;
    expect(made.problems).toEqual(['TrackIR5', 'Script']);
    // A report without results says nothing by name.
    const bare = statusFromFlyResponse(
      'fly:check',
      { profileId: 'a', ready: true, failed: 0, warnings: 0, fixable: 0 },
      current
    )!;
    expect([bare.problems, bare.warningNames]).toEqual([[], []]);
    // The setups keep when they were last used, for the Jump List.
    const state = statusFromFlyResponse(
      'fly:state',
      {
        activeProfileId: 'a',
        profiles: [
          { id: 'a', name: 'A', canLaunch: true, lastUsed: '2026-10-03T19:30:00.000Z' },
          { id: 'b', name: 'B', canLaunch: false },
        ],
      },
      {}
    )!;
    expect(state.profiles).toEqual([
      { id: 'a', name: 'A', canLaunch: true, lastUsed: '2026-10-03T19:30:00.000Z' },
      { id: 'b', name: 'B', canLaunch: false },
    ]);
  });

  it('a double-click on the icon always opens the window; one click brings it out or puts it away', () => {
    const away = { visible: false, minimized: false, inFront: false };
    const minimized = { visible: true, minimized: true, inFront: false };
    const behind = { visible: true, minimized: false, inFront: false };
    const inFront = { visible: true, minimized: false, inFront: true };
    for (const window of [away, minimized, behind, inFront]) {
      expect(trayClick('double-click', window)).toBe('show');
    }
    expect(trayClick('click', away)).toBe('show');
    expect(trayClick('click', minimized)).toBe('show');
    // Behind another window: brought to the front, not hidden.
    expect(trayClick('click', behind)).toBe('show');
    // What the user is looking at: put away.
    expect(trayClick('click', inFront)).toBe('hide');
  });
});
