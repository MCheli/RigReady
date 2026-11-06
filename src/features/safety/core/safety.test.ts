/**
 * BACKUP-012: Undo on the Safety page refuses while a game that holds the files is running,
 * the way a restore does (core runningPrograms, the same detection), and nothing is undone.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { SafetyView } from '../contract';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

describe('undo while a game runs', () => {
  it('refuses to undo files a running game holds, with the same words as a restore, and undoes them once it is closed', async () => {
    app = await wiredApp('flying-all-good', { files: ['Saved Games/DCS/Config/options.lua'] });
    const options = path.join(app.home, 'Saved Games', 'DCS', 'Config', 'options.lua');
    const original = await fs.readFile(options, 'utf8');
    const elsewhere = path.join(app.home, 'Documents', 'notes.txt');
    // Two changes RigReady made: one in DCS's folder, one that no game holds.
    await app.ports.files.write(options, 'changed by RigReady', { reason: 'Set up MFD screens' });
    await app.ports.files.write(elsewhere, 'a note', { reason: 'Write a note' });
    const before = await app.invoke<SafetyView>('safety:journal');
    const dcsChange = before.groups.find((g) => g.reason === 'Set up MFD screens')!;
    const noteChange = before.groups.find((g) => g.reason === 'Write a note')!;

    await mutate(app, [{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\DCS\\bin\\DCS.exe' }]);
    await expect(app.invoke('safety:undo', { groupId: dcsChange.id })).rejects.toThrow(
      /DCS World is running \(DCS\.exe\)\. DCS World may write its settings again when it exits, which would undo the restore\. Close it first\. Nothing was undone\./
    );
    expect(await fs.readFile(options, 'utf8')).toBe('changed by RigReady');
    const still = await app.invoke<SafetyView>('safety:journal');
    expect(still.groups.find((g) => g.id === dcsChange.id)?.undone).toBe(false);
    // Forcing past "changed since" is not a way past a running game either.
    await expect(app.invoke('safety:undo', { groupId: dcsChange.id, force: true })).rejects.toThrow(
      /DCS World is running/
    );
    // A file no game holds is undone all the same.
    const noteUndone = await app.invoke<SafetyView>('safety:undo', { groupId: noteChange.id });
    expect(noteUndone.groups.find((g) => g.id === noteChange.id)?.undone).toBe(true);
    expect(await fs.readFile(elsewhere, 'utf8').catch(() => 'gone')).toBe('gone');

    // The multithreaded build counts as DCS too.
    await mutate(app, [
      { op: 'stopProcess', name: 'DCS.exe' },
      { op: 'startProcess', name: 'DCS_mt.exe', path: 'C:\\DCS\\bin\\DCS_mt.exe' },
    ]);
    await expect(app.invoke('safety:undo', { groupId: dcsChange.id })).rejects.toThrow(
      /DCS World is running \(DCS_mt\.exe\)/
    );

    await mutate(app, [{ op: 'stopProcess', name: 'DCS_mt.exe' }]);
    const undone = await app.invoke<SafetyView>('safety:undo', { groupId: dcsChange.id });
    expect(undone.groups.find((g) => g.id === dcsChange.id)?.undone).toBe(true);
    expect(await fs.readFile(options, 'utf8')).toBe(original);
  });
});
