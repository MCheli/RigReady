import { dcsGuidText } from '../../../core/directInput';

/**
 * Names DCS uses for devices and inputs, and the plain-language labels RigReady shows
 * for them. See docs/research/dcs.md 1.2 and 1.4.
 */

export const DEVICE_TYPES = ['joystick', 'keyboard', 'mouse', 'trackir', 'headtracker'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface DiffFileName {
  /** DirectInput product name, byte for byte (trailing spaces included). */
  deviceName: string;
  /** Instance GUID as written in the file name; absent for Keyboard, Mouse and template diffs. */
  guid?: string;
  /** What DCS calls the full id: "<name> {GUID}", or just the name. */
  fullId: string;
}

const DIFF_SUFFIX = '.diff.lua';
const GUID_TAIL =
  /^(.*) \{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}$/;

/** Splits "<Device Name> {GUID}.diff.lua". Undefined when it is not a diff file name. */
export function parseDiffFileName(fileName: string): DiffFileName | undefined {
  if (!fileName.toLowerCase().endsWith(DIFF_SUFFIX)) return undefined;
  const fullId = fileName.slice(0, -DIFF_SUFFIX.length);
  if (fullId === '') return undefined;
  return splitFullId(fullId);
}

/** Splits a full id ("WINWING ICP {806D...}") into name and GUID. The GUID is the last braces group. */
export function splitFullId(fullId: string): DiffFileName {
  const match = GUID_TAIL.exec(fullId);
  if (!match) return { deviceName: fullId, fullId };
  return { deviceName: match[1]!, guid: match[2]!, fullId };
}

/** "<name> {GUID}" with the GUID in DCS's casing (third group lower case). */
export function fullIdFor(deviceName: string, guid: string | undefined): string {
  return guid ? `${deviceName} {${dcsGuidText(guid)}}` : deviceName;
}

export function diffFileNameFor(deviceName: string, guid: string | undefined): string {
  return `${fullIdFor(deviceName, guid)}${DIFF_SUFFIX}`;
}

const HAT_DIRECTIONS: Record<string, string> = {
  U: 'up',
  D: 'down',
  L: 'left',
  R: 'right',
  UR: 'up-right',
  UL: 'up-left',
  DR: 'down-right',
  DL: 'down-left',
};

const AXIS_LABELS: Record<string, string> = {
  JOY_X: 'X axis',
  JOY_Y: 'Y axis',
  JOY_Z: 'Z axis',
  JOY_RX: 'RX axis',
  JOY_RY: 'RY axis',
  JOY_RZ: 'RZ axis',
  JOY_SLIDER1: 'Slider 1',
  JOY_SLIDER2: 'Slider 2',
};

const AXIS_ORDER = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'];

export type InputKind = 'button' | 'hat' | 'axis' | 'key';

export interface InputInfo {
  kind: InputKind;
  /** "Button 5", "Hat 1 up", "X axis", or the key name for keyboards. */
  label: string;
  /** 1-based button or hat number. */
  number?: number;
  /** DirectInput axis name as InputDevice.axisNames has it: X, RZ, SLIDER1. */
  axis?: string;
}

/** What a DCS event name ("JOY_BTN5", "JOY_BTN_POV1_U", "JOY_RZ", "LShift") means. */
export function describeInput(key: string): InputInfo {
  const hat = /^JOY_BTN_POV(\d+)_([UDLR]{1,2})$/.exec(key);
  if (hat) {
    const number = Number(hat[1]);
    return { kind: 'hat', number, label: `Hat ${number} ${HAT_DIRECTIONS[hat[2]!] ?? hat[2]}` };
  }
  const button = /^JOY_BTN(\d+)(_OFF)?$/.exec(key);
  if (button) {
    const number = Number(button[1]);
    return {
      kind: 'button',
      number,
      label: button[2] ? `Button ${number} (on release)` : `Button ${number}`,
    };
  }
  const axis = /^JOY_([A-Z]+\d*)$/.exec(key);
  if (axis) {
    return { kind: 'axis', axis: axis[1]!, label: AXIS_LABELS[key] ?? `${axis[1]} axis` };
  }
  return { kind: 'key', label: key };
}

/** "LCtrl + LWin + Button 34". */
export function comboLabel(combo: { key: string; reformers?: string[] }): string {
  return [...(combo.reformers ?? []), describeInput(combo.key).label].join(' + ');
}

/** Sort order that puts Button 2 before Button 10 and axes first. */
export function inputSortKey(key: string): string {
  const info = describeInput(key);
  const rank = { axis: '0', button: '1', hat: '2', key: '3' }[info.kind];
  // Axes in DirectInput's own order (X, Y, Z, RX, ...), not alphabetically.
  const order = info.kind === 'axis' ? AXIS_ORDER.indexOf(info.axis ?? '') + 1 : (info.number ?? 0);
  return `${rank}${String(order).padStart(4, '0')}${key}`;
}

export interface DeviceCapabilities {
  numButtons: number;
  numHats: number;
  axisNames: string[];
}

/** False when the connected device has no such button, hat or axis: the binding can never fire. */
export function deviceHasInput(device: DeviceCapabilities, key: string): boolean {
  const info = describeInput(key);
  if (info.kind === 'button') return (info.number ?? 0) <= device.numButtons;
  if (info.kind === 'hat') return (info.number ?? 0) <= device.numHats;
  if (info.kind === 'axis') {
    return device.axisNames.some((name) => name.toUpperCase() === info.axis);
  }
  return true;
}

/** Every input a device has, as DCS event names, in display order. */
export function deviceInputs(device: DeviceCapabilities): string[] {
  const keys: string[] = device.axisNames.map((name) => `JOY_${name.toUpperCase()}`);
  for (let n = 1; n <= device.numButtons; n++) keys.push(`JOY_BTN${n}`);
  for (let hat = 1; hat <= device.numHats; hat++) {
    for (const direction of ['U', 'R', 'D', 'L', 'UR', 'DR', 'DL', 'UL']) {
      keys.push(`JOY_BTN_POV${hat}_${direction}`);
    }
  }
  return keys;
}
