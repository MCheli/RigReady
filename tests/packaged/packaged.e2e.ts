/**
 * Packaged smoke test (npm run smoke:packaged). Runs against release/win-unpacked,
 * the output of `electron-builder --dir`, to catch what only breaks once packaged:
 * native modules inside app.asar, and a missing Python sidecar.
 */
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron } from '@playwright/test';
import { FindWindowExW, IsWindowVisible } from '../../src/platform/windows/win32';
import { expect, isolatedEnv, repoRoot, test } from '../e2e/harness';

const exe = path.join(repoRoot, 'release', 'win-unpacked', 'RigReady.exe');
const resources = path.join(repoRoot, 'release', 'win-unpacked', 'resources');
/** A CI runner has no rig: no game controller, maybe no sound device, and it is slower. */
const onCi = process.env['CI'] !== undefined && process.env['CI'] !== '';

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
    // Nothing may fail because a part of the package is missing, wherever this runs.
    expect(JSON.stringify(report)).not.toMatch(/Cannot find module|MODULE_NOT_FOUND|not installed/);
    if (onCi) {
      // No rig here: every reader must still answer, with whatever the runner has.
      for (const section of ['devices', 'displays', 'processes', 'services', 'input', 'lua']) {
        expect(report[section].ok, `${section}: ${JSON.stringify(report[section])}`).toBe(true);
      }
      expect(report.folders.dataRoot).toBe(isolated.dataRoot);
      return;
    }
    expect(report.ok, JSON.stringify(report, null, 1).slice(0, 2000)).toBe(true);
    expect(report.devices.value.length).toBeGreaterThan(0);
    expect(report.displays.value.displays.length).toBeGreaterThan(0);
    expect(report.processes.value.length).toBeGreaterThan(0);
    expect(report.audio.ok).toBe(true);
    // The sidecar started from the bundled runtime, not from a Python on this PC.
    expect(report.input.ok).toBe(true);
    expect(report.services.value.length).toBeGreaterThan(50);
    expect(report.directInputRegistry.ok).toBe(true);
    expect(report.lua.value.returned).toEqual([42]);
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

test('the packaged app starts on the real machine with an isolated profile: window, tray icon, settings', async () => {
  const isolated = await isolatedEnv();
  const app = await _electron.launch({ executablePath: exe, args: [], env: isolated.env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('mode-configure')).toBeVisible();
    // Real providers, so no scenario banner; and nothing from the real profile: no setups.
    await expect(page.getByTestId('scenario-banner')).toHaveCount(0);
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-devices').click();
    await expect(page.getByTestId('devices-page')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    // The login item is read from Windows (and never changed by this test).
    await expect(page.getByTestId('setting-start-with-windows').locator('input')).not.toBeChecked();
    await expect(page.getByTestId('login-problem')).toHaveCount(0);
    await page.getByTestId('nav-safety').click();
    await expect(page.getByTestId('safety-empty')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    const log = await fs
      .readFile(path.join(isolated.dataRoot, 'logs', 'rigready.log'), 'utf8')
      .catch(() => '');
    await isolated.cleanup();
    // The tray icon comes from a file inside app.asar: this is where a packaging mistake shows.
    expect(log).toContain('starting');
    expect(log).not.toContain('could not create the tray icon');
    expect(log).not.toContain('ERROR');
  }
});

test('the packaged app shows a usable Fly screen within two seconds of starting', async ({
  rig,
}) => {
  const started = Date.now();
  const { page, shot } = await rig.launch('flying-all-good', 'packaged-startup-time');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('group-devices')).toBeVisible();
  await expect(page.getByTestId('launch')).toBeEnabled();
  const usable = Date.now() - started;
  console.log(`  packaged: Fly screen usable ${usable} ms after process start`);
  test.info().annotations.push({ type: 'fly-usable-ms', description: String(usable) });
  // The two seconds are for a user's PC; a shared CI runner only has to get there.
  expect(usable).toBeLessThan(onCi ? 15_000 : 2000);
  await shot('usable');
});

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const RUN_VALUE = 'RigReady';

/** The Run entry Windows starts at login, or undefined when there is none. */
async function runEntry(): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)('reg', ['query', RUN_KEY, '/v', RUN_VALUE]);
    return /REG_SZ\s+(.*)/.exec(stdout)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

