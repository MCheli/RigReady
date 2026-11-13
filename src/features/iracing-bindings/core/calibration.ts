/**
 * The names iRacing has for controllers and their axes, from its calibration file
 * (Documents\iRacing\joyCalib.yaml). controls.cfg names a device only by its GUIDs and an
 * axis only by a number; this file says "FANATEC Podium Wheel Base DD2" and "Wheel Axis".
 *
 * iRacing writes the file in one fixed style (one key per line, single-quoted text), so it
 * is read line by line. Anything that is not such a line is skipped: a file that cannot be
 * read gives no names, and the bindings are then shown by number.
 */

export interface CalibratedDevice {
  /** "FANATEC Podium Wheel Base DD2". */
  name: string;
  /** Upper case, without braces. */
  instanceGuid: string;
  /** iRacing's axis number on this device, and the name it shows for it. */
  axes: Map<number, string>;
}

const unquote = (value: string): string =>
  value
    .trim()
    .replace(/^'(.*)'$/, '$1')
    .replace(/''/g, "'");

export function readCalibration(text: string): CalibratedDevice[] {
  const devices: CalibratedDevice[] = [];
  let device: CalibratedDevice | undefined;
  let axis: number | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const match = /^(?:-\s+)?([A-Za-z]+):\s*(.*)$/.exec(raw.trim());
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!;
    if (key === 'DeviceName') {
      device = { name: unquote(value), instanceGuid: '', axes: new Map() };
      devices.push(device);
      axis = undefined;
    } else if (key === 'InstanceGUID' && device) {
      device.instanceGuid = unquote(value).replace(/[{}]/g, '').toUpperCase();
    } else if (key === 'Axis' && device) {
      const number = Number.parseInt(value, 10);
      axis = Number.isInteger(number) ? number : undefined;
    } else if (key === 'AxisName' && device && axis !== undefined) {
      const name = unquote(value);
      if (name) device.axes.set(axis, name);
    }
  }
  return devices.filter((d) => d.instanceGuid !== '');
}

const FANATEC_VENDOR = '0EB7';
/** USB product ids of Fanatec wheel bases (docs/research/racing.md 1.3). */
const FANATEC_BASES: ReadonlySet<string> = new Set([
  '0001',
  '0004',
  '0005',
  '0006',
  '0007',
  '0011',
  '0020',
  '0197',
  '0E03',
]);

/**
 * An axis name from joyCalib.yaml, as the page shows it. iRacing copies the names the
 * controller's driver gives. The Fanatec driver calls the Y axis of its bases "Combined
 * Pedals" whatever the pedal mode, but with the pedals separate the clutch is on it, and
 * Windows does not say which mode the base is in. So that one is shown as "Clutch or
 * combined pedals", the name the input tester and the Wheel page give the axis
 * (tests/unit/wheelAxisNames.test.ts holds the three together). Every other name is shown
 * as iRacing has it.
 */
export function shownAxisName(name: string, ids?: { vendorId: string; productId: string }): string {
  const fanatecBase =
    ids?.vendorId.toUpperCase() === FANATEC_VENDOR &&
    FANATEC_BASES.has(ids.productId.toUpperCase());
  return fanatecBase && name.trim().toLowerCase() === 'combined pedals'
    ? 'Clutch or combined pedals'
    : name;
}
