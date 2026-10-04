import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readZip } from '../../src/core/files/zip';
import type {
  BackupOutcomeView,
  RestorePreviewView,
  RestoreReportView,
  Suggestion,
} from '../../src/features/backup/contract';
import type { ExportState, SimAppProState } from '../../src/features/dcs-setup/contract';
import { diffFile, HORNET, joystickDir } from '../dcsBindings';
import { wiredApp, type WiredApp } from '../helpers';

/**
 * SAP-002: export scripts and binding backup without SimAppPro.
 *
 * The scenario is the owner's flying rig with SimAppPro gone: no uninstall entry, no program
 * folder, no %APPDATA%\SimAppPro (so neither its MFD plan nor its account file exists), not
 * running. The WinWing devices are connected and Saved Games\DCS is as recorded. Everything
 * below goes through IPC, as the pages do. That the flows work at all on this rig is the proof
 * that none of them needs a file, a format or an account of SimAppPro's; the last test also
 * watches every file read to say so directly.
 */

const SCENARIO = 'dcs-setup-no-simapppro';
const WWT =
  "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n";
const BIOS = 'dofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\n';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const dcsUser = (target: WiredApp, ...parts: string[]): string =>
  path.join(target.home, 'Saved Games', 'DCS', ...parts);

const wwtTool = async (target: WiredApp): Promise<ExportState['tools'][number]> =>
  (await target.invoke<ExportState>('dcs-setup:exportLua')).tools.find((t) => t.tool === 'wwt')!;

