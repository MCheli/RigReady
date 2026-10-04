import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportReportView } from '../../src/features/sharing/contract';
import { wiredApp, type WiredApp } from '../helpers';

/**
 * SHARE-006: before anything is imported, a shared setup is compared with the PC it is
 * opened on. The setup is the F/A-18C one made on the owner's flight rig (mark-full in the
 * flying state); it is opened on a PC that is not his (generic-rig, with and without DCS)
 * and on his own rig set up for racing (mark-racing, with and without the TV).
 */

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario: string, files?: string[]): Promise<WiredApp> {
  const app = await wiredApp(scenario, files ? { files } : {});
  apps.push(app);
  return app;
}

/** The F/A-18C setup of the flight rig, shared as a .rigready file with the default choices. */
async function sharedHornet(): Promise<string> {
  const owner = await start('flying-all-good', [
    'Saved Games/DCS/**',
    'Program Files (x86)/Steam/**',
  ]);
  owner.ports.dialogs.script.save.push('Documents/F-A-18C.rigready');
  const result = await owner.invoke<{ path: string }>('sharing:export', {
    profileId: 'dcs-f-a-18c',
    includeItems: [],
    decisions: {},
    notes: 'The Hornet setup',
    reviewed: true,
  });
  return result.path;
}

async function open(app: WiredApp, file: string): Promise<ImportReportView['compatibility']> {
  const dir = path.join(app.home, 'Downloads');
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(file, path.join(dir, 'F-A-18C.rigready'));
  app.ports.dialogs.script.open.push(['Downloads/F-A-18C.rigready']);
  const before = await app.invoke<unknown[]>('profiles:list');
  const report = await app.invoke<ImportReportView>('sharing:openImport');
  expect(report.name).toBe('DCS F/A-18C');
  // A report only: nothing was written and no setup was added.
  expect(await app.invoke('profiles:list')).toEqual(before);
  expect(await app.invoke<{ groups: unknown[] }>('safety:journal')).toMatchObject({ groups: [] });
  return report.compatibility;
}

const dcs = (c: ImportReportView['compatibility']) => c.software.find((s) => s.kind === 'game')!;
const winwing = (c: ImportReportView['compatibility']) =>
  c.devices.filter((d) => d.vendorId === '4098');

describe('compatibility report on import', () => {
  it('on the rig it was made on, everything it needs is there', async () => {
    const file = await sharedHornet();
    const same = await start('flying-all-good', ['Saved Games/DCS/**', 'Program Files (x86)/**']);
    const report = await open(same, file);
    expect(report.devices.length).toBeGreaterThan(8);
    expect(report.devices.filter((d) => !d.present)).toEqual([]);
    expect(report.software.filter((s) => !s.found)).toEqual([]);
    expect(dcs(report)).toMatchObject({ name: 'DCS World', detail: 'Installed (steam)' });
    expect(report.displays).toMatchObject({ needed: 4, here: 5 });
  });

  it('generic-rig: every device of the flight rig is missing, DCS and the helper apps are not found, one monitor for four', async () => {
    const file = await sharedHornet();
    const generic = await start('generic-fresh');
    const report = await open(generic, file);
    expect(winwing(report).length).toBeGreaterThan(5);
    // Matched by vendor and product id: nothing on this PC is any of them.
    expect(report.devices.filter((d) => d.present)).toEqual([]);
    expect(report.devices.every((d) => /^[0-9A-F]{4}$/.test(d.vendorId + '') && d.name)).toBe(true);
    expect(dcs(report)).toMatchObject({
      name: 'DCS World',
      required: true,
      found: false,
      detail: 'Not installed on this PC',
    });
    const apps = report.software.filter((s) => s.kind === 'app');
    expect(apps.length).toBeGreaterThan(0);
    expect(apps.filter((s) => s.found)).toEqual([]);
    expect(apps.every((s) => s.detail === 'Not found on this PC')).toBe(true);
    expect(report.displays).toMatchObject({ needed: 4, here: 1 });
    expect(report.displays!.summary).toContain('4 monitors');
  });

  it('generic-rig with DCS installed: the WinWing devices are missing and DCS is found', async () => {
    const file = await sharedHornet();
    const generic = await start('generic-dcs');
    const report = await open(generic, file);
    expect(winwing(report).length).toBeGreaterThan(5);
    expect(winwing(report).filter((d) => d.present)).toEqual([]);
    expect(report.devices.filter((d) => d.present)).toEqual([]);
    // Found, and the report says it is another edition than the setup was made with.
    expect(dcs(report)).toMatchObject({
      found: true,
      detail: 'Installed (standalone; the setup was made with the steam version)',
    });
    expect(report.software.filter((s) => s.kind === 'app' && s.found)).toEqual([]);
    expect(report.displays).toMatchObject({ needed: 4, here: 1 });
  });

  it.each([
    { scenario: 'mark-racing', monitors: 2 },
    { scenario: 'mark-racing-tv', monitors: 3 },
  ])(
    '$scenario: the flight gear is missing, what stayed on the rig is found, $monitors monitors for four',
    async ({ scenario, monitors }) => {
      const file = await sharedHornet();
      const racing = await start(scenario, [
        'Saved Games/DCS/**',
        'Program Files (x86)/**',
        'Program Files/**',
        'AppData/Local/Programs/**',
      ]);
      const report = await open(racing, file);
      const missing = report.devices.filter((d) => !d.present);
      expect(winwing(report).every((d) => !d.present)).toBe(true);
      expect(missing.map((d) => d.name)).toEqual(
        expect.arrayContaining(['T-Pendular-Rudder', 'TrackIR 5'])
      );
      // The Stream Deck was not flight gear: still there.
      expect(report.devices.filter((d) => d.present).map((d) => d.vendorId)).toEqual(['0FD9']);
      expect(dcs(report)).toMatchObject({ found: true, detail: 'Installed (steam)' });
      // TrackIR and SimAppPro are closed on the racing rig but installed.
      const apps = report.software.filter((s) => s.kind === 'app');
      expect(apps.filter((s) => !s.found)).toEqual([]);
      expect(apps.find((s) => /trackir/i.test(s.name))!.detail).toBe('Installed');
      expect(report.displays).toMatchObject({ needed: 4, here: monitors });
    }
  );
});
