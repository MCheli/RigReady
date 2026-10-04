/**
 * One click in the packaged app (npm run smoke:packaged), against release/win-unpacked.
 *
 * Two kinds of proof:
 *
 *  - On a scenario (the fake machine): `--fly` on a cold start, and a second start that
 *    hands over to the RigReady already running. What "launches" there is a line in the
 *    fake machine's process list: never a game.
 *  - On the real Windows of this PC, in a profile of its own: the desktop shortcut the app
 *    makes is a .lnk Windows itself reads and starts; the Jump List is written; a hotkey is
 *    registered with Windows and given back.
 *
 * The PC is left as it was found. Every folder the app sees is under one temp directory
 * (the harness redirects USERPROFILE, APPDATA, LOCALAPPDATA and RIGREADY_HOME), so its
 * "Desktop" and its Jump List file are in that directory: the test asserts that before it
 * lets the app write, and checks afterwards that the real Jump List folder did not change.
 * The "game" a real setup launches is a copy of Windows' own ping.exe.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { isWithin } from '../../src/core/paths';
import { expect, isolatedEnv, repoRoot, screensDir, test, type IsolatedEnv } from '../e2e/harness';

const exe = path.join(repoRoot, 'release', 'win-unpacked', 'RigReady.exe');
const onCi = process.env['CI'] !== undefined && process.env['CI'] !== '';

test.use({ executablePath: exe });

interface CommandView {
  run: { action: string; outcome?: string; headline: string } | null;
  started: string[];
}
const command = (app: ElectronApplication): Promise<CommandView> =>
  app.evaluate(() =>
    (globalThis as unknown as { __rigreadyCommand(): CommandView }).__rigreadyCommand()
  );
const started = async (app: ElectronApplication): Promise<string[]> =>
  (await command(app)).started.map((program) => path.win32.basename(program));
const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
const strip = (page: Page) => page.getByTestId('command-strip');

/** How many real processes with this image name run on this PC right now. */
async function running(image: string): Promise<number> {
  const { stdout } = await promisify(execFile)('tasklist', [
    '/FI',
    `IMAGENAME eq ${image}`,
    '/FO',
    'CSV',
    '/NH',
  ]);
  return stdout.split(/\r?\n/).filter((line) => line.toLowerCase().includes(image.toLowerCase()))
    .length;
}

/** Numbered screenshots of the app window only, in artifacts/screens/<flow>. */
async function shooter(flow: string): Promise<(page: Page, name: string) => Promise<void>> {
  const dir = path.join(screensDir, flow);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  let count = 0;
  return async (page, name) => {
    await page.evaluate('document.fonts.ready');
    await page.screenshot({
      path: path.join(dir, `${String(++count).padStart(2, '0')}-${name}.png`),
    });
  };
}

const readLog = (isolated: IsolatedEnv): Promise<string> =>
  fs.readFile(path.join(isolated.dataRoot, 'logs', 'rigready.log'), 'utf8').catch(() => '');

// ---- on a scenario: nothing real is started -----------------------------------------------

test('packaged --fly on a scenario: the monitors are arranged, TrackIR is started, the game "launches", and no real program is started', async ({
  rig,
}) => {
  const games = await running('DCS.exe');
  const trackers = await running('TrackIR5.exe');
  const { page, app, shot } = await rig.launch('one-click-fly', 'packaged-one-click-fly', {
    args: ['--fly=dcs-f-a-18c'],
  });
  await expect(strip(page)).toHaveAttribute('data-phase', 'makingReady');
  // The monitor layout still asks.
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  expect(await started(app)).toEqual([]);
  await page.getByTestId('keep-layout-keep').click();
  await expect(strip(page)).toHaveAttribute('data-outcome', 'launched');
  await strip(page).hover();
  await expect(page.getByTestId('command-headline')).toHaveText('Launched DCS.exe');
  expect(await started(app)).toEqual(['TrackIR5.exe', 'DCS.exe']);
  await shot('launched');
  // Those were lines in the fake machine's list: on this PC nothing of the kind was started.
  expect(await running('DCS.exe')).toBe(games);
  expect(await running('TrackIR5.exe')).toBe(trackers);
});

