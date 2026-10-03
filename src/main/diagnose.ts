import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nullLogger } from '../core/logger';
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
  try {
    const ports = createWindowsPorts({ log: nullLogger, ...options });
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
    await section('input', async () => {
      const started = await ports.input.start();
      await ports.input.stop();
      return started;
    });
    report['folders'] = {
      home: ports.folders.home(),
      savedGames: ports.folders.savedGames(),
      dataRoot: ports.folders.dataRoot(),
    };
    report['ok'] = ['devices', 'displays', 'processes', 'audio', 'input'].every(
      (name) => (report[name] as { ok?: boolean } | undefined)?.ok === true
    );
  } catch (e) {
    report['error'] = String(e);
  }
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(report, null, 2));
  return report['ok'] === true ? 0 : 1;
}
