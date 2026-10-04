/**
 * More of the packaged smoke (npm run smoke:packaged), against release/win-unpacked:
 * what the platform requirements ask to see in the packaged app on the real machine.
 * Live input in the tester, a failing input reader, memory while idle in the tray, the
 * real updater against a feed on this PC, and a script window that is really there
 * when a script is not hidden.
 *
 * Tests that need the rig's hardware are skipped on a CI runner (CI=true), which has no
 * game controller; everything else runs there too.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron, chromium, type ElectronApplication, type Page } from '@playwright/test';
import { FindWindowExW, IsWindowVisible } from '../../src/platform/windows/win32';
import { expect, isolatedEnv, repoRoot, screensDir, test, type IsolatedEnv } from '../e2e/harness';
import { executionLevel, isElevated } from '../winHelpers';

const exe = path.join(repoRoot, 'release', 'win-unpacked', 'RigReady.exe');
const resources = path.join(repoRoot, 'release', 'win-unpacked', 'resources');
const onCi = process.env['CI'] !== undefined && process.env['CI'] !== '';

test.use({ executablePath: exe });

/** Numbered screenshots of the app window only (never the desktop) in artifacts/screens/<flow>. */
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

async function launchReal(
  extra: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page; isolated: IsolatedEnv }> {
  const isolated = await isolatedEnv(extra);
  const app = await _electron.launch({ executablePath: exe, args: [], env: isolated.env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, isolated };
}

const readLog = (isolated: IsolatedEnv): Promise<string> =>
  fs.readFile(path.join(isolated.dataRoot, 'logs', 'rigready.log'), 'utf8').catch(() => '');

/** Quits the way the tray's Quit does and waits for the process to end. */
async function quit(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()));
  await app.evaluate(({ app: electron }) => electron.quit()).catch(() => undefined);
  await closed;
}

test('the packaged program asks for no elevation: its manifest says asInvoker, and this smoke runs without administrator rights', async () => {
  expect(await executionLevel(exe)).toBe('asInvoker');
  expect(await executionLevel(path.join(resources, 'python', 'python.exe'))).toBe('asInvoker');
  // The helper electron-builder would use to raise a UAC prompt is not in the package.
  expect(existsSync(path.join(resources, 'elevate.exe'))).toBe(false);
  const elevated = await isElevated();
  console.log(`  packaged smoke runs ${elevated ? 'WITH' : 'without'} administrator rights`);
  // A hosted CI runner is an administrator account; on a user's PC the smoke must not be.
  if (!onCi) {
    expect(elevated, 'run the packaged smoke from a normal (not elevated) terminal').toBe(false);
  }
});

test('packaged Devices page: the real controllers with their ids, and Refresh re-enumerates in under two seconds', async () => {
  test.skip(onCi, 'needs the devices of a real PC; a CI runner has none worth listing');
  const shot = await shooter('packaged-devices');
  const { app, page, isolated } = await launchReal();
  try {
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-devices').click();
    await expect(page.getByTestId('devices-page')).toBeVisible();
    const rows = page.getByTestId('devices-controllers').getByTestId('device-row');
    await expect(rows.first()).toBeVisible();
    const controllers = await rows.count();
    expect(controllers).toBeGreaterThan(0);
    // Every row is a real device: a name and a VID:PID as Windows reports them.
    for (const text of await rows.allInnerTexts()) expect(text).toMatch(/[0-9A-F]{4}:[0-9A-F]{4}/);

    // Refresh, as the button does it: the whole enumeration (USB devices, DirectInput
    // controllers, their pairing) through the packaged app, timed from the page.
    const timed = await page.evaluate(async () => {
      const bridge = (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input?: unknown): Promise<{ ok: boolean }> };
        }
      ).rigready;
      const started = performance.now();
      const result = await bridge.invoke('devices:overview');
      return { ok: result.ok, ms: Math.round(performance.now() - started) };
    });
    expect(timed.ok).toBe(true);
    await page.getByTestId('devices-refresh').click();
    await expect(rows).toHaveCount(controllers);
    console.log(
      `  packaged Devices page: ${controllers} game controllers; a refresh re-enumerates in ${timed.ms} ms`
    );
    expect(timed.ms).toBeLessThan(2000);
    await shot(page, 'real-controllers');
  } finally {
    await app.close().catch(() => undefined);
    const log = await readLog(isolated);
    await isolated.cleanup();
    expect(log).not.toContain('ERROR');
  }
});

