import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, scenarioRig, type TestRig } from '../../../../tests/helpers';
import { GameRegistry } from '../../../core/games';
import { allPathVariables } from '../../../core/pathVariables';
import { findPrograms, iconPath } from './programs';

/**
 * The program finder on the recorded rig's files (SimAppPro under LocalAppData\Programs,
 * TrackIR under Program Files (x86), Stream Deck under Program Files) plus a few written
 * here: SRS in a folder of its own, a tool known only by its uninstall entry.
 */

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

async function write(home: string, file: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(home, file)), { recursive: true });
  await fs.writeFile(path.join(home, file), '');
}

async function find(names: string[]) {
  const variables = await allPathVariables(rig!.ctx, new GameRegistry());
  const found = await findPrograms(rig!.ports, variables, { names });
  if (!found.ok) throw new Error(found.error.message);
  return found.value;
}

describe('ASSIST-004 finding where helper programs are installed', () => {
  it('finds SimAppPro, TrackIR and Stream Deck with path variables applied, and says what it did not find', async () => {
    rig = await scenarioRig('flying-all-good');
    const found = await find(['SimAppPro', 'TrackIR', 'Stream Deck', 'Nothing Like This']);
    const paths = found.programs.filter((p) => p.likely).map((p) => p.path);
    expect(paths).toContain('{LOCALAPPDATA}/Programs/SimAppPro/SimAppPro.exe');
    expect(paths).toContain('{PROGRAM_FILES_X86}/TrackIR5/TrackIR5.exe');
    expect(paths).toContain('{PROGRAM_FILES}/Elgato/StreamDeck/StreamDeck.exe');
    // Not the program itself: the crash handler that ships beside it.
    expect(found.programs.some((p) => /crashpad/i.test(p.exe))).toBe(false);
    expect(found.notFound).toEqual(['Nothing Like This']);
    // Nothing names the user's folder.
    expect(JSON.stringify(found)).not.toContain(rig.home);
  });

  it('knows the folder names the usual names hide (SRS, Pit House), and the uninstall entries', async () => {
    rig = await scenarioRig('flying-all-good');
    await write(rig.home, 'Program Files/DCS-SimpleRadio-Standalone/SR-ClientRadio.exe');
    await write(rig.home, 'Program Files/DCS-SimpleRadio-Standalone/unins000.exe');
    await write(rig.home, 'Program Files (x86)/MOZA Pit House/MOZA Pit House.exe');
    await write(rig.home, 'Tools/Tacview/Tacview64.exe');
    const tools = path.join(rig.home, 'Tools', 'Tacview');
    await mutate(rig, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Tacview',
        name: 'DisplayName',
        value: { type: 'string', value: 'Tacview (64-bit)' },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Tacview',
        name: 'DisplayIcon',
        value: { type: 'string', value: `"${path.join(tools, 'Tacview64.exe')}",0` },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Tacview',
        name: 'Publisher',
        value: { type: 'string', value: 'Raia Software Inc.' },
      },
    ]);
    const found = await find(['SRS', 'Pit House', 'Tacview']);
    const byExe = new Map(found.programs.map((p) => [p.exe, p]));
    expect(byExe.get('SR-ClientRadio.exe')?.path).toBe(
      '{PROGRAM_FILES}/DCS-SimpleRadio-Standalone/SR-ClientRadio.exe'
    );
    expect(byExe.has('unins000.exe')).toBe(false);
    expect(byExe.get('MOZA Pit House.exe')?.path).toBe(
      '{PROGRAM_FILES_X86}/MOZA Pit House/MOZA Pit House.exe'
    );
    const tacview = byExe.get('Tacview64.exe')!;
    expect(tacview.where).toBe('Uninstall entry: Tacview (64-bit)');
    expect(tacview.publisher).toBe('Raia Software Inc.');
    // Below the user's folder, so stored with its variable.
    expect(tacview.path).toBe('{USER}/Tools/Tacview/Tacview64.exe');
    expect(found.notFound).toEqual([]);
  });

  it('reads the exe a DisplayIcon value names', () => {
    expect(iconPath('"C:\\Program Files\\X\\x.exe",0')).toBe('C:\\Program Files\\X\\x.exe');
    expect(iconPath('C:\\Program Files\\X\\x.exe')).toBe('C:\\Program Files\\X\\x.exe');
    expect(iconPath('C:\\Program Files\\X\\x.ico')).toBeUndefined();
    expect(iconPath('x.exe')).toBeUndefined();
  });
});
