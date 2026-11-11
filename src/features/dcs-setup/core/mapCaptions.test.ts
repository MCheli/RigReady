import { describe, expect, it } from 'vitest';
import { NAME_ROOM, planCaptions } from './mapCaptions';

/** The rig as the dry run of 11 Nov 2026 had it: two big monitors and three small ones in a row. */
const desk = [
  { id: 'ultrawide', x: 0, y: 0, width: 5120, height: 1440 },
  { id: 'dell', x: 5120, y: 0, width: 2560, height: 1440 },
  { id: 'left', x: 7680, y: 0, width: 1024, height: 768 },
  { id: 'right', x: 8704, y: 0, width: 1024, height: 768 },
  { id: 'ampcd', x: 9728, y: 0, width: 1024, height: 768 },
];
/** The map was 944 pixels wide for a desktop 10752 wide. */
const scale = 944 / 10752;

describe('monitor names on the screen map', () => {
  it('moves the name into a viewport that covers a small monitor from its top', () => {
    const plan = planCaptions(
      desk,
      [
        { key: 'LEFT_MFCD', rect: { x: 7680, y: 0, width: 1024, height: 768 } },
        { key: 'RIGHT_MFCD', rect: { x: 8704, y: 0, width: 1024, height: 768 } },
        { key: 'CENTER_MFCD', rect: { x: 9728, y: 0, width: 1024, height: 768 } },
      ],
      scale
    );
    expect(plan.monitors.get('left')).toEqual({ on: 'viewport', key: 'LEFT_MFCD' });
    expect(plan.monitors.get('right')).toEqual({ on: 'viewport', key: 'RIGHT_MFCD' });
    expect(plan.monitors.get('ampcd')).toEqual({ on: 'viewport', key: 'CENTER_MFCD' });
    // 67 pixels tall: the name and both lines of the viewport fit.
    expect(plan.viewports.get('LEFT_MFCD')).toEqual({
      monitor: 'left',
      short: false,
      withSize: false,
    });
    // Nothing is drawn over the big monitors: their names stay where they were.
    expect(plan.monitors.get('ultrawide')).toEqual({ on: 'monitor' });
    expect(plan.monitors.get('dell')).toEqual({ on: 'monitor' });
  });

  it('keeps the name on the monitor when there is room above the viewport, and says how much', () => {
    // An upright MFD screen with the top quarter cropped off, as the recorded rig has it.
    const monitor = { id: 'mfd', x: 5120, y: 0, width: 768, height: 1024 };
    const viewport = { key: 'LEFT_MFCD', rect: { x: 5128, y: 256, width: 752, height: 762 } };
    const roomy = planCaptions([monitor], [viewport], 0.13);
    expect(roomy.monitors.get('mfd')).toEqual({ on: 'monitor', room: 256 * 0.13 });
    expect(roomy.viewports.size).toBe(0);
    // On a narrower map the same room is too little for two lines: the viewport takes the name.
    const tight = planCaptions([monitor], [viewport], 0.1);
    expect(256 * 0.1).toBeLessThan(NAME_ROOM);
    expect(tight.monitors.get('mfd')).toEqual({ on: 'viewport', key: 'LEFT_MFCD' });
  });

  it('leaves out the second line of a viewport too short for all three', () => {
    const plan = planCaptions(
      [{ id: 'mfd', x: 0, y: 0, width: 1024, height: 768 }],
      [{ key: 'LEFT_MFCD', rect: { x: 0, y: 0, width: 1024, height: 768 } }],
      0.07
    );
    expect(plan.viewports.get('LEFT_MFCD')).toEqual({
      monitor: 'mfd',
      short: true,
      withSize: false,
    });
  });

  it('does not hand a name to a viewport too small for it, or to one that starts on another monitor', () => {
    const monitors = [
      { id: 'a', x: 0, y: 0, width: 1920, height: 1080 },
      { id: 'b', x: 1920, y: 0, width: 1920, height: 1080 },
    ];
    const tiny = planCaptions(
      monitors,
      [{ key: 'RWR', rect: { x: 0, y: 0, width: 200, height: 200 } }],
      0.1
    );
    expect(tiny.monitors.get('a')).toEqual({ on: 'monitor' });
    // One view across both monitors holds the name of the monitor it starts on, not the other.
    const across = planCaptions(
      monitors,
      [{ key: 'Center', rect: { x: 0, y: 0, width: 3840, height: 1080 } }],
      0.1
    );
    expect(across.monitors.get('a')).toEqual({ on: 'viewport', key: 'Center' });
    // 108 pixels tall: the monitor's size fits under its name.
    expect(across.viewports.get('Center')).toEqual({ monitor: 'a', short: false, withSize: true });
    expect(across.monitors.get('b')).toEqual({ on: 'monitor' });
  });

  it('leaves every name on its monitor until the map has been measured', () => {
    const plan = planCaptions(
      desk,
      [{ key: 'LEFT_MFCD', rect: { x: 7680, y: 0, width: 1024, height: 768 } }],
      0
    );
    expect([...plan.monitors.values()]).toEqual(desk.map(() => ({ on: 'monitor' })));
    expect(plan.viewports.size).toBe(0);
  });
});
