import { err, ok, type Result } from '../../../core/result';

/**
 * A controller's saved calibration (Rewired's `CalibrationMap`): for each axis a dead zone,
 * an upper dead zone, a zero, a range, a reversal and a sensitivity. The game's own
 * controls screen sets them in its Calibrate window, and the game reads them when it starts.
 *
 * Text in, text out, nothing else touched. Only the three numbers the game was seen to
 * write when their sliders were moved are changed (docs/research/nuclear-option.md, "Axis
 * tuning"): `deadZone`, `upperDeadZone` and `sensitivity`. The zero, the range and the
 * reversal are the game's: the first two come from moving the real axis in its Calibrate
 * window, and a binding has a reversal of its own on the bindings page.
 */

const MAX_LENGTH = 400_000;
const NUMBER = '-?\\d+(?:\\.\\d+)?(?:E-?\\d+)?';
const BOOL = 'true|false';

/** One axis exactly as the game writes it; anything else is kept as it is and not changed. */
const AXIS = new RegExp(
  '^<AxisCalibration>' +
    `<enabled>(${BOOL})</enabled>` +
    `<deadZone>(${NUMBER})</deadZone>` +
    `(?:<upperDeadZone>(${NUMBER})</upperDeadZone>)?` +
    `<calibratedZero>(${NUMBER})</calibratedZero>` +
    `<calibratedMin>(${NUMBER})</calibratedMin>` +
    `<calibratedMax>(${NUMBER})</calibratedMax>` +
    `<invert>(${BOOL})</invert>` +
    `<sensitivity>(${NUMBER})</sensitivity>` +
    `<applyRangeCalibration>(${BOOL})</applyRangeCalibration>` +
    '<sensitivityType>(\\d+)</sensitivityType>' +
    '(<sensitivityCurve />|<sensitivityCurve>.*?</sensitivityCurve>)' +
    '</AxisCalibration>$',
  's'
);

export interface AxisCalibration {
  /** The game's number for the axis: 0 the first. */
  index: number;
  /** The axis is written the way this code knows, with a plain sensitivity (no curve). */
  tunable: boolean;
  /** The axis is in a shape this code does not read: the numbers below are not its own. */
  unread: boolean;
  deadZone: number;
  /** Absent in a calibration an earlier build of the game saved. */
  upperDeadZone?: number;
  sensitivity: number;
  /** Reversed for everything bound to the axis. Shown, not changed here. */
  invert: boolean;
  /** The axis as it is stored. */
  text: string;
}

export interface Calibration {
  axes: AxisCalibration[];
  /** Everything before the first axis and after the last, as stored. */
  head: string;
  tail: string;
}

export function parseCalibration(document: string): Result<Calibration> {
  if (document.length > MAX_LENGTH) {
    return err(
      'nuclear-option.calibration',
      'The saved calibration is larger than any the game writes.'
    );
  }
  const parts = /^(.*?<CalibrationMap\b[^>]*>.*?<axes>)(.*)(<\/axes>.*)$/s.exec(document);
  if (!parts) {
    return err(
      'nuclear-option.calibration',
      'The saved calibration is not in the form the game writes.'
    );
  }
  const [, head, list, tail] = parts as unknown as [string, string, string, string];
  const texts = list.match(/<AxisCalibration>.*?<\/AxisCalibration>/gs) ?? [];
  // The list is its axes one after another and nothing else.
  if (texts.join('') !== list) {
    return err(
      'nuclear-option.calibration',
      'The saved calibration holds something between its axes that RigReady does not understand.'
    );
  }
  const axes = texts.map((text, index): AxisCalibration => {
    const m = AXIS.exec(text);
    const plain =
      m !== null && m[1] === 'true' && m[10] === '0' && m[11] === '<sensitivityCurve />';
    return {
      index,
      tunable: plain,
      unread: m === null,
      deadZone: m ? Number(m[2]) : 0,
      ...(m?.[3] !== undefined ? { upperDeadZone: Number(m[3]) } : {}),
      sensitivity: m ? Number(m[8]) : 1,
      invert: m?.[7] === 'true',
      text,
    };
  });
  return ok({ axes, head, tail });
}