test('packaged input tester: live values from a real controller, as DirectInput reports them', async () => {
  test.skip(onCi, 'needs a game controller; a CI runner has none');
  const shot = await shooter('packaged-input-tester');
  const { app, page, isolated } = await launchReal();
  try {
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-devices').click();
    await page.getByTestId('devices-tab-test').click();
    const tester = page.getByTestId('tester-page');
    await expect(tester).toHaveAttribute('data-live', 'true');
    await expect(page.getByTestId('tester-error')).toHaveCount(0);
    const picks = page.getByTestId('tester-pick');
    await expect(picks.first()).toBeVisible();
    const controllers = await picks.count();
    expect(controllers).toBeGreaterThan(0);
    await shot(page, 'all-controllers');

    // Nobody is at the rig to press anything, so what counts is the state the reader
    // reports right now. Every controller is opened with raw values on; the one whose
    // axes rest at the most different positions (a throttle, pedals) is the one shown.
    await page.getByTestId('tester-raw').locator('input').click();
    let found:
      { index: number; name: string; axes: number; buttons: number; raw: string[] } | undefined;
    let withAxes = 0;
    for (let i = 0; i < controllers; i++) {
      const chip = (await picks.nth(i).innerText()).trim();
      await picks.nth(i).click();
      // The view has switched once it carries the name of the controller that was picked.
      await expect(page.locator('.tester-title')).toHaveText(chip);
      const raw = (await page.getByTestId('axis-value').allInnerTexts()).map((text) =>
        text.replace(/\s+/g, ' ').trim()
      );
      if (raw.length === 0) continue;
      withAxes++;
      // Every axis shows a number that came from the device, not a placeholder.
      for (const value of raw) expect(value).toMatch(/^\d{1,5} · \d{1,3}\.\d%$/);
      if (!found || new Set(raw).size > new Set(found.raw).size) {
        found = {
          index: i,
          name: (await page.locator('.tester-title').innerText()).trim(),
          axes: raw.length,
          buttons: await page.getByTestId('button').count(),
          raw,
        };
      }
    }
    expect(found, 'a controller with at least one axis').toBeDefined();
    await picks.nth(found!.index).click();
    await expect(page.locator('.tester-title')).toHaveText(found!.name);
    console.log(
      `  packaged input tester: ${controllers} controllers, ${withAxes} with axes; "${found!.name}" reports ` +
        `${found!.axes} axes and ${found!.buttons} buttons: ${found!.raw.join(', ')}`
    );
    await shot(page, 'one-controller-raw-values');
  } finally {
    await app.close().catch(() => undefined);
    const log = await readLog(isolated);
    await isolated.cleanup();
    expect(log).toContain('input sidecar ready');
    expect(log).not.toContain('ERROR');
  }
});

