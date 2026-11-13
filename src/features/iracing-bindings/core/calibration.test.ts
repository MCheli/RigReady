import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../../../tests/helpers';
import { readCalibration } from './calibration';

const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';

describe('iRacing joyCalib.yaml', () => {
  it('reads the wheel base and its four axes from the recorded file', async () => {
    const text = await fs.readFile(
      path.join(fixturesDir, 'rigs', 'mark-full', 'files', 'Documents', 'iRacing', 'joyCalib.yaml'),
      'utf8'
    );
    const devices = readCalibration(text);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe('FANATEC Podium Wheel Base DD2');
    expect(devices[0]!.instanceGuid).toBe(WHEEL);
    expect([...devices[0]!.axes]).toEqual([
      [0, 'Combined Pedals'],
      [1, 'Brake'],
      [2, 'Accelerator'],
      [3, 'Wheel Axis'],
    ]);
  });

  it('reads several devices, and a quote inside a name', () => {
    const devices = readCalibration(
      [
        '---',
        'CalibrationInfo:',
        ' DeviceList:',
        " - DeviceName: 'Sam''s pedals'",
        "   InstanceGUID: '{aaaaaaaa-0000-0000-0000-000000000001}'",
        '   AxisList:',
        '   - Axis: 4',
        "     AxisName: 'Throttle'",
        '   - Axis: nonsense',
        "     AxisName: 'Lost'",
        '   - Axis: 5',
        "     AxisName: ''",
        " - DeviceName: 'Handbrake'",
        "   InstanceGUID: '{AAAAAAAA-0000-0000-0000-000000000002}'",
        '...',
      ].join('\n')
    );
    expect(devices.map((d) => d.name)).toEqual(["Sam's pedals", 'Handbrake']);
    expect(devices[0]!.instanceGuid).toBe('AAAAAAAA-0000-0000-0000-000000000001');
    // An axis without a number or without a name is left out.
    expect([...devices[0]!.axes]).toEqual([[4, 'Throttle']]);
    expect(devices[1]!.axes.size).toBe(0);
  });

  it('gives nothing for other content instead of guessing', () => {
    expect(readCalibration('')).toEqual([]);
    expect(readCalibration('{"json": true}')).toEqual([]);
    expect(readCalibration("InstanceGUID: '{AAAAAAAA-0000-0000-0000-000000000001}'")).toEqual([]);
    // A device without an id cannot be matched to a binding.
    expect(readCalibration(" - DeviceName: 'No id'\n   AxisList:\n")).toEqual([]);
    expect(readCalibration("   AxisName: 'Orphan'\n   - Axis: 1\n")).toEqual([]);
  });
});