/**
 * A number as the game writes one: a 32-bit float in the shortest of seven or nine
 * significant digits that reads back as itself (0.1 as "0.1", a slider's 0.498286575 in full).
 */
/** Never "1e-7": the game writes such a number another way, which this code has not seen. */
const plainDecimal = (value: number): string => {
  const text = String(value);
  return /e/i.test(text) ? value.toFixed(9).replace(/\.?0+$/, '') : text;
};

export function gameNumber(value: number): string {
  const single = Math.fround(value);
  for (const digits of [7, 9]) {
    const short = Number(single.toPrecision(digits));
    if (Math.fround(short) === single) return plainDecimal(short);
  }
  return plainDecimal(Number(single.toPrecision(9)));
}

export interface AxisTuning {
  /** 0 (none) to 1: how far from its zero the axis moves before the game takes notice. */
  deadZone: number;
  /** 0 (none) to 1: how far before its end the axis counts as fully moved. */
  upperDeadZone?: number;
  /** 1 is as the controller reports; less is calmer, more is quicker. */
  sensitivity: number;
}

/**
 * The least and the most each setting may be: the ends of the sliders in the game's own
 * Calibrate window, read from what it saved with each at its end (27 November 2026). The two
 * dead zones together are at most 0.9 there.
 */
export const DEAD_ZONES_TOGETHER = 0.9;

export const TUNING_LIMITS = {
  deadZone: { min: 0, max: 0.8 },
  upperDeadZone: { min: 0, max: 0.8 },
  sensitivity: { min: 0.1, max: 2 },
} as const;

export interface TuneOutcome {
  /** The document to store; the same text as before when nothing had to change. */
  text: string;
  before: AxisTuning;
  after: AxisTuning;
  same: boolean;
}

const within = (value: number, limits: { min: number; max: number }): boolean =>
  Number.isFinite(value) && value >= limits.min && value <= limits.max;

/** A setting as the page shows it: whole percents, hundredths of the sensitivity. */
const shown = (value: number): number => Math.round(value * 100) / 100;