test('packaged app with an input reader that fails to start: the tester says so, the log has the reason, the rest works', async () => {
  const shot = await shooter('packaged-input-reader-fails');
  const script = path.join(resources, 'sidecar', 'input_server.py');
  const original = await fs.readFile(script);
  // The reader dies at once with a reason, the way a broken runtime would.
  await fs.writeFile(
    script,
    'import sys\nsys.stderr.write("No module named dinput_broken\\n")\nsys.exit(3)\n'
  );
  let run: Awaited<ReturnType<typeof launchReal>> | undefined;
  try {
    run = await launchReal();
    const { page } = run;
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-devices').click();
    await page.getByTestId('devices-tab-test').click();
    await expect(page.getByTestId('tester-error')).toContainText(
      'The input reader stopped (exit code 3)'
    );
    await expect(page.getByTestId('tester-error')).toContainText('No module named dinput_broken');
    await shot(page, 'tester-says-why');

    // Everything that does not need the reader still works: devices, monitors, settings, Fly.
    await page.getByTestId('devices-tab-list').click();
    await expect(page.getByTestId('devices-page')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByTestId('mode-fly').click();
    await expect(page.getByTestId('mode-configure')).toBeVisible();
    await shot(page, 'rest-of-the-app-works');
  } finally {
    await fs.writeFile(script, original);
    await run?.app.close().catch(() => undefined);
    const log = run ? await readLog(run.isolated) : '';
    await run?.isolated.cleanup();
    expect(log).toContain('input reader did not start: The input reader stopped (exit code 3)');
    expect(log).toContain('No module named dinput_broken');
  }
  expect((await fs.readFile(script)).equals(original)).toBe(true);
});

test('memory: idle in the tray on the flying scenario, all RigReady processes together stay under 250 MB', async ({
  rig,
}) => {
  // RIGREADY_MEMORY_SETTLE_SECONDS=600 measures the full ten minutes; the default keeps the smoke short.
  const settleSeconds = Number(process.env['RIGREADY_MEMORY_SETTLE_SECONDS'] ?? '75');
  test.setTimeout((settleSeconds + 120) * 1000);
  const { app, page } = await rig.launch('flying-all-good', 'packaged-memory');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // Closing the window sends RigReady to the tray (the default setting).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
    .toBe(false);

  const sample = async (): Promise<{ total: number; parts: string }> => {
    const metrics = await app.evaluate(({ app: electron }) =>
      electron.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize }))
    );
    const mb = (kb: number): number => Math.round((kb / 1024) * 10) / 10;
    return {
      total: mb(metrics.reduce((sum, m) => sum + m.kb, 0)),
      parts: metrics.map((m) => `${m.type} ${mb(m.kb)}`).join(', '),
    };
  };
  const samples: { at: number; total: number; parts: string }[] = [];
  const started = Date.now();
  const step = Math.max(5, Math.round(settleSeconds / 5));
  // RigReady hands its unused memory back a few seconds after it goes to the tray, so the
  // number as the window is hidden is printed, and "idle in the tray" starts after it.
  const asHidden = await sample();
  for (let elapsed = step; elapsed <= settleSeconds; elapsed += step) {
    const wait = started + elapsed * 1000 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    samples.push({ at: Math.round((Date.now() - started) / 1000), ...(await sample()) });
  }
  const last = samples.at(-1)!;
  const peak = Math.max(...samples.map((s) => s.total));
  console.log(
    `  packaged memory, working set of all processes: ${asHidden.total} MB as the window is hidden; in the tray ` +
      samples.map((s) => `${s.total} MB at ${s.at} s`).join(', ') +
      `\n  after ${last.at} s: ${last.parts} (MB)`
  );
  test.info().annotations.push({ type: 'idle-working-set-mb', description: String(last.total) });
  expect(peak).toBeLessThan(250);
});

