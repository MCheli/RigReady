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