/** Sets the dead zones and the sensitivity of one axis in the stored text of a calibration. */
export function tuneAxisText(
  document: string,
  index: number,
  wanted: AxisTuning
): Result<TuneOutcome> {
  const terminated = document.endsWith('\0');
  const parsed = parseCalibration(terminated ? document.slice(0, -1) : document);
  if (!parsed.ok) return parsed;
  const calibration = parsed.value;
  const axis = calibration.axes[index];
  if (!Number.isInteger(index) || !axis) {
    return err('nuclear-option.calibration.axis', 'The saved calibration has no such axis.');
  }
  if (!axis.tunable) {
    return err(
      'nuclear-option.calibration.unknown',
      'This axis is saved in a way RigReady does not understand (switched off, or with a sensitivity curve), so it was left alone. Change it in the game: Settings, Controls, then Calibrate.'
    );
  }
  // A setting asked for as the page shows the one saved (the game's slider left 0.498286575,
  // the page shows 50 %) is not a change: the saved number stays, digit for digit.
  const keeps = {
    deadZone: shown(wanted.deadZone) === shown(axis.deadZone),
    upperDeadZone:
      wanted.upperDeadZone === undefined ||
      (axis.upperDeadZone !== undefined &&
        shown(wanted.upperDeadZone) === shown(axis.upperDeadZone)),
    sensitivity: shown(wanted.sensitivity) === shown(axis.sensitivity),
  };
  if (
    (!keeps.deadZone && !within(wanted.deadZone, TUNING_LIMITS.deadZone)) ||
    (!keeps.sensitivity && !within(wanted.sensitivity, TUNING_LIMITS.sensitivity)) ||
    (!keeps.upperDeadZone &&
      wanted.upperDeadZone !== undefined &&
      !within(wanted.upperDeadZone, TUNING_LIMITS.upperDeadZone))
  ) {
    return err(
      'nuclear-option.calibration.range',
      `A dead zone is ${TUNING_LIMITS.deadZone.min * 100} to ${TUNING_LIMITS.deadZone.max * 100} percent, and the sensitivity ${TUNING_LIMITS.sensitivity.min} to ${TUNING_LIMITS.sensitivity.max}.`
    );
  }
  if (wanted.upperDeadZone !== undefined && axis.upperDeadZone === undefined) {
    return err(
      'nuclear-option.calibration.noUpper',
      'This calibration was saved by an earlier version of the game and has no upper dead zone. Open the game’s Calibrate window for this controller once and press Done; then it has one.'
    );
  }
  // The two dead zones together leave some of the axis to move in.
  const upper = wanted.upperDeadZone ?? axis.upperDeadZone ?? 0;
  if (
    !(keeps.deadZone && keeps.upperDeadZone) &&
    wanted.deadZone + upper > DEAD_ZONES_TOGETHER + 1e-9
  ) {
    return err(
      'nuclear-option.calibration.range',
      'The two dead zones together are at most 90 percent, as in the game’s Calibrate window.'
    );
  }
  const before: AxisTuning = {
    deadZone: axis.deadZone,
    ...(axis.upperDeadZone !== undefined ? { upperDeadZone: axis.upperDeadZone } : {}),
    sensitivity: axis.sensitivity,
  };
  const field = (text: string, name: string, value: number): string =>
    text.replace(
      new RegExp(`<${name}>${NUMBER}</${name}>`),
      `<${name}>${gameNumber(value)}</${name}>`
    );
  let text = axis.text;
  if (!keeps.deadZone) text = field(text, 'deadZone', wanted.deadZone);
  if (!keeps.upperDeadZone && wanted.upperDeadZone !== undefined) {
    text = field(text, 'upperDeadZone', wanted.upperDeadZone);
  }
  if (!keeps.sensitivity) text = field(text, 'sensitivity', wanted.sensitivity);
  if (text === axis.text) {
    return ok({ text: document, before, after: before, same: true });
  }
  const changed =
    calibration.head +
    calibration.axes.map((a) => (a.index === index ? text : a.text)).join('') +
    calibration.tail +
    (terminated ? '\0' : '');
  // Its own check: what was written reads back as meant, and nothing else differs.
  const again = parseCalibration(terminated ? changed.slice(0, -1) : changed);
  const now = again.ok ? again.value.axes[index] : undefined;
  const single = (n: number): number => Math.fround(n);
  if (
    !again.ok ||
    !now?.tunable ||
    again.value.head !== calibration.head ||
    again.value.tail !== calibration.tail ||
    again.value.axes.length !== calibration.axes.length ||
    again.value.axes.some((a) => a.index !== index && a.text !== calibration.axes[a.index]!.text) ||
    now.invert !== axis.invert ||
    single(now.deadZone) !== single(keeps.deadZone ? axis.deadZone : wanted.deadZone) ||
    single(now.sensitivity) !== single(keeps.sensitivity ? axis.sensitivity : wanted.sensitivity) ||
    single(now.upperDeadZone ?? -1) !==
      single(
        keeps.upperDeadZone || wanted.upperDeadZone === undefined
          ? (axis.upperDeadZone ?? -1)
          : wanted.upperDeadZone
      ) ||
    // Only the numbers asked for differ within the axis.
    text.replace(new RegExp(NUMBER, 'g'), '#').length !==
      axis.text.replace(new RegExp(NUMBER, 'g'), '#').length
  ) {
    return err(
      'nuclear-option.calibration.check',
      'The changed calibration did not read back as intended, so nothing was changed.'
    );
  }
  const after: AxisTuning = {
    deadZone: now.deadZone,
    ...(now.upperDeadZone !== undefined ? { upperDeadZone: now.upperDeadZone } : {}),
    sensitivity: now.sensitivity,
  };
  return ok({ text: changed, before, after, same: false });
}
