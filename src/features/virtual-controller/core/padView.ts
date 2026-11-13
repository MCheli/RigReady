import { NEUTRAL_PAD_REPORT, type PadReport, type VirtualPadKind } from '../../../shared/models';
import { BUTTON_BITS, BUTTON_NAMES, DS4_LABELS, type ButtonName } from './profile';

/**
 * What the live picture of the virtual controller shows for one report: where each stick
 * stands, how far each trigger is pressed and which buttons are down, and the same in
 * words. The words stand beside the picture, so nothing is said by a lit colour alone.
 */

export interface PadView {
  /** -1 to 1, right and up positive. */
  left: { x: number; y: number };
  right: { x: number; y: number };
  /** 0 to 1. */
  lt: number;
  rt: number;
  pressed: ButtonName[];
  /** The same as `valuesText`, a line each for the triggers, the left and the right stick. */
  valueLines: string[];
  /** "LT 0% · RT 62% · Left stick: 40% right · Right stick: centred". */
  valuesText: string;
  /** "Pressed: A, RB", or "Nothing pressed". */
  pressedText: string;
}

const SHORT: Record<ButtonName, string> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  lb: 'LB',
  rb: 'RB',
  back: 'Back',
  start: 'Start',
  ls: 'L3',
  rs: 'R3',
  guide: 'Guide',
  up: 'D-pad up',
  down: 'D-pad down',
  left: 'D-pad left',
  right: 'D-pad right',
};

/** The short name of a button on the controller the game sees ("A", or "Cross" on a DualShock 4). */
export const shortLabel = (name: ButtonName | 'lt' | 'rt', kind: VirtualPadKind): string => {
  const xbox = name === 'lt' ? 'LT' : name === 'rt' ? 'RT' : SHORT[name];
  return kind === 'ds4' ? (DS4_LABELS[name] ?? xbox) : xbox;
};

const percent = (value: number): number => Math.round(Math.abs(value) * 100);

function stickWords(x: number, y: number): string {
  const words: string[] = [];
  if (percent(x) > 0) words.push(`${percent(x)}% ${x > 0 ? 'right' : 'left'}`);
  if (percent(y) > 0) words.push(`${percent(y)}% ${y > 0 ? 'up' : 'down'}`);
  return words.length > 0 ? words.join(', ') : 'centred';
}

/** The picture's content for a report; no report yet reads as a controller at rest. */
export function padView(report: PadReport | undefined, kind: VirtualPadKind): PadView {
  const r = report ?? NEUTRAL_PAD_REPORT;
  const pressed = BUTTON_NAMES.filter((name) => (r.buttons & BUTTON_BITS[name]) !== 0);
  const valueLines = [
    `${shortLabel('lt', kind)} ${percent(r.lt)}% · ${shortLabel('rt', kind)} ${percent(r.rt)}%`,
    `Left stick: ${stickWords(r.lx, r.ly)}`,
    `Right stick: ${stickWords(r.rx, r.ry)}`,
  ];
  return {
    left: { x: r.lx, y: r.ly },
    right: { x: r.rx, y: r.ry },
    lt: r.lt,
    rt: r.rt,
    pressed,
    valueLines,
    valuesText: valueLines.join(' · '),
    pressedText:
      pressed.length > 0
        ? `Pressed: ${pressed.map((name) => shortLabel(name, kind)).join(', ')}`
        : 'Nothing pressed',
  };
}
