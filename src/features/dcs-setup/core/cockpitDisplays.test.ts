import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ScreensState } from '../contract';
import {
  aircraftNamedIn,
  builtInCatalog,
  scanViewportNames,
  sortViewports,
} from './cockpitDisplays';
import { displayLabel, humanizeViewport } from './screens';
import { aircraftCatalog } from './simAppProImport';

let app: WiredApp;
afterEach(() => app?.cleanup());

const FILES = ['Saved Games/DCS/**', 'Program Files (x86)/Steam/**'];

describe('exportable cockpit displays from the installed modules', () => {
  it('finds the viewport names a cockpit script asks for, without running it', () => {
    const script = [
      '-- try_find_assigned_viewport("COMMENTED_OUT")',
      '--[[ try_find_assigned_viewport("IN_A_BLOCK") ]]',
      'if disposition == "L" then',
      "\ttry_find_assigned_viewport('LEFT_MFCD')",
      'else',
      '\ttry_find_assigned_viewport( "RIGHT_MFCD" )',
      'end',
      'try_find_assigned_viewport("ABRIS","RIGHT_MFCD")',
      'local v = find_viewport("F14_JESTER_MENU") or find_viewport("GU_MAIN_VIEWPORT")',
      'try_find_assigned_viewport(name_built_at_run_time)',
      'try_find_assigned_viewport("LEFT_MFCD")',
    ].join('\n');
    expect(scanViewportNames(script)).toEqual([
      { name: 'LEFT_MFCD' },
      { name: 'RIGHT_MFCD' },
      { name: 'ABRIS', fallback: 'RIGHT_MFCD' },
      { name: 'F14_JESTER_MENU' },
    ]);
    expect(
      sortViewports(['UFC', 'RIGHT_MFCD', 'OUTER_LEFT_MFCD', 'LEFT_MFCD', 'CENTER_MFCD'])
    ).toEqual(['LEFT_MFCD', 'CENTER_MFCD', 'RIGHT_MFCD', 'OUTER_LEFT_MFCD', 'UFC']);
  });

  it('lists every installed aircraft with the displays its cockpit scripts name, built-in ones where they name none', async () => {
    app = await wiredApp('dcs-setup-module-displays', { files: FILES });
    const state = await app.invoke<ScreensState>('dcs-setup:screens');
    const displays = (unit: string): string[] | undefined =>
      state.catalog.find((c) => c.unit === unit)?.displays;
    // Read from the fixture copies of each module's script lines.
    expect(displays('FA-18C_hornet')).toEqual(['LEFT_MFCD', 'CENTER_MFCD', 'RIGHT_MFCD']);
    expect(displays('F-16C_50')).toEqual(['LEFT_MFCD', 'RIGHT_MFCD', 'EHSI']);
    expect(displays('A-10C_2')).toEqual(['LEFT_MFCD', 'RIGHT_MFCD']);
    expect(displays('F-15ESE')).toEqual([
      'LEFT_MFCD',
      'CENTER_MFCD',
      'RIGHT_MFCD',
      'OUTER_LEFT_MFCD',
      'OUTER_RIGHT_MFCD',
      'UFC',
    ]);
    const tomcat = [
      'F14_DDD',
      'F14_ECMD',
      'F14_HSD',
      'F14_JESTER_MENU',
      'F14_TID',
      'F14_UHF_ARC159',
      'F14_VDI',
      'F14_VHF_ARC182',
    ];
    // One module, four units: each flies with the same displays.
    for (const unit of ['F-14A-95-GR', 'F-14A-135-GR-Early', 'F-14A-135-GR', 'F-14B'])
      expect(displays(unit)).toEqual(tomcat);
    // RIGHT_MFCD and LEFT_MFCD are only the Ka-50's fallbacks for ABRIS and Shkval.
    expect(displays('Ka-50')).toEqual(['ABRIS', 'Shkval']);
    // Installed, but no script lines in the fixture: the built-in table.
    expect(displays('A-10C')).toEqual(['LEFT_MFCD', 'RIGHT_MFCD']);
    expect(displays('Ka-50_3')).toEqual(['ABRIS', 'Shkval']);
    // Installed without exportable displays, or not installed at all.
    for (const unit of ['UH-1H', 'P-51D', 'Su-27', 'AV8BNA', 'AH-64D_BLK_II'])
      expect(displays(unit)).toBeUndefined();
    expect(state.catalog.find((c) => c.unit === 'F-15ESE')!.label).toBe('F-15E Suite 4+');
    // The setup used last is "DCS F-16C".
    expect(state.aircraftInUse).toBe('F-16C_50');
  });

  it('falls back to the built-in table when no install is found, and leaves out SimAppPro aircraft not installed', () => {
    expect(aircraftCatalog().map((c) => c.unit)).toEqual(builtInCatalog().map((c) => c.unit));
    expect(builtInCatalog().map((c) => c.unit)).toEqual(
      expect.arrayContaining(['FA-18C_hornet', 'F-16C_50', 'A-10C_2', 'F-15ESE', 'F-14B', 'Ka-50'])
    );
    const fromPlan = [
      { unit: 'AV8BNA', label: 'AV-8B Harrier', displays: ['LEFT_MFCD', 'RIGHT_MFCD'] },
      { unit: 'M-2000C', label: 'Mirage 2000C', displays: ['RIGHT_MFCD'] },
    ];
    const installed = new Set(['M-2000C']);
    expect(aircraftCatalog(fromPlan, [], installed).map((c) => c.unit)).toEqual(['M-2000C']);
    expect(aircraftCatalog(fromPlan).map((c) => c.unit)).toEqual(
      expect.arrayContaining(['AV8BNA', 'M-2000C'])
    );
  });

  it('names displays for the editor and finds the aircraft a setup is named after', () => {
    expect(displayLabel('FA-18C_hornet', 'CENTER_MFCD')).toBe('AMPCD');
    expect(displayLabel('F-14B', 'F14_TID')).toBe('TID (RIO)');
    expect(displayLabel('Mi-24P', 'OUTER_LEFT_MFCD')).toBe('Outer left MFCD');
    expect(humanizeViewport('F14_TID')).toBe('TID');
    expect(humanizeViewport('Shkval')).toBe('Shkval');
    const catalog = [
      { unit: 'FA-18C_hornet', label: 'F/A-18C', displays: ['LEFT_MFCD'] },
      { unit: 'A-10C', label: 'A-10C Warthog', displays: ['LEFT_MFCD'] },
      { unit: 'A-10C_2', label: 'A-10C II Tank Killer', displays: ['LEFT_MFCD'] },
      { unit: 'F-16C_50', label: 'F-16C bl.50', displays: ['LEFT_MFCD'] },
    ];
    expect(aircraftNamedIn('DCS F/A-18C', catalog)).toBe('FA-18C_hornet');
    expect(aircraftNamedIn('DCS F-16C', catalog)).toBe('F-16C_50');
    expect(aircraftNamedIn('A-10C_2 night', catalog)).toBe('A-10C_2');
    expect(aircraftNamedIn('DCS UH-1H', catalog)).toBeUndefined();
  });
});
