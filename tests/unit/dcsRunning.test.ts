/**
 * One definition of "DCS is running" (core gameRunning, fed by the DCS module's `processes`),
 * shared by dcs-setup, dcs-bindings and the kneeboard export. DCS_mt.exe, the multithreaded
 * build, counts as much as DCS.exe, and the three features refuse alike: before this they
 * each had a pattern of their own, and the kneeboard had none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../helpers';

const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];
const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

/** What each feature says about DCS right now. */
async function seen(
  a: WiredApp
): Promise<{ setup: boolean; bindings: boolean; kneeboard: boolean }> {
  const setup = await a.invoke<{ dcsRunning: boolean }>('dcs-setup:overview');
  const bindings = await a.invoke<{ dcsRunning: boolean }>('dcs-bindings:overview');
  const kneeboard = await a.invoke<{ blocked?: string }>('cheat-sheets:kneeboardStatus', HORNET);
  return {
    setup: setup.dcsRunning,
    bindings: bindings.dcsRunning,
    kneeboard: kneeboard.blocked !== undefined,
  };
}

describe('a running DCS', () => {
  it('one definition of a running DCS: DCS.exe and DCS_mt.exe stop dcs-setup, dcs-bindings and the kneeboard alike', async () => {
    app = await wiredApp('cheat-sheets-hornet', { files: FILES });
    expect(app.wiring.context.games.get('dcs')?.processes).toEqual(['DCS.exe', 'DCS_mt.exe']);
    expect(await seen(app)).toEqual({ setup: false, bindings: false, kneeboard: false });
    for (const name of ['DCS.exe', 'DCS_mt.exe', 'dcs_MT.exe']) {
      await mutate(app, [{ op: 'startProcess', name, path: `C:\\DCS\\bin\\${name}` }]);
      expect(await seen(app), name).toEqual({ setup: true, bindings: true, kneeboard: true });
      await expect(
        app.invoke('cheat-sheets:exportKneeboard', { ...HORNET, options: {} })
      ).rejects.toThrow(/dcs\.running/);
      await mutate(app, [{ op: 'stopProcess', name }]);
    }
    expect(await seen(app)).toEqual({ setup: false, bindings: false, kneeboard: false });
  });
});