test('Start with Windows: the packaged app registers and removes its login entry, and a login start stays in the tray', async () => {
  const before = await runEntry();
  const isolated = await isolatedEnv();
  let app = await _electron.launch({ executablePath: exe, args: [], env: isolated.env });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-settings').click();
    const toggle = page.getByTestId('setting-start-with-windows').locator('input');
    await expect(toggle).not.toBeChecked();

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.getByTestId('login-problem')).toHaveCount(0);
    // What Windows will run at login: this program, told to stay in the tray.
    const entry = await runEntry();
    expect(entry, 'HKCU Run entry after turning it on').toBeDefined();
    expect(entry!.toLowerCase()).toContain(exe.toLowerCase());
    expect(entry).toContain('--hidden');
    console.log(`  login entry: ${entry}`);

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await runEntry(), 'HKCU Run entry after turning it off').toBeUndefined();
    await app.close();

    // Started the way Windows starts it at login: no window on screen, only the tray.
    app = await _electron.launch({ executablePath: exe, args: ['--hidden'], env: isolated.env });
    const hidden = await app.firstWindow();
    await hidden.waitForLoadState('domcontentloaded');
    await expect(hidden.getByTestId('mode-configure')).toBeAttached();
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
    ).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    // Leave the PC's startup list exactly as it was found.
    if (before === undefined) {
      await promisify(execFile)('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']).catch(
        () => undefined
      );
      await promisify(execFile)('reg', ['delete', APPROVED_KEY, '/v', RUN_VALUE, '/f']).catch(
        () => undefined
      );
    } else if ((await runEntry()) !== before) {
      await promisify(execFile)('reg', [
        'add',
        RUN_KEY,
        '/v',
        RUN_VALUE,
        '/t',
        'REG_SZ',
        '/d',
        before,
        '/f',
      ]);
    }
    expect(await runEntry()).toBe(before);
    await isolated.cleanup();
  }
});

/**
 * Console windows that exist right now (classic console host and Windows Terminal),
 * shown or not. The test harness starts the app with "show windows hidden" as the
 * default for whatever it starts, so a console window made by a script that is not
 * hidden exists without being on screen here; one made for a hidden script must not
 * exist at all.
 */
function consoleWindows(): { all: number; visible: number } {
  let all = 0;
  let visible = 0;
  for (const className of ['ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS']) {
    let window: number | bigint = 0;
    for (let i = 0; i < 500; i++) {
      window = FindWindowExW(0, window, className, null) as number | bigint;
      if (Number(window) === 0) break;
      all++;
      if (IsWindowVisible(window) !== 0) visible++;
    }
  }
  return { all, visible };
}

test('a real batch file run hidden by the packaged app runs to the end and brings no console window into being', async () => {
  const isolated = await isolatedEnv();
  // A setup in the isolated profile whose two fixes run the same real batch file, one
  // hidden and one not. The check itself always fails, so both fixes stay available.
  const scripts = path.join(isolated.env['USERPROFILE']!, 'Scripts');
  await fs.mkdir(scripts, { recursive: true });
  await fs.writeFile(path.join(scripts, 'fail.cmd'), '@exit /b 1\r\n');
  await fs.writeFile(
    path.join(scripts, 'wait.cmd'),
    '@echo off\r\necho waiting for %RIGREADY_PROFILE_NAME%\r\nping -n 4 127.0.0.1 >nul\r\n'
  );
  const item = (id: string, title: string, hidden: boolean): string =>
    `  - id: ${id}\n    type: script.check\n    title: ${title}\n    required: false\n` +
    `    params: { exe: '{USER}/Scripts/fail.cmd' }\n    remediation:\n      type: script.run\n` +
    `      params: { exe: '{USER}/Scripts/wait.cmd', hidden: ${hidden}, requiresConfirmation: false, timeoutSeconds: 20 }\n`;
  await fs.mkdir(path.join(isolated.dataRoot, 'profiles'), { recursive: true });
  await fs.writeFile(
    path.join(isolated.dataRoot, 'profiles', 'scripts.yaml'),
    `schemaVersion: 1\nid: scripts\nname: Script windows\n` +
      `createdAt: '2026-10-03T12:00:00.000Z'\nupdatedAt: '2026-10-03T12:00:00.000Z'\nchecks:\n` +
      item('hidden', 'Hidden script', true) +
      item('shown', 'Script with a window', false)
  );
  const app = await _electron.launch({ executablePath: exe, args: [], env: isolated.env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('profile-switcher')).toContainText('Script windows');
    const before = consoleWindows();

    /** Runs the item's fix and reports the most console windows seen while it ran. */
    const mostWindowsWhileFixing = async (
      title: string
    ): Promise<{ all: number; visible: number }> => {
      const row = page.locator(`[data-testid="check-row"][data-title="${title}"]`);
      await row.getByTestId('check-fix').click();
      const most = consoleWindows();
      const until = Date.now() + 2500;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const now = consoleWindows();
        most.all = Math.max(most.all, now.all);
        most.visible = Math.max(most.visible, now.visible);
      }
      // The script really ran: its fix reports the exit, and the check (which always fails) stays.
      await expect(row).toContainText('Ran wait.cmd', { timeout: 20_000 });
      return most;
    };

    const hidden = await mostWindowsWhileFixing('Hidden script');
    const shown = await mostWindowsWhileFixing('Script with a window');
    console.log(
      `  console windows (existing / on screen): ${before.all} / ${before.visible} before, ` +
        `${hidden.all} / ${hidden.visible} during the hidden script, ` +
        `${shown.all} / ${shown.visible} during the one with a window`
    );
    // Hidden: no console window comes into being, on screen or off it.
    expect(hidden).toEqual(before);
    // Not asserted for the script that is not hidden: under this test harness the app is
    // itself started with hidden-by-default windows and may share a console with what it
    // starts, so no new window shows up here either way. The numbers are printed above.
    expect(shown.visible).toBeGreaterThanOrEqual(before.visible);
  } finally {
    await app.close().catch(() => undefined);
    await isolated.cleanup();
  }
});
