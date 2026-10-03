import { readDirectInputIdentities } from '../core/directInput';
import { nullLogger } from '../core/logger';
import { runLua } from '../core/lua/sandbox';
import { createWindowsPorts } from '../platform/windows';

/**
 * `RigReady.exe --diagnose <file>`: reads the real machine through every provider and
 * writes what it found as JSON. Changes nothing. Returns the process exit code.
 */
export async function runDiagnose(
  outFile: string,
  options: { projectRoot: string; resourcesPath?: string }
): Promise<number> {
  const report: Record<string, unknown> = { ok: false };
  const ports = createWindowsPorts({ log: nullLogger, ...options });
  try {
    const section = async (
      name: string,
      read: () => Promise<{ ok: boolean } & Record<string, unknown>>
    ): Promise<void> => {
      try {
        report[name] = await read();
      } catch (e) {
        report[name] = { ok: false, error: { code: 'diagnose.throw', message: String(e) } };
      }
    };
    await section('devices', () => ports.devices.list());
    await section('displays', () => ports.displays.read());
    await section('processes', () => ports.processes.list());
    await section('audio', () => ports.audio.read());
    await section('steamLibraries', () => ports.folders.steamLibraries());
    await section('services', () => ports.services.list());
    await section('directInputRegistry', () => readDirectInputIdentities(ports.registry));
    await section('input', async () => {
      const started = await ports.input.start();
      await ports.input.stop();
      return started;
    });
    // The Lua VM is bundled JavaScript; this proves it survived packaging.
    await section('lua', async () => runLua('return 6 * 7'));
    report['folders'] = {
      home: ports.folders.home(),
      savedGames: ports.folders.savedGames(),
      dataRoot: ports.folders.dataRoot(),
    };
    report['ok'] = ['devices', 'displays', 'processes', 'audio', 'input', 'services', 'lua'].every(
      (name) => (report[name] as { ok?: boolean } | undefined)?.ok === true
    );
  } catch (e) {
    report['error'] = String(e);
  }
  // Through FileStore like every other write: a file already at that path is backed up first.
  const written = await ports.files.write(outFile, JSON.stringify(report, null, 2), {
    reason: 'Diagnose report',
  });
  return written.ok && report['ok'] === true ? 0 : 1;
}