test('packaged --fly stops in front of a required item that is not met', async ({ rig }) => {
  const { page, app, shot } = await rig.launch(
    'flying-pedals-unplugged',
    'packaged-one-click-stopped',
    {
      args: ['--fly', 'DCS F/A-18C'],
    }
  );
  await expect(strip(page)).toHaveAttribute('data-outcome', 'stopped');
  await expect(page.getByTestId('command-headline')).toHaveText(
    'DCS F/A-18C was not launched: 1 required item is not met'
  );
  await expect(page.getByTestId('command-reasons')).toContainText('T-Pendular-Rudder');
  expect(await started(app)).toEqual([]);
  expect(await windowVisible(app)).toBe(true);
  await shot('not-launched');
});

test('packaged second start: RigReady already running takes --setup, --make-ready and --fly from a second start and comes forward', async ({
  rig,
}) => {
  const run = await rig.launch('fly-two-setups', 'packaged-one-click-second-start');
  const { page, app, shot, mutate } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect.poll(() => windowVisible(app)).toBe(false);

  // The second RigReady.exe ends at once; the first one comes forward on the other setup.
  expect(await run.secondStart(['--setup', 'DCS F/A-18C'])).toBe(0);
  await expect.poll(() => windowVisible(app)).toBe(true);
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect
    .poll(async () => (await command(app)).run)
    .toMatchObject({ action: 'select', outcome: 'selected' });

  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  expect(await run.secondStart(['--make-ready=dcs-f-a-18c'])).toBe(0);
  await expect(strip(page)).toHaveAttribute('data-outcome', 'ready');
  await strip(page).hover();
  expect(await started(app)).toEqual(['TrackIR5.exe']);
  await shot('made-ready');

  expect(await run.secondStart(['--fly=dcs-f-a-18c'])).toBe(0);
  await expect.poll(() => started(app)).toEqual(['TrackIR5.exe', 'DCS.exe']);
  await expect
    .poll(async () => (await command(app)).run)
    .toMatchObject({ action: 'fly', outcome: 'launched', headline: 'Launched DCS.exe' });
  // As after any launch, the window got out of the way.
  await expect.poll(() => windowVisible(app)).toBe(false);
});

// ---- on the real Windows, in a profile of its own -----------------------------------------

const GAME = 'RigReadyFakeGame.exe';

/** A setup in the isolated profile whose "game" is a copy of ping.exe that runs for some seconds. */
async function realSetup(
  isolated: IsolatedEnv,
  setups: { id: string; name: string; lastUsed?: string }[]
): Promise<string> {
  const game = path.join(isolated.root, 'Games', GAME);
  await fs.mkdir(path.dirname(game), { recursive: true });
  await fs.copyFile(
    path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'ping.exe'),
    game
  );
  await fs.mkdir(path.join(isolated.dataRoot, 'profiles'), { recursive: true });
  for (const setup of setups) {
    await fs.writeFile(
      path.join(isolated.dataRoot, 'profiles', `${setup.id}.yaml`),
      `schemaVersion: 1\nid: ${setup.id}\nname: '${setup.name}'\n` +
        `createdAt: '2026-10-03T12:00:00.000Z'\nupdatedAt: '2026-10-03T12:00:00.000Z'\nchecks: []\n` +
        `launch: { exe: '${game.replace(/\\/g, '/')}', args: ['-n', '8', '127.0.0.1'] }\n`
    );
  }
  const lastUsed = Object.fromEntries(
    setups.filter((s) => s.lastUsed).map((s) => [s.id, s.lastUsed])
  );
  await fs.writeFile(
    path.join(isolated.dataRoot, 'state.json'),
    JSON.stringify({ lastProfileId: setups[0]!.id, lastUsed })
  );
  // The window stays open after a launch, so what happened can be read and pictured.
  await fs.mkdir(path.join(isolated.dataRoot, 'fly'), { recursive: true });
  await fs.writeFile(
    path.join(isolated.dataRoot, 'fly', 'preferences.json'),
    JSON.stringify({ minimizeOnLaunch: false })
  );
  return game;
}

