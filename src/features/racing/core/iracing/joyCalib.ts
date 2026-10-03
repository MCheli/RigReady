import { err, ok, type Result } from '../../../../core/result';

/**
 * iRacing's calibration file, Documents\iRacing\joyCalib.yaml. It is written in one fixed
 * style (leading ---, trailing ..., one-space indent, single-quoted strings), so it is
 * read line by line and only ever changed by replacing a GUID's text in place.
 */

export interface CalibratedAxis {
  axis: number;
  name: string;
  min?: number;
  center?: number;
  max?: number;
}

export interface CalibratedDevice {
  name: string;
  /** Upper case, without braces. */
  instanceGuid: string;
  productGuid: string;
  axes: CalibratedAxis[];
}

const unquote = (v: string): string =>
  v
    .trim()
    .replace(/^'(.*)'$/, '$1')
    .replace(/''/g, "'");
const guid = (v: string): string => unquote(v).replace(/[{}]/g, '').toUpperCase();

export function parseJoyCalib(text: string): Result<CalibratedDevice[]> {
  if (!/CalibrationInfo:/.test(text)) {
    return err('iracing.calibration', 'joyCalib.yaml has no CalibrationInfo section.');
  }
  const devices: CalibratedDevice[] = [];
  let device: CalibratedDevice | undefined;
  let axis: CalibratedAxis | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^(?:-\s+)?([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match as unknown as [string, string, string];
    switch (key) {
      case 'DeviceName':
        device = { name: unquote(value), instanceGuid: '', productGuid: '', axes: [] };
        devices.push(device);
        axis = undefined;
        break;
      case 'InstanceGUID':
        if (device) device.instanceGuid = guid(value);
        break;
      case 'ProductGUID':
        if (device) device.productGuid = guid(value);
        break;
      case 'Axis':
        if (device) {
          axis = { axis: Number.parseInt(value, 10), name: '' };
          device.axes.push(axis);
        }
        break;
      case 'AxisName':
        if (axis) axis.name = unquote(value);
        break;
      case 'CalibMin':
      case 'CalibCenter':
      case 'CalibMax':
        if (axis) {
          const field = key === 'CalibMin' ? 'min' : key === 'CalibMax' ? 'max' : 'center';
          axis[field] = Number.parseInt(value, 10);
        }
        break;
    }
  }
  return ok(devices);
}

/**
 * Replaces one instance GUID in the text (in iRacing's {UPPER-CASE} spelling), leaving
 * every other byte as it was. Returns how many places changed.
 */
export function replaceGuidText(
  text: string,
  from: string,
  to: string
): { text: string; count: number } {
  const clean = (g: string): string => g.replace(/[{}]/g, '').toUpperCase();
  const pattern = new RegExp(`\\{${clean(from).replace(/-/g, '\\-')}\\}`, 'gi');
  let count = 0;
  const out = text.replace(pattern, () => {
    count++;
    return `{${clean(to)}}`;
  });
  return { text: out, count };
}