/** A folder served on a port of this PC only, as an update feed. */
async function serveFeed(
  dir: string
): Promise<{ url: string; requests: string[]; close(): Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
    requests.push(name);
    const file = path.join(dir, name);
    if (!name || name.includes('..') || name.includes('/') || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    void fs.stat(file).then((stat) => {
      response.writeHead(200, { 'content-length': stat.size });
      createReadStream(file).pipe(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A port on this PC that nothing listens on. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Writes an update feed like the one a release publishes (latest.yml for stable,
 * beta.yml for beta). The "installer" is a copy of Windows' own ping.exe: a real,
 * harmless program, so that even a mistake could not install anything.
 */
async function writeFeed(dir: string, versions: { stable: string; beta: string }): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const ping = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'ping.exe');
  for (const [channel, version] of [
    ['latest', versions.stable],
    ['beta', versions.beta],
  ] as const) {
    const name = `RigReady-Setup-${version}.exe`;
    await fs.copyFile(ping, path.join(dir, name));
    const bytes = await fs.readFile(path.join(dir, name));
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    await fs.writeFile(
      path.join(dir, `${channel}.yml`),
      `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\n` +
        `path: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-10-03T12:00:00.000Z'\n`
    );
  }
}

async function openUpdates(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('updates-section').scrollIntoViewIfNeeded();
}

test('the real updater against an update feed on this PC: stable and beta, downloaded in the background, never installed while a game runs', async () => {
  const shot = await shooter('packaged-updates');
  const isolated = await isolatedEnv();
  const feedDir = path.join(isolated.root, 'feed');
  await writeFeed(feedDir, { stable: '9.9.9', beta: '9.9.10-beta.1' });
  const feed = await serveFeed(feedDir);
  // A "game": a setup that launches this program, and the program running.
  const game = path.join(isolated.root, 'Games', 'RigReadyFakeGame.exe');
  await fs.mkdir(path.dirname(game), { recursive: true });
  await fs.copyFile(
    path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'ping.exe'),
    game
  );
  await fs.mkdir(path.join(isolated.dataRoot, 'profiles'), { recursive: true });
  await fs.writeFile(
    path.join(isolated.dataRoot, 'profiles', 'game.yaml'),
    `schemaVersion: 1\nid: game\nname: A game\ncreatedAt: '2026-10-03T12:00:00.000Z'\n` +
      `updatedAt: '2026-10-03T12:00:00.000Z'\nchecks: []\n` +
      `launch: { exe: '${game.replace(/\\/g, '/')}', args: [] }\n`
  );
  let running: ChildProcess | undefined;
  const app = await _electron.launch({
    executablePath: exe,
    args: [],
    env: { ...isolated.env, RIGREADY_UPDATE_FEED: feed.url },
  });
  try {
    const page = await app.firstWindow();
    await openUpdates(page);
    const section = page.getByTestId('updates-section');
    const status = page.getByTestId('update-status');
    const version = await app.evaluate(({ app: electron }) => electron.getVersion());
    await expect(page.getByTestId('about-version')).toHaveText(version);

    // The check at start finds the stable release and downloads it; nothing is installed.
    await expect(section).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
    await expect(status).toContainText('Version 9.9.9 is downloaded.');
    expect(feed.requests).toContain('latest.yml');
    expect(feed.requests).toContain('RigReady-Setup-9.9.9.exe');
    expect(feed.requests).not.toContain('beta.yml');
    await page.getByTestId('about-section').scrollIntoViewIfNeeded();
    await shot(page, 'stable-downloaded');

    // The beta channel reads beta.yml and takes the beta.
    await page.getByTestId('update-channel').click();
    await page.locator('.v-overlay--active .v-list-item').filter({ hasText: 'Beta' }).click();
    await expect(status).toContainText('Version 9.9.10-beta.1 is downloaded.', { timeout: 60_000 });
    expect(feed.requests).toContain('beta.yml');
    await expect(page.getByTestId('about-channel')).toHaveText('Beta');

    // The game starts. "Restart to install" is refused, by the real process list.
    running = spawn(game, ['-n', '600', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
    await new Promise<void>((resolve, reject) => {
      running!.once('spawn', () => resolve());
      running!.once('error', reject);
    });
    await page.getByTestId('update-install').click();
    await expect(status).toContainText(
      'RigReadyFakeGame.exe is running, so version 9.9.10-beta.1 was not installed.'
    );
    await expect(section).toHaveAttribute('data-phase', 'ready');
    await page.getByTestId('about-section').scrollIntoViewIfNeeded();
    await shot(page, 'refused-while-the-game-runs');

    // Quitting with the game still running installs nothing either.
    await quit(app);
    const log = await readLog(isolated);
    expect(log).toContain(
      'update 9.9.10-beta.1 is not installed on this quit: RigReadyFakeGame.exe is running'
    );
    expect(log).not.toContain('is installed on this quit');
    expect(log).not.toContain('ERROR');
  } finally {
    running?.kill();
    await app.close().catch(() => undefined);
    await feed.close();
    await isolated.cleanup();
  }
});

test('no feed, no release: the packaged app says so calmly, shows no error dialog and keeps working', async () => {
  const shot = await shooter('packaged-updates-no-feed');
  // 1. Nothing listens at the feed address (no network).
  const dead = await launchReal({ RIGREADY_UPDATE_FEED: `http://127.0.0.1:${await freePort()}/` });
  try {
    await openUpdates(dead.page);
    await expect(dead.page.getByTestId('updates-section')).toHaveAttribute('data-phase', 'error', {
      timeout: 60_000,
    });
    await expect(dead.page.getByTestId('update-status')).toContainText(
      'The update server could not be reached.'
    );
    await shot(dead.page, 'server-not-reachable');
    // One window, still answering: no dialog took over, nothing crashed.
    expect(
      await dead.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    ).toBe(1);
    await dead.page.getByTestId('mode-fly').click();
    await expect(dead.page.getByTestId('mode-configure')).toBeVisible();
  } finally {
    await dead.app.close().catch(() => undefined);
    const log = await readLog(dead.isolated);
    await dead.isolated.cleanup();
    expect(log).toContain('update check (start) failed');
    expect(log).not.toContain('ERROR');
  }

  // 2. A feed that has no release at all (every file is missing).
  const emptyIsolated = await isolatedEnv();
  const emptyDir = path.join(emptyIsolated.root, 'empty-feed');
  await fs.mkdir(emptyDir, { recursive: true });
  const empty = await serveFeed(emptyDir);
  const app = await _electron.launch({
    executablePath: exe,
    args: [],
    env: { ...emptyIsolated.env, RIGREADY_UPDATE_FEED: empty.url },
  });
  try {
    const page = await app.firstWindow();
    await openUpdates(page);
    await expect(page.getByTestId('updates-section')).toHaveAttribute('data-phase', 'noRelease', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('update-status')).toContainText(
      'Nothing has been published on the stable channel yet.'
    );
    expect(empty.requests).toContain('latest.yml');
    await shot(page, 'nothing-published');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    await app.close().catch(() => undefined);
    await empty.close();
    const log = await readLog(emptyIsolated);
    await emptyIsolated.cleanup();
    expect(log).not.toContain('ERROR');
  }
});

test('the packaged app asks GitHub Releases itself (the feed written into the package) and ends without a dialog whatever the answer', async () => {
  // The only test that uses the network: it proves the feed inside the package is the
  // GitHub one and that any answer (newer, nothing newer, no release, offline) is handled.
  const { app, page, isolated } = await launchReal();
  try {
    await openUpdates(page);
    const section = page.getByTestId('updates-section');
    await expect(section).toHaveAttribute(
      'data-phase',
      /^(upToDate|noRelease|error|ready|downloading)$/,
      {
        timeout: 60_000,
      }
    );
    const phase = await section.getAttribute('data-phase');
    const text = await page.getByTestId('update-status').innerText();
    console.log(`  GitHub Releases answered: ${phase} ("${text}")`);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    // Whatever was found, nothing is installed by this test: automatic updates go off before the quit.
    await page.getByTestId('update-automatic').locator('input').click();
    await expect(page.getByTestId('update-automatic').locator('input')).not.toBeChecked();
  } finally {
    await app.close().catch(() => undefined);
    const log = await readLog(isolated);
    await isolated.cleanup();
    expect(log).toMatch(/update check \(start\)|update feed has nothing/);
    expect(log).not.toContain('is installed on this quit');
    expect(log).not.toContain('ERROR');
  }
});

/** Console windows that exist right now (classic console host and Windows Terminal). */
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

test('started the way a user starts it, a script that is not hidden gets a console window on screen and hidden ones get none', async () => {
  test.skip(onCi, 'needs an interactive desktop');
  // The other packaged tests start the app through the test driver, which starts it with
  // "windows hidden by default". Here the app is started through `start`, as Explorer
  // would, and driven over the DevTools port instead, so a window that should be on
  // screen is. What was measured on this PC (Windows 11): a script RigReady waits for
  // never gets a console window, hidden or not, because its output is piped to RigReady;
  // one that is started without waiting gets a window of its own unless it is hidden.
  const isolated = await isolatedEnv();
  const scripts = path.join(isolated.env['USERPROFILE']!, 'Scripts');
  await fs.mkdir(scripts, { recursive: true });
  await fs.writeFile(path.join(scripts, 'fail.cmd'), '@exit /b 1\r\n');
  await fs.writeFile(
    path.join(scripts, 'wait.cmd'),
    '@echo off\r\necho waiting for %RIGREADY_PROFILE_NAME%\r\nping -n 4 127.0.0.1 >nul\r\n'
  );
  const item = (id: string, title: string, hidden: boolean, wait: boolean): string =>
    `  - id: ${id}\n    type: script.check\n    title: ${title}\n    required: false\n` +
    `    params: { exe: '{USER}/Scripts/fail.cmd' }\n    remediation:\n      type: script.run\n` +
    `      params: { exe: '{USER}/Scripts/wait.cmd', hidden: ${hidden}, waitForCompletion: ${wait}, requiresConfirmation: false, timeoutSeconds: 20 }\n`;
  await fs.mkdir(path.join(isolated.dataRoot, 'profiles'), { recursive: true });
  await fs.writeFile(
    path.join(isolated.dataRoot, 'profiles', 'scripts.yaml'),
    `schemaVersion: 1\nid: scripts\nname: Script windows\n` +
      `createdAt: '2026-10-03T12:00:00.000Z'\nupdatedAt: '2026-10-03T12:00:00.000Z'\nchecks:\n` +
      item('hidden', 'Hidden script', true, true) +
      item('hidden-started', 'Hidden script, not waited for', true, false) +
      item('shown', 'Script with a window', false, false)
  );
  const port = await freePort();
  // A feed nobody listens on: this start does not ask GitHub.
  const env = { ...isolated.env, RIGREADY_UPDATE_FEED: `http://127.0.0.1:${await freePort()}/` };
  await new Promise<void>((resolve, reject) => {
    const starter = spawn(
      'cmd.exe',
      // /s: cmd takes everything between the outer quotes as the command, as written.
      ['/d', '/s', '/c', `"start "" "${exe}" --remote-debugging-port=${port}"`],
      // Nothing of this test process is handed down: the app must not share its console or pipes.
      { env, windowsVerbatimArguments: true, stdio: 'ignore', detached: true, windowsHide: true }
    );
    starter.once('error', reject);
    starter.once('exit', () => resolve());
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  let pid: number | undefined;
  try {
    await expect
      .poll(
        async () => {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 30_000 }
      )
      .toBe(true);
    const session = await browser!.newBrowserCDPSession();
    const info = (await session.send('SystemInfo.getProcessInfo')) as {
      processInfo: { type: string; id: number }[];
    };
    pid = info.processInfo.find((p) => p.type === 'browser')?.id;
    const page = browser!.contexts()[0]!.pages()[0]!;
    await expect(page.getByTestId('profile-switcher')).toContainText('Script windows');
    const before = consoleWindows();

    /** Runs the item's fix and reports the most console windows seen until its script has ended. */
    const mostWindowsWhileFixing = async (
      title: string,
      done: string
    ): Promise<{ all: number; visible: number }> => {
      const row = page.locator(`[data-testid="check-row"][data-title="${title}"]`);
      await row.getByTestId('check-fix').click();
      const most = consoleWindows();
      // The script runs for about three seconds.
      const until = Date.now() + 4500;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const now = consoleWindows();
        most.all = Math.max(most.all, now.all);
        most.visible = Math.max(most.visible, now.visible);
      }
      await expect(row).toContainText(done, { timeout: 20_000 });
      return most;
    };

    const hidden = await mostWindowsWhileFixing('Hidden script', 'Ran wait.cmd');
    const hiddenStarted = await mostWindowsWhileFixing(
      'Hidden script, not waited for',
      'Started wait.cmd'
    );
    const shown = await mostWindowsWhileFixing('Script with a window', 'Started wait.cmd');
    console.log(
      `  started like a user would; console windows (existing / on screen): ${before.all} / ${before.visible} before, ` +
        `${hidden.all} / ${hidden.visible} during the hidden script, ` +
        `${hiddenStarted.all} / ${hiddenStarted.visible} during the hidden one that is not waited for, ` +
        `${shown.all} / ${shown.visible} during the one with a window`
    );
    // Hidden: no console window comes into being, on screen or off it.
    expect(hidden).toEqual(before);
    expect(hiddenStarted).toEqual(before);
    // Not hidden: the same measurement sees its window, on screen.
    expect(shown.all).toBeGreaterThan(before.all);
    expect(shown.visible).toBeGreaterThan(before.visible);
  } finally {
    await browser?.close().catch(() => undefined);
    if (pid !== undefined) {
      await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']).catch(
        () => undefined
      );
    }
    // Whatever happened above, no copy of this build is left running (and no other RigReady is touched).
    await promisify(execFile)('powershell', [
      '-NoProfile',
      '-Command',
      `Get-Process RigReady -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe}' } | Stop-Process -Force`,
    ]).catch(() => undefined);
    await isolated.cleanup().catch(() => undefined);
  }
});
