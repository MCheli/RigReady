/**
 * Packaged smoke test (npm run smoke:packaged). Runs against release/win-unpacked,
 * the output of `electron-builder --dir`, to catch what only breaks once packaged:
 * native modules inside app.asar, and a missing Python sidecar.
 */
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, isolatedEnv, repoRoot, test } from '../e2e/harness';

const exe = path.join(repoRoot, 'release', 'win-unpacked', 'RigReady.exe');
const resources = path.join(repoRoot, 'release', 'win-unpacked', 'resources');

test.use({ executablePath: exe });

test('the package contains the native module outside the asar and the Python sidecar', async () => {
  expect(existsSync(exe), `${exe} - run "npm run pack" first`).toBe(true);
  expect(existsSync(path.join(resources, 'app.asar'))).toBe(true);
  const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules');
  expect(
    existsSync(path.join(unpacked, '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node'))
  ).toBe(true);
  expect(existsSync(path.join(resources, 'python', 'python.exe'))).toBe(true);
  expect(existsSync(path.join(resources, 'sidecar', 'input_server.py'))).toBe(true);
});

test('the packaged app enumerates the real machine: devices, displays, processes, audio, DirectInput', async () => {
  const isolated = await isolatedEnv();
  try {
    const out = path.join(isolated.root, 'diagnose.json');
    await promisify(execFile)(exe, ['--diagnose', out], { env: isolated.env, timeout: 60_000 });
    const report = JSON.parse(await fs.readFile(out, 'utf8'));
    expect(report.ok, JSON.stringify(report, null, 1).slice(0, 2000)).toBe(true);
    expect(report.devices.value.length).toBeGreaterThan(0);
    expect(report.displays.value.displays.length).toBeGreaterThan(0);
    expect(report.processes.value.length).toBeGreaterThan(0);
    expect(report.audio.ok).toBe(true);
    // The sidecar started from the bundled runtime, not from a Python on this PC.
    expect(report.input.ok).toBe(true);
    // The redirected profile is honored: nothing points at the real one.
    expect(report.folders.dataRoot).toBe(isolated.dataRoot);
    expect(report.folders.savedGames.startsWith(isolated.root)).toBe(true);
    console.log(
      `  packaged: ${report.devices.value.length} USB devices, ${report.displays.value.displays.length} displays, ` +
        `${report.input.value.length} DirectInput devices`
    );
  } finally {
    await isolated.cleanup();
  }
});

test('the packaged app runs a scenario: TrackIR not running, Make ready, Ready', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-trackir-not-running', 'packaged-smoke');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Started TrackIR5.exe');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('made-ready');
});
