import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupFileStore } from '../../src/core/files/fileStore';
import { unsupportedPlatformMessage } from '../../src/main/platformGuard';
import { NodeRawFs, systemClock } from '../../src/platform/node';
import { isProtectedInstallPath, refusedProgramFilesWrites } from '../guardProgramFiles';
import { repoRoot, scenarioRig, tempDir, type TestRig } from '../helpers';

/** RigReady never asks for administrator rights (PLAT-007) and only runs on Windows (PLAT-012). */

let rig: TestRig | undefined;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function filesBelow(dir: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesBelow(full, pattern)));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

const pkg = async (): Promise<{
  build: Record<string, unknown> & {
    win?: Record<string, unknown>;
    nsis?: Record<string, unknown>;
    mac?: unknown;
    linux?: unknown;
  };
}> => JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));

describe('no administrator rights', () => {
  it('nothing that ships asks Windows for elevation', async () => {
    // Every way a program asks for (or forces) a UAC prompt.
    const elevation = [
      /\brunas\b/i,
      /-Verb\s+RunAs/i,
      /requireAdministrator/i,
      /highestAvailable/i,
      /\belevate\.exe\b/i,
      /Start-Process[^\n]*-Verb/i,
      /ShellExecute[^\n]*runas/i,
      /\bsudo\b/i,
      /gsudo/i,
    ];
    const shipped = [
      ...(await filesBelow(path.join(repoRoot, 'src'), /\.(ts|vue|ps1|cmd|bat|html)$/)),
      ...(await filesBelow(path.join(repoRoot, 'python'), /\.py$/)),
      ...(await filesBelow(path.join(repoRoot, 'build'), /\.(nsh|nsi|yml)$/)),
    ].filter((file) => !/\.test\.ts$/.test(file) && !file.includes(`${path.sep}legacy${path.sep}`));
    expect(shipped.length).toBeGreaterThan(200);
    const offenders: string[] = [];
    for (const file of shipped) {
      const text = await fs.readFile(file, 'utf8');
      for (const pattern of elevation) {
        if (pattern.test(text)) offenders.push(`${path.relative(repoRoot, file)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the build asks for asInvoker, installs per user, and never offers a per-machine install', async () => {
    const { build } = await pkg();
    // electron-builder writes asInvoker into the program's manifest unless told otherwise.
    expect(build.win?.['requestedExecutionLevel'] ?? 'asInvoker').toBe('asInvoker');
    expect(build.nsis?.['perMachine']).toBe(false);
    expect(build.nsis?.['createStartMenuShortcut']).toBe(true);
    expect(build.nsis?.['deleteAppDataOnUninstall']).toBe(false);
    expect(build.nsis?.['include']).toBe('build/installer.nsh');
    const include = await fs.readFile(path.join(repoRoot, 'build', 'installer.nsh'), 'utf8');
    // The "for me / for everyone" page is skipped: everyone would need administrator rights.
    expect(include).toMatch(/!macro customInstallMode\s+StrCpy \$isForceCurrentInstall "1"/);
    expect(include).not.toMatch(/isForceMachineInstall "1"/);
  });

  it('the unit suite runs under a guard that fails any test in which a file below Program Files is changed', async () => {
    rig = await scenarioRig('flying-all-good', { files: [] });
    const { files, folders } = rig.ports;
    const before = refusedProgramFilesWrites().length;
    const inside = path.join(folders.programFiles(), 'Eagle Dynamics', 'DCS World', 'x.lua');
    await expect(files.write(inside, 'x', { reason: 'test' })).rejects.toThrow('Test guard');
    await expect(files.mkdir(path.dirname(inside))).rejects.toThrow('Test guard');
    await fs.writeFile(path.join(rig.home, 'a.txt'), 'x');
    await expect(
      files.copy(path.join(rig.home, 'a.txt'), inside, { reason: 'test' })
    ).rejects.toThrow('Test guard');
    expect(refusedProgramFilesWrites().length).toBeGreaterThanOrEqual(before + 3);
    await expect(fs.stat(inside)).rejects.toThrow();

    // A Steam library is writable for every user: Steam sets it up that way.
    expect(
      isProtectedInstallPath('C:\\Program Files (x86)\\Steam\\steamapps\\common\\X\\a.json')
    ).toBe(false);
    expect(
      isProtectedInstallPath('C:\\Program Files\\Eagle Dynamics\\DCS World\\Config\\a.lua')
    ).toBe(true);
    expect(isProtectedInstallPath('C:\\Users\\someone\\Saved Games\\DCS\\Config\\a.lua')).toBe(
      false
    );
  });

  it('a write Windows refuses is reported with the path and is not tried again another way', async () => {
    const dir = await tempDir();
    cleanups.push(dir.cleanup);
    let attempts = 0;
    class Refusing extends NodeRawFs {
      override async writeBytes(file: string): Promise<void> {
        attempts++;
        throw Object.assign(new Error(`EPERM: operation not permitted, open '${file}'`), {
          code: 'EPERM',
        });
      }
    }
    const store = new BackupFileStore(new Refusing(), path.join(dir.dir, 'data'), systemClock);
    const target = path.join(dir.dir, 'Protected', 'options.lua');
    const result = await store.write(target, 'x', { reason: 'Change an option' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('file.write');
    expect(!result.ok && result.error.message).toContain(target);
    expect(attempts).toBe(1);
  });
});

describe('Windows only', () => {
  it('on Windows there is nothing to say; anywhere else the app says why it cannot start', () => {
    expect(unsupportedPlatformMessage('win32')).toBeUndefined();
    expect(unsupportedPlatformMessage('darwin')).toBe(
      'RigReady only runs on Windows 10 and Windows 11. This computer runs macOS, so RigReady cannot start here.'
    );
    expect(unsupportedPlatformMessage('linux')).toContain('This computer runs Linux');
    expect(unsupportedPlatformMessage('freebsd')).toContain('This computer runs freebsd');
  });

  it('the app checks the platform before anything else starts, and only a Windows build is produced', async () => {
    const main = await fs.readFile(path.join(repoRoot, 'src', 'main', 'index.ts'), 'utf8');
    const guard = main.indexOf('unsupportedPlatformMessage(process.platform)');
    expect(guard).toBeGreaterThan(0);
    expect(main.indexOf('dialog.showErrorBox', guard)).toBeGreaterThan(guard);
    expect(main.indexOf('app.exit(1)', guard)).toBeLessThan(main.indexOf('whenReady()', guard));
    const { build } = await pkg();
    expect(build.win).toBeDefined();
    expect(build.mac).toBeUndefined();
    expect(build.linux).toBeUndefined();
  });
});