/** Ends every copy of the fake game that was started from this test's own folder. */
async function endFakeGames(game: string): Promise<void> {
  await promisify(execFile)('powershell', [
    '-NoProfile',
    '-Command',
    `Get-Process ${GAME.replace(/\.exe$/, '')} -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${game}' } | Stop-Process -Force`,
  ]).catch(() => undefined);
}

test('packaged, real Windows: the desktop shortcut the app makes is a .lnk Windows reads, and starting it flies the setup', async () => {
  test.skip(onCi, 'needs an interactive desktop');
  const shot = await shooter('packaged-one-click-shortcut');
  const isolated = await isolatedEnv();
  const user = isolated.env['USERPROFILE']!;
  const game = await realSetup(isolated, [{ id: 'smoke', name: 'Smoke / test' }]);
  const lnk = path.join(user, 'Desktop', 'Smoke - test - RigReady.lnk');
  const app = await _electron.launch({ executablePath: exe, args: [], env: isolated.env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('profile-switcher')).toContainText('Smoke / test');
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('profile-edit').first().click();
    const panel = page.getByTestId('edit-shortcut');
    await expect(panel).toHaveAttribute('data-state', 'none');
    // Before the app writes anything: its Desktop is the one in this test's own folder.
    const where = (await page.getByTestId('shortcut-file').innerText()).trim();
    expect(where.toLowerCase()).toBe(lnk.toLowerCase());
    expect(isWithin(isolated.root, where), `${where} is not under ${isolated.root}`).toBe(true);

    await page.getByTestId('shortcut-create').click();
    await expect(page.getByTestId('change-preview-summary')).toHaveText('1 file created');
    await page.getByTestId('shortcut-go').click();
    await expect(panel).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('shortcut-error')).toHaveCount(0);
    await panel.evaluate((el) =>
      (el as unknown as { scrollIntoView(o: { block: string }): void }).scrollIntoView({
        block: 'center',
      })
    );
    await shot(page, 'on-the-desktop');

    // A real shortcut: Windows' own header, and Windows' own reader says what it starts.
    expect(existsSync(lnk)).toBe(true);
    const bytes = await fs.readFile(lnk);
    expect([...bytes.subarray(0, 4)]).toEqual([0x4c, 0, 0, 0]);
    const link = await app.evaluate(({ shell }, file) => shell.readShortcutLink(file), lnk);
    expect(link.target.toLowerCase()).toBe(exe.toLowerCase());
    expect(link.args).toBe('--fly=smoke');
    expect(link.description).toBe('Make the rig ready for Smoke / test and launch it');
    console.log(`  shortcut: ${lnk} -> ${link.target} ${link.args}`);

    // Started the way a double-click starts it: Windows opens the .lnk itself. The second
    // RigReady hands over to this one, which checks, finds nothing missing, and launches.
    expect(await running(GAME)).toBe(0);
    await new Promise<void>((resolve, reject) => {
      const starter = spawn('cmd.exe', ['/d', '/s', '/c', `"start "" "${lnk}""`], {
        env: isolated.env,
        windowsVerbatimArguments: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      starter.once('error', reject);
      starter.once('exit', () => resolve());
    });
    await expect(strip(page)).toHaveAttribute('data-outcome', 'launched', { timeout: 30_000 });
    await strip(page).hover();
    await expect(page.getByTestId('command-headline')).toHaveText(`Launched ${GAME}`);
    // The "game" (a copy of ping.exe) really runs.
    await expect.poll(() => running(GAME)).toBeGreaterThan(0);
    await shot(page, 'flown-from-the-shortcut');

    // Removed again through the app: the file is gone.
    await page.getByTestId('command-dismiss').click();
    await page.getByTestId('shortcut-remove').click();
    await expect(page.getByTestId('change-preview-summary')).toHaveText('1 file deleted');
    await page.getByTestId('shortcut-go').click();
    await expect(panel).toHaveAttribute('data-state', 'none');
    expect(existsSync(lnk)).toBe(false);
  } finally {
    await endFakeGames(game);
    await app.close().catch(() => undefined);
    const log = await readLog(isolated);
    await isolated.cleanup();
    expect(log).toContain('command fly "smoke": launched');
    expect(log).not.toContain('ERROR');
  }
  expect(await running(GAME)).toBe(0);
});

/** Names, sizes and times of the files in a folder; null when there is no such folder. */
async function listing(dir: string): Promise<Record<string, string> | null> {
  try {
    const out: Record<string, string> = {};
    for (const name of await fs.readdir(dir)) {
      const stat = await fs.stat(path.join(dir, name));
      out[name] = `${stat.size} ${stat.mtimeMs}`;
    }
    return out;
  } catch {
    return null;
  }
}

test('packaged, real Windows: the Jump List is written for the setups used most recently, inside the profile RigReady runs in', async () => {
  test.skip(onCi, 'needs the taskbar of an interactive desktop');
  const isolated = await isolatedEnv();
  // Windows keeps Jump Lists below the Recent folder of the profile the program sees. In
  // this profile there is none yet: with the folder in place Windows writes the list here.
  const custom = path.join(
    isolated.env['APPDATA']!,
    'Microsoft',
    'Windows',
    'Recent',
    'CustomDestinations'
  );
  await fs.mkdir(custom, { recursive: true });
  const realCustom = path.join(
    process.env['APPDATA'] ?? '',
    'Microsoft',
    'Windows',
    'Recent',
    'CustomDestinations'
  );
  const realBefore = await listing(realCustom);
  await realSetup(isolated, [
    { id: 'older', name: 'Smoke older', lastUsed: '2026-09-28T20:10:00.000Z' },
    { id: 'newer', name: 'Smoke newer', lastUsed: '2026-10-02T19:30:00.000Z' },
  ]);
  const app = await _electron.launch({ executablePath: exe, args: [], env: isolated.env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('profile-switcher')).toBeVisible();
    const files = async (): Promise<string[]> =>
      (await fs.readdir(custom)).filter((name) => name.endsWith('.customDestinations-ms'));
    await expect.poll(files, { timeout: 30_000 }).toHaveLength(1);
    const file = path.join(custom, (await files())[0]!);
    /** Where a text is in the file; Windows stores the strings of a task as UTF-16. */
    const at = async (text: string): Promise<number> =>
      (await fs.readFile(file)).indexOf(Buffer.from(text, 'utf16le'));
    await expect.poll(() => at('Fly Smoke newer')).toBeGreaterThan(-1);
    const newer = await at('Fly Smoke newer');
    const older = await at('Fly Smoke older');
    expect(older).toBeGreaterThan(-1);
    // The setup used last is the first task.
    expect(newer).toBeLessThan(older);
    // Each task starts this program with --fly for its setup.
    expect(await at('--fly=newer')).toBeGreaterThan(-1);
    expect(await at('--fly=older')).toBeGreaterThan(-1);
    expect(await at(path.basename(exe))).toBeGreaterThan(-1);
    console.log(`  Jump List written to ${file} (${(await fs.stat(file)).size} bytes)`);
    // Windows made the window's taskbar button and took its badge, tooltip, progress and buttons.
    await expect
      .poll(async () => (await readLog(isolated)).includes('Windows made the taskbar button'), {
        timeout: 30_000,
      })
      .toBe(true);
  } finally {
    await app.close().catch(() => undefined);
    const log = await readLog(isolated);
    await isolated.cleanup();
    // Windows made the window's taskbar button and took its badge, tooltip, progress and
    // buttons; nothing about the taskbar was refused; and the real Jump Lists were not touched.
    expect(log).toContain(
      'Windows made the taskbar button: its badge, tooltip, progress and buttons are set'
    );
    expect(log).not.toContain('did not take everything');
    expect(log).not.toContain('taskbar:');
    expect(log).not.toContain('ERROR');
    expect(await listing(realCustom)).toEqual(realBefore);
  }
});

test('packaged, real Windows: a hotkey chosen in Settings is registered with Windows and given back when it is turned off', async () => {
  test.skip(onCi, 'needs an interactive desktop');
  const shot = await shooter('packaged-one-click-hotkey');
  const isolated = await isolatedEnv();
  const app = await _electron.launch({ executablePath: exe, args: [], env: isolated.env });
  const registered = (accelerator: string): Promise<boolean> =>
    app.evaluate(
      ({ globalShortcut }, combination) => globalShortcut.isRegistered(combination),
      accelerator
    );
  try {
    const page = await app.firstWindow();
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-settings').click();
    const section = page.getByTestId('hotkey-settings');
    await section.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('hotkey-state')).toHaveText('Off');

    // Combinations nothing ordinary uses; the first one Windows gives is the one tested.
    const candidates = [
      {
        keys: 'Control+Alt+Shift+F11',
        shown: 'Ctrl + Alt + Shift + F11',
        accelerator: 'Control+Alt+Shift+F11',
      },
      {
        keys: 'Control+Alt+Shift+F9',
        shown: 'Ctrl + Alt + Shift + F9',
        accelerator: 'Control+Alt+Shift+F9',
      },
      {
        keys: 'Control+Alt+Shift+Digit7',
        shown: 'Ctrl + Alt + Shift + 7',
        accelerator: 'Control+Alt+Shift+7',
      },
    ];
    let taken: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      expect(await registered(candidate.accelerator)).toBe(false);
      await page.getByTestId('hotkey-choose').click();
      await page.getByTestId('hotkey-capture').locator('input').press(candidate.keys);
      await expect
        .poll(
          async () =>
            (await section.getAttribute('data-active')) === 'true' ||
            (await page.getByTestId('hotkey-error').count()) > 0
        )
        .toBe(true);
      if ((await section.getAttribute('data-active')) === 'true') {
        taken = candidate;
        break;
      }
      // Another program on this PC has it: RigReady says so, and nothing is registered.
      await expect(page.getByTestId('hotkey-error')).toContainText('cannot be the hotkey');
      expect(await registered(candidate.accelerator)).toBe(false);
      await page.getByTestId('hotkey-capture').locator('input').press('Escape');
    }
    expect(taken, 'none of the candidate combinations was free on this PC').toBeDefined();
    await expect(page.getByTestId('hotkey-state')).toHaveText(`${taken!.shown} is active`);
    // Windows itself says it is registered.
    expect(await registered(taken!.accelerator)).toBe(true);
    console.log(`  hotkey: Windows registered ${taken!.accelerator} for RigReady`);
    await shot(page, 'active');

    await page.getByTestId('hotkey-off').click();
    await expect(page.getByTestId('hotkey-state')).toHaveText('Off');
    expect(await registered(taken!.accelerator)).toBe(false);
  } finally {
    // Whatever happened, nothing stays registered: Electron gives every hotkey back on quit.
    await app
      .evaluate(({ globalShortcut }) => globalShortcut.unregisterAll())
      .catch(() => undefined);
    await app.close().catch(() => undefined);
    const log = await readLog(isolated);
    await isolated.cleanup();
    expect(log).not.toContain('ERROR');
  }
});
