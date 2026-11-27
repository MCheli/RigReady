import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameNumber, parseCalibration, tuneAxisText } from './calibration';

/**
 * The calibration the game saves for a controller, on fixtures/nuclear-option: read, and one
 * axis's dead zones and sensitivity set the way the game's own Calibrate window writes them,
 * with every other character left as it was.
 */
const dir = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'nuclear-option');
// As the registry holds it: the file with the zero byte Unity ends a value with.
const fixture = async (name: string): Promise<string> =>
  `${await fs.readFile(path.join(dir, name), 'utf8')}\0`;

function ok<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const refused = (result: { ok: boolean; error?: { message: string } }): string => {
  if (result.ok) throw new Error('not refused');
  return result.error!.message;
};

describe('the calibration Nuclear Option saved for a controller', () => {
  it('reads every axis: dead zone, upper dead zone, sensitivity and reversal', async () => {
    const stick = ok(parseCalibration((await fixture('calibration-stick.xml')).slice(0, -1)));
    expect(stick.axes).toHaveLength(32);
    expect(stick.axes[0]).toMatchObject({
      index: 0,
      tunable: true,
      deadZone: 0.1,
      upperDeadZone: 0,
      sensitivity: 1,
      invert: false,
    });
    expect(stick.axes[1]).toMatchObject({ deadZone: 0.05, upperDeadZone: 0.02, sensitivity: 0.8 });
    // A calibration an earlier build of the game saved has no upper dead zone.
    const throttle = ok(parseCalibration((await fixture('calibration-throttle.xml')).slice(0, -1)));
    expect(throttle.axes[0]!.upperDeadZone).toBeUndefined();
    expect(throttle.axes[2]).toMatchObject({ deadZone: 0, invert: true, tunable: true });
    // Put together again it is the same text.
    expect(stick.head + stick.axes.map((a) => a.text).join('') + stick.tail + '\0').toBe(
      await fixture('calibration-stick.xml')
    );
  });

  it('writes a number as the game does: the shortest of seven or nine digits that reads back as the same float', () => {
    expect(gameNumber(0.1)).toBe('0.1');
    expect(gameNumber(0.05)).toBe('0.05');
    expect(gameNumber(0)).toBe('0');
    expect(gameNumber(1)).toBe('1');
    expect(gameNumber(1.25)).toBe('1.25');
    // The values the game wrote when its sliders were dragged, 27 November 2026.
    expect(gameNumber(0.498286575)).toBe('0.498286575');
    expect(gameNumber(0.234286219)).toBe('0.234286219');
    expect(gameNumber(0.294531226)).toBe('0.294531226');
    expect(gameNumber(1.53551137)).toBe('1.53551137');
  });

  it('sets the dead zones and the sensitivity of one axis and changes nothing else', async () => {
    const text = await fixture('calibration-stick.xml');
    const tuned = ok(
      tuneAxisText(text, 0, { deadZone: 0.03, upperDeadZone: 0.05, sensitivity: 0.75 })
    );
    expect(tuned).toMatchObject({
      same: false,
      before: { deadZone: 0.1, upperDeadZone: 0, sensitivity: 1 },
      after: { deadZone: 0.03, upperDeadZone: 0.05, sensitivity: 0.75 },
    });
    // Exactly the three numbers of the first axis, written as the game writes them.
    expect(tuned.text).toBe(
      text.replace(
        '<deadZone>0.1</deadZone><upperDeadZone>0</upperDeadZone><calibratedZero>0</calibratedZero><calibratedMin>-1</calibratedMin><calibratedMax>1</calibratedMax><invert>false</invert><sensitivity>1</sensitivity>',
        '<deadZone>0.03</deadZone><upperDeadZone>0.05</upperDeadZone><calibratedZero>0</calibratedZero><calibratedMin>-1</calibratedMin><calibratedMax>1</calibratedMax><invert>false</invert><sensitivity>0.75</sensitivity>'
      )
    );
    expect(tuned.text.endsWith('</CalibrationMap>\0')).toBe(true);
    // Another axis: only that one differs, and the one set before is as it was.
    const second = ok(tuneAxisText(tuned.text, 31, { deadZone: 0, sensitivity: 1.5 }));
    const before = ok(parseCalibration(tuned.text.slice(0, -1))).axes;
    const after = ok(parseCalibration(second.text.slice(0, -1))).axes;
    expect(after.filter((a, i) => a.text !== before[i]!.text).map((a) => a.index)).toEqual([31]);
    expect(after[31]).toMatchObject({ deadZone: 0, upperDeadZone: 0, sensitivity: 1.5 });
  });

  it('says "the same" and returns the text as it was when the axis is tuned so already', async () => {
    const text = await fixture('calibration-stick.xml');
    const same = ok(
      tuneAxisText(text, 1, { deadZone: 0.05, upperDeadZone: 0.02, sensitivity: 0.8 })
    );
    expect(same.same).toBe(true);
    expect(same.text).toBe(text);
    // Without an upper dead zone asked for, the one it has is kept.
    const kept = ok(tuneAxisText(text, 1, { deadZone: 0.2, sensitivity: 0.8 }));
    expect(kept.after).toEqual({ deadZone: 0.2, upperDeadZone: 0.02, sensitivity: 0.8 });
  });

  it('an older calibration is tuned without an upper dead zone, and one asked for is refused with what to do', async () => {
    const text = await fixture('calibration-throttle.xml');
    const tuned = ok(tuneAxisText(text, 2, { deadZone: 0.02, sensitivity: 1.2 }));
    expect(tuned.after).toEqual({ deadZone: 0.02, sensitivity: 1.2 });
    expect(tuned.text).not.toContain('upperDeadZone');
    // The reversal the game saved for the axis is left as it is.
    expect(ok(parseCalibration(tuned.text.slice(0, -1))).axes[2]!.invert).toBe(true);
    expect(
      refused(tuneAxisText(text, 2, { deadZone: 0.02, upperDeadZone: 0.1, sensitivity: 1 }))
    ).toContain('has no upper dead zone');
  });

  it('refuses what it has not seen the game write, and values outside what its sliders give', async () => {
    const text = await fixture('calibration-stick.xml');
    const tune = (
      document: string,
      index: number,
      deadZone: number,
      sensitivity: number,
      upperDeadZone?: number
    ) =>
      tuneAxisText(document, index, {
        deadZone,
        sensitivity,
        ...(upperDeadZone !== undefined ? { upperDeadZone } : {}),
      });
    expect(refused(tune(text, 32, 0.1, 1))).toBe('The saved calibration has no such axis.');
    expect(refused(tune(text, -1, 0.1, 1))).toBe('The saved calibration has no such axis.');
    expect(ok(tune(text, 0, 0.8, 2, 0.1)).after).toEqual({
      deadZone: 0.8,
      upperDeadZone: 0.1,
      sensitivity: 2,
    });
    expect(refused(tune(text, 0, 0.85, 1))).toContain('A dead zone is 0 to 80 percent');
    expect(refused(tune(text, 0, -0.1, 1))).toContain('A dead zone is');
    expect(refused(tune(text, 0, 0.1, 3))).toContain('the sensitivity 0.1 to 2');
    expect(refused(tune(text, 0, 0.1, Number.NaN))).toContain('the sensitivity');
    expect(refused(tune(text, 0, 0.6, 1, 0.5))).toContain('together are at most 90 percent');
    // An axis with a sensitivity curve, one switched off, and one with a field more.
    const first = '<sensitivityType>0</sensitivityType><sensitivityCurve />';
    for (const changed of [
      text.replace(first, '<sensitivityType>1</sensitivityType><sensitivityCurve />'),
      text.replace(
        first,
        '<sensitivityType>0</sensitivityType><sensitivityCurve><k>1</k></sensitivityCurve>'
      ),
      text.replace('<enabled>true</enabled>', '<enabled>false</enabled>'),
      text.replace('<enabled>true</enabled>', '<enabled>true</enabled><new>1</new>'),
    ]) {
      expect(refused(tune(changed, 0, 0.2, 1))).toContain(
        'saved in a way RigReady does not understand'
      );
      // The axis after it is still tuned, and the odd one is left character for character.
      const other = ok(tune(changed, 2, 0.2, 1));
      const odd = ok(parseCalibration(changed.slice(0, -1))).axes[0]!.text;
      expect(ok(parseCalibration(other.text.slice(0, -1))).axes[0]!.text).toBe(odd);
    }
    // Not a calibration at all, and something between the axes.
    expect(refused(tune('<JoystickMap />', 0, 0.1, 1))).toContain('not in the form');
    expect(
      refused(
        tune(
          text.replace(
            '</AxisCalibration><AxisCalibration>',
            '</AxisCalibration>x<AxisCalibration>'
          ),
          0,
          0.1,
          1
        )
      )
    ).toContain('something between its axes');
    expect(refused(tune('x'.repeat(400_001), 0, 0.1, 1))).toContain('larger than any');
  });
});