describe('SAP-002 without SimAppPro installed', () => {
  it('the rig really has no SimAppPro: not installed, not running, none of its folders', async () => {
    app = await wiredApp(SCENARIO);
    expect(await app.invoke<SimAppProState>('dcs-setup:simAppPro')).toMatchObject({
      installed: false,
      running: false,
      planFound: false,
    });
    await expect(fs.access(path.join(app.ports.folders.appData(), 'SimAppPro'))).rejects.toThrow();
    await expect(
      fs.access(path.join(app.ports.folders.localAppData(), 'Programs', 'SimAppPro'))
    ).rejects.toThrow();
    const processes = await app.ports.processes.list();
    expect(processes.ok && processes.value.some((p) => /simapppro/i.test(p.name))).toBe(false);
    // The WinWing hardware is there.
    const devices = await app.ports.devices.list();
    expect(devices.ok && devices.value.filter((d) => d.vendorId === '4098').length).toBeGreaterThan(
      5
    );
  });

  it('manages the WinWing (wwt) lines of Export.lua: preview, remove, add, dedupe, with backup', async () => {
    app = await wiredApp(SCENARIO);
    const file = dcsUser(app, 'Scripts', 'Export.lua');
    const original = await fs.readFile(file, 'utf8');
    expect(original).toBe(`${WWT}\r\n${BIOS}`);
    expect(await wwtTool(app)).toMatchObject({ active: 1, installed: true });

    // Remove: the preview names exactly the two WinWing lines, and writes nothing.
    const preview = await app.invoke<{
      diff: { kind: string; text: string }[];
      changed: boolean;
    }>('dcs-setup:previewExport', { kind: 'remove', tool: 'wwt' });
    expect(preview.changed).toBe(true);
    expect(preview.diff.filter((d) => d.kind !== 'same')).toEqual([
      expect.objectContaining({ kind: 'removed', text: "local wwtlfs=require('lfs')" }),
      expect.objectContaining({
        kind: 'removed',
        text: "dofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')",
      }),
    ]);
    expect(await fs.readFile(file, 'utf8')).toBe(original);

    await app.invoke('dcs-setup:applyExport', { kind: 'remove', tool: 'wwt' });
    // Every other byte is as it was, the DCS-BIOS line with its own line ending included.
    expect(await fs.readFile(file, 'utf8')).toBe(`\r\n${BIOS}`);
    expect(await wwtTool(app)).toMatchObject({ active: 0, installed: true });
    const journal = await app.ports.files.journal();
    if (!journal.ok) throw new Error(journal.error.message);
    expect(journal.value).toHaveLength(1);
    expect(journal.value[0]).toMatchObject({
      path: file,
      reason: 'Export.lua: Remove WinWing (SimAppPro)',
    });
    expect(await fs.readFile(journal.value[0]!.backupPath!, 'utf8')).toBe(original);

    // Add: the canonical lines SimAppPro itself would write, after what is there.
    await app.invoke('dcs-setup:applyExport', { kind: 'add', tool: 'wwt' });
    expect(await fs.readFile(file, 'utf8')).toBe(`\r\n${BIOS}${WWT}`);
    expect(await wwtTool(app)).toMatchObject({ active: 1 });

    // Duplicates (two programs each added the line) are found and reduced to the first.
    await fs.writeFile(file, `${WWT}${BIOS}${WWT}`);
    expect(await wwtTool(app)).toMatchObject({ active: 2 });
    await app.invoke('dcs-setup:applyExport', { kind: 'dedupe', tool: 'wwt' });
    expect(await fs.readFile(file, 'utf8')).toBe(`${WWT}${BIOS}`);
    expect(await wwtTool(app)).toMatchObject({ active: 1 });
  });

  it('with the wwt scripts gone too, a stale line can be removed and adding it is refused with the reason', async () => {
    app = await wiredApp(SCENARIO);
    const file = dcsUser(app, 'Scripts', 'Export.lua');
    await fs.rm(dcsUser(app, 'Scripts', 'wwt'), { recursive: true });
    expect(await wwtTool(app)).toMatchObject({ active: 1, installed: false });
    await app.invoke('dcs-setup:applyExport', { kind: 'remove', tool: 'wwt' });
    expect(await fs.readFile(file, 'utf8')).toBe(`\r\n${BIOS}`);
    await expect(app.invoke('dcs-setup:applyExport', { kind: 'add', tool: 'wwt' })).rejects.toThrow(
      'WinWing (SimAppPro) is not installed: Scripts/wwt/wwtExport.lua is not in'
    );
    expect(await fs.readFile(file, 'utf8')).toBe(`\r\n${BIOS}`);
  });

  it('snapshots the WinWing bindings and restores them (BIND-DCS-020/021)', async () => {
    app = await wiredApp(SCENARIO);
    const ufc = await diffFile(app.home, 'WINWING UFC1');
    const mfd = await diffFile(app.home, 'WINWING MFD1-L');
    const before = {
      ufc: await fs.readFile(ufc, 'utf8'),
      mfd: await fs.readFile(mfd, 'utf8'),
      names: (await fs.readdir(joystickDir(app.home))).sort(),
    };
    const snapshot = await app.invoke<{
      id: string;
      files: number;
      devices: { name: string; guid: string }[];
    }>('dcs-bindings:snapshotCreate', { name: 'WinWing as flown', aircraft: [HORNET] });
    expect(snapshot.files).toBe(before.names.length);
    expect(snapshot.devices.filter((d) => d.name.startsWith('WINWING')).length).toBe(9);

    // One file lost, one rewritten.
    await fs.rm(ufc);
    await fs.writeFile(mfd, 'local diff = {}\nreturn diff\n');
    const plan = await app.invoke<{ files: { action: string }[] }>(
      'dcs-bindings:snapshotRestorePlan',
      { id: snapshot.id }
    );
    expect(plan.files.map((f) => f.action).sort()).toEqual(['change', 'create']);
    await app.invoke('dcs-bindings:snapshotRestore', { id: snapshot.id });
    expect(await fs.readFile(ufc, 'utf8')).toBe(before.ufc);
    expect(await fs.readFile(mfd, 'utf8')).toBe(before.mfd);
    expect((await fs.readdir(joystickDir(app.home))).sort()).toEqual(before.names);
  });

  it('a full backup holds the WinWing bindings and export scripts and restores them, reading nothing of SimAppPro', async () => {
    app = await wiredApp(SCENARIO);
    // Every file read from here on, to say directly what the flows above imply.
    const read: string[] = [];
    const { files } = app.ports;
    const readText = files.readText.bind(files);
    const readBytes = files.readBytes.bind(files);
    files.readText = (file) => (read.push(file), readText(file));
    files.readBytes = (file) => (read.push(file), readBytes(file));

    // What the Backups page offers for DCS, added as the user would with one click each.
    const suggestions = await app.invoke<Suggestion[]>('backup:suggestions');
    expect(suggestions.some((s) => /simapppro/i.test(s.path))).toBe(false);
    for (const label of ['DCS bindings', 'DCS export scripts']) {
      const s = suggestions.find((x) => x.label === label)!;
      await app.invoke('backup:saveItem', {
        scope: '@always',
        item: { label: s.label, path: s.path, kind: s.kind, game: s.game },
      });
    }
    const outcome = await app.invoke<BackupOutcomeView>('backup:backUp', {
      scope: { kind: 'full' },
    });
    const zip = readZip(
      new Uint8Array(
        await fs.readFile(path.join(app.ports.folders.dataRoot(), 'backups', outcome.backup.id))
      )
    );
    if (!zip.ok) throw new Error(zip.error.message);
    const names = zip.value.map((e) => e.path);
    expect(
      names.filter((n) => /\/FA-18C_hornet\/joystick\/WINWING .*\.diff\.lua$/.test(n)).length
    ).toBe(9);
    expect(names.some((n) => n.endsWith('Export.lua'))).toBe(true);
    expect(names.some((n) => n.endsWith('wwt/wwtExport.lua'))).toBe(true);
    expect(names.some((n) => n.endsWith('wwt/wwtNetwork.lua'))).toBe(true);
    expect(names.some((n) => /simapppro/i.test(n))).toBe(false);

    // Lose the WinWing export scripts and a binding file, then restore the backup.
    const ufc = await diffFile(app.home, 'WINWING UFC1');
    const ufcBefore = await fs.readFile(ufc, 'utf8');
    const wwtExport = dcsUser(app, 'Scripts', 'wwt', 'wwtExport.lua');
    const wwtBefore = await fs.readFile(wwtExport, 'utf8');
    await fs.rm(ufc);
    await fs.rm(dcsUser(app, 'Scripts', 'wwt'), { recursive: true });
    const preview = await app.invoke<RestorePreviewView>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    const missing = preview.items.flatMap((i) => i.files).filter((f) => f.status === 'new');
    expect(missing.map((f) => path.basename(f.target)).sort()).toEqual(
      [path.basename(ufc), 'wwtExport.lua', 'wwtNetwork.lua'].sort()
    );
    const report = await app.invoke<RestoreReportView>('backup:restore', {
      id: outcome.backup.id,
      choices: Object.fromEntries(missing.map((f) => [f.ref, 'overwrite'])),
    });
    expect(report.failed).toEqual([]);
    expect(report.restored).toHaveLength(3);
    expect(await fs.readFile(ufc, 'utf8')).toBe(ufcBefore);
    expect(await fs.readFile(wwtExport, 'utf8')).toBe(wwtBefore);
    // Export.lua can load the WinWing script again.
    expect(await wwtTool(app)).toMatchObject({ active: 1, installed: true });

    // And the other pages that speak of SimAppPro answer without it.
    await app.invoke('dcs-setup:overview');
    await app.invoke('dcs-bindings:overview');
    await app.invoke('backup:overview');
    expect(read.length).toBeGreaterThan(50);
    expect(read.filter((file) => /[\\/]SimAppPro[\\/]/i.test(file))).toEqual([]);
  });
});
