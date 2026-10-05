/**
 * Installer smoke test (npm run smoke:installer).
 *
 * Installs the "RigReady Test" variant (same installer, another identity) per user and
 * without elevation, starts it, updates it through a feed on this PC, and removes it
 * again, twice: once keeping the data folder, once removing it. A real RigReady that is
 * installed on the same PC is fingerprinted before and after and must not change by a
 * byte: its files, its uninstall entry, its shortcuts, its update cache, its data
 * folder, and the Windows startup list.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { isolatedEnv, repoRoot, scenarioFile, screensDir, type IsolatedEnv } from '../e2e/harness';
import { executionLevel, isElevated, processRunning } from '../winHelpers';

const run = promisify(execFile);

interface Built {
  version: string;
  installer: string;
  feedDir: string;
}
interface Manifest {
  appId: string;
  productName: string;
  guid: string;
  productGuid: string;
  dataFolder: string;
  cacheFolder: string;
  productCacheFolder: string;
  current: Built;
  next: Built;
}

const manifestFile = path.join(repoRoot, 'release', 'installer-test', 'manifest.json');
const UNINSTALL = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const RUN_VALUE = 'RigReady';

// The real profile: installers use the Windows shell folders, whatever the environment says.
const home = os.homedir();
const appData = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
const localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
const startMenu = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const desktop = path.join(home, 'Desktop');

/** `reg query`, or the text "absent" when the key or value is not there. */
async function reg(args: string[]): Promise<string> {
  try {
    return (await run('reg', ['query', ...args])).stdout.replace(/\r/g, '').trim();
  } catch {
    return 'absent';
  }
}

async function regValue(key: string, name: string): Promise<string | undefined> {
  const out = await reg([key, '/v', name]);
  return /REG_\w+\s+(.*)/.exec(out)?.[1]?.trim();
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolve)
      .on('error', reject);
  });
  return hash.digest('hex');
}

/** Every file below a folder with its size and hash; "absent" when there is no such folder. */
async function fingerprint(dir: string, hashed = true): Promise<string> {
  if (!existsSync(dir)) return 'absent';
  const lines: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const stat = await fs.stat(full);
        lines.push(
          `${path.relative(dir, full)} ${stat.size} ${hashed ? await sha256(full) : stat.mtimeMs}`
        );
      }
    }
  };
  await walk(dir);
  return createHash('sha256').update(lines.join('\n')).digest('hex') + ` (${lines.length} files)`;
}

const fileHash = async (file: string): Promise<string> =>
  existsSync(file) ? sha256(file) : 'absent';

/** Everything about a real RigReady on this PC that the test variant must leave alone. */
async function ownerState(manifest: Manifest): Promise<Record<string, string>> {
  return {
    installFiles: await fingerprint(path.join(localAppData, 'Programs', 'RigReady')),
    uninstallEntry: await reg([`${UNINSTALL}\\${manifest.productGuid}`, '/s']),
    installEntry: await reg([`HKCU\\Software\\${manifest.productGuid}`, '/s']),
    startMenuShortcut: await fileHash(path.join(startMenu, 'RigReady.lnk')),
    desktopShortcut: await fileHash(path.join(desktop, 'RigReady.lnk')),
    updateCache: await fingerprint(path.join(localAppData, manifest.productCacheFolder)),
    // Read only, and not hashed: names, sizes and times are enough to see a change.
    dataFolder: await fingerprint(path.join(home, '.rigready'), false),
    startupList: await reg([RUN_KEY]),
    startupApproved: await reg([APPROVED_KEY]),
  };
}

async function waitFor(what: string, done: () => Promise<boolean>, ms: number): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await done()) return;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Runs an installer or uninstaller silently, as this (not elevated) user, and waits for it. */
function runSilently(exe: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    // NSIS wants /D=<dir> last and unquoted, so the arguments go through as written.
    const child = spawn(exe, args, {
      windowsVerbatimArguments: true,
      stdio: 'ignore',
      ...(env ? { env } : {}),
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

/** Serves one folder (the update feed) on a port of this PC only. */
async function serveFeed(
  dir: string
): Promise<{ url: string; requests: string[]; close(): Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
    requests.push(name);
    const file = path.join(dir, name);
    if (name.includes('..') || name.includes('/') || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    void fs.stat(file).then((stat) => {
      response.writeHead(200, { 'content-length': stat.size });
      createReadStream(file).pipe(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('the installer installs per user without elevation, the app starts and updates itself on quit, and the uninstaller cleans up and keeps or removes the data as asked', async () => {
  expect(
    existsSync(manifestFile),
    'run "npm run smoke:installer" (it builds the test installers)'
  ).toBe(true);
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as Manifest;
  const exeName = `${manifest.productName}.exe`;
  const uninstallKey = `${UNINSTALL}\\${manifest.guid}`;
  const installKey = `HKCU\\Software\\${manifest.guid}`;
  const shortcut = path.join(startMenu, `${manifest.productName}.lnk`);
  const desktopShortcut = path.join(desktop, `${manifest.productName}.lnk`);
  const testData = path.join(home, manifest.dataFolder);
  const testCache = path.join(localAppData, manifest.cacheFolder);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-installer-'));
  const installDir = path.join(work, 'app');
  const installedExe = path.join(installDir, exeName);
  const uninstaller = path.join(installDir, `Uninstall ${manifest.productName}.exe`);
  const shots = path.join(screensDir, 'installer-smoke');
  await fs.rm(shots, { recursive: true, force: true });
  await fs.mkdir(shots, { recursive: true });
  let shotCount = 0;
  const shot = async (page: Page, name: string): Promise<void> => {
    await page.evaluate('document.fonts.ready');
    await page.screenshot({
      path: path.join(shots, `${String(++shotCount).padStart(2, '0')}-${name}.png`),
    });
  };

  // ---- before anything runs: the test variant cannot collide with a real RigReady ----
  expect(manifest.guid).not.toBe(manifest.productGuid);
  expect(manifest.productName).not.toBe('RigReady');
  // These two folders are removed by this test: they must be the test variant's own.
  expect(manifest.dataFolder).toBe('.rigready-installer-test');
  expect(manifest.cacheFolder).toBe('rigready-test-updater');
  expect(manifest.cacheFolder).not.toBe(manifest.productCacheFolder);
  expect(
    installDir.toLowerCase().startsWith(path.join(localAppData, 'Programs').toLowerCase())
  ).toBe(false);
  expect(/\s/.test(installDir), 'the install folder is passed to NSIS unquoted').toBe(false);
  for (const built of [manifest.current, manifest.next]) {
    const unpacked = path.join(built.feedDir, 'win-unpacked');
    expect(existsSync(path.join(unpacked, exeName))).toBe(true);
    expect(existsSync(path.join(unpacked, 'RigReady.exe'))).toBe(false);
    const update = await fs.readFile(path.join(unpacked, 'resources', 'app-update.yml'), 'utf8');
    expect(update).toContain(`updaterCacheDirName: ${manifest.cacheFolder}`);
    expect(update).toContain('http://127.0.0.1:9/');
    // No elevation helper is shipped: nothing in the package can raise a UAC prompt.
    expect(existsSync(path.join(unpacked, 'resources', 'elevate.exe'))).toBe(false);
    expect(await executionLevel(path.join(unpacked, exeName))).toBe('asInvoker');
    expect(await executionLevel(built.installer)).toBe('asInvoker');
  }
  expect(await reg([uninstallKey]), 'a "RigReady Test" is already installed; remove it first').toBe(
    'absent'
  );
  expect(existsSync(shortcut)).toBe(false);
  expect(await isElevated(), 'this test must run without administrator rights').toBe(false);

  const before = await ownerState(manifest);
  const runBefore = await regValue(RUN_KEY, RUN_VALUE);
  console.log(
    `  real RigReady on this PC: ${before['installFiles'] === 'absent' ? 'none' : before['installFiles']}`
  );

  const isolated: IsolatedEnv[] = [];
  const apps: ElectronApplication[] = [];
  const launch = async (
    extra: Record<string, string>
  ): Promise<{ app: ElectronApplication; page: Page; env: IsolatedEnv }> => {
    const env = await isolatedEnv(extra);
    isolated.push(env);
    const app = await _electron.launch({ executablePath: installedExe, args: [], env: env.env });
    apps.push(app);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return { app, page, env };
  };
  /** Quits the way the tray's Quit does, and waits for the process to be gone. */
  const quit = async (app: ElectronApplication): Promise<void> => {
    const closed = new Promise<void>((resolve) => app.once('close', () => resolve()));
    await app.evaluate(({ app: electron }) => electron.quit()).catch(() => undefined);
    await closed;
  };
  const install = async (built: Built): Promise<void> => {
    const code = await runSilently(built.installer, ['/S', `/D=${installDir}`]);
    expect(code, `${path.basename(built.installer)} exit code`).toBe(0);
    await waitFor('the installed program', async () => existsSync(installedExe), 60_000);
  };
  const uninstall = async (args: string[], env?: NodeJS.ProcessEnv): Promise<void> => {
    // The uninstaller hands over to a copy of itself in %TEMP%, so its exit is not the end.
    await runSilently(uninstaller, ['/S', ...args], env);
    await waitFor(
      'the uninstaller to finish',
      async () =>
        !existsSync(installDir) &&
        (await reg([uninstallKey])) === 'absent' &&
        (await reg([installKey])) === 'absent',
      120_000
    );
  };
  const feed = await serveFeed(manifest.next.feedDir);

  try {
    // ---- 1. install: per user, silent, no elevation ----
    await fs.rm(testData, { recursive: true, force: true });
    const started = Date.now();
    await install(manifest.current);
    console.log(
      `  installed ${manifest.current.version} to ${installDir} in ${Date.now() - started} ms`
    );
    expect(await regValue(uninstallKey, 'DisplayName')).toBe(
      `${manifest.productName} ${manifest.current.version}`
    );
    expect(await regValue(uninstallKey, 'DisplayVersion')).toBe(manifest.current.version);
    expect((await regValue(installKey, 'InstallLocation'))?.toLowerCase()).toBe(
      installDir.toLowerCase()
    );
    // Per user: nothing was written for all users.
    expect(await reg([uninstallKey.replace('HKCU', 'HKLM')])).toBe('absent');
    expect(existsSync(shortcut), 'Start menu entry').toBe(true);
    expect(existsSync(uninstaller)).toBe(true);
    expect(await executionLevel(installedExe)).toBe('asInvoker');
    expect(existsSync(path.join(installDir, 'resources', 'python', 'python.exe'))).toBe(true);
    // A silent install starts nothing.
    expect(await regValue(RUN_KEY, RUN_VALUE)).toBe(runBefore);

    // ---- 2. the installed app starts on a scenario and reaches the Play screen ----
    {
      const { app, page } = await launch({ RIGREADY_SCENARIO: scenarioFile('flying-all-good') });
      await expect(page.getByTestId('scenario-banner')).toBeVisible();
      await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
      await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
      await expect(page.getByTestId('launch')).toBeEnabled();
      expect(await app.evaluate(({ app: electron }) => electron.getVersion())).toBe(
        manifest.current.version
      );
      expect(await app.evaluate(({ app: electron }) => electron.isPackaged)).toBe(true);
      await shot(page, 'installed-fly-screen');
      await quit(app);
    }

    // ---- 3. the real updater: finds the next version on a feed on this PC, downloads it
    //         in the background, and installs it when RigReady quits ----
    {
      const { app, page, env } = await launch({ RIGREADY_UPDATE_FEED: feed.url });
      await page.getByTestId('mode-configure').click();
      await page.getByTestId('nav-settings').click();
      const section = page.getByTestId('updates-section');
      await section.scrollIntoViewIfNeeded();
      await expect(page.getByTestId('about-version')).toHaveText(manifest.current.version);
      // The check at start (a few seconds in), then the download.
      await expect(section).toHaveAttribute('data-phase', 'ready', { timeout: 120_000 });
      await expect(page.getByTestId('update-status')).toHaveText(
        `Version ${manifest.next.version} is downloaded. It is installed when you restart RigReady here, or the next time you quit it.`
      );
      await page.getByTestId('about-section').scrollIntoViewIfNeeded();
      await shot(page, 'update-downloaded');
      expect(feed.requests).toContain('latest.yml');
      expect(feed.requests).toContain(path.basename(manifest.next.installer));
      // Downloaded is all: the installed version has not changed while the app runs.
      expect(await regValue(uninstallKey, 'DisplayVersion')).toBe(manifest.current.version);
      await quit(app);
      await waitFor(
        `version ${manifest.next.version} to be installed after the quit`,
        async () => (await regValue(uninstallKey, 'DisplayVersion')) === manifest.next.version,
        180_000
      );
      // The installer has finished once its process is gone and the new program is in place.
      await waitFor(
        'the update installer to finish',
        async () =>
          !(await processRunning(path.basename(manifest.next.installer))) &&
          existsSync(installedExe) &&
          existsSync(uninstaller),
        120_000
      );
      const log = await fs.readFile(path.join(env.dataRoot, 'logs', 'rigready.log'), 'utf8');
      expect(log).toContain(`update ${manifest.next.version} is installed on this quit`);
      expect((await regValue(installKey, 'InstallLocation'))?.toLowerCase()).toBe(
        installDir.toLowerCase()
      );
    }
    {
      const { app, page } = await launch({ RIGREADY_SCENARIO: scenarioFile('flying-all-good') });
      await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
      expect(await app.evaluate(({ app: electron }) => electron.getVersion())).toBe(
        manifest.next.version
      );
      await page.getByTestId('mode-configure').click();
      await page.getByTestId('nav-settings').click();
      await page.getByTestId('about-section').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('about-version')).toHaveText(manifest.next.version);
      await shot(page, 'updated-version');
      await quit(app);
    }

    // ---- 4. start with Windows, written by the installed app (only when this PC has no
    //         RigReady entry of its own to protect) ----
    if (runBefore === undefined) {
      // The feed on this PC again, so this start does not ask GitHub.
      const { app, page } = await launch({ RIGREADY_UPDATE_FEED: feed.url });
      await page.getByTestId('mode-configure').click();
      await page.getByTestId('nav-settings').click();
      const toggle = page.getByTestId('setting-start-with-windows').locator('input');
      await toggle.click();
      await expect(toggle).toBeChecked();
      // The switch moves at once and the registry follows.
      await expect
        .poll(async () => (await regValue(RUN_KEY, RUN_VALUE))?.toLowerCase() ?? '', {
          message: 'HKCU Run entry after turning Start with Windows on',
          timeout: 15_000,
        })
        .toContain(installedExe.toLowerCase());
      await quit(app);
    }

    // ---- 5. silent uninstall: everything of the app goes, the data stays ----
    await fs.mkdir(path.join(testData, 'logs'), { recursive: true });
    await fs.mkdir(path.join(testData, 'profiles'), { recursive: true });
    await fs.writeFile(path.join(testData, 'logs', 'rigready.log'), 'installer smoke\n');
    await fs.writeFile(path.join(testData, 'profiles', 'keep.yaml'), 'name: keep me\n');
    expect(existsSync(path.join(testCache, 'installer.exe'))).toBe(true);
    await uninstall([]);
    expect(existsSync(installDir)).toBe(false);
    expect(existsSync(shortcut)).toBe(false);
    expect(existsSync(desktopShortcut)).toBe(false);
    expect(await reg([uninstallKey])).toBe('absent');
    expect(await reg([installKey])).toBe('absent');
    expect(existsSync(testCache), 'the installer copy kept for updates').toBe(false);
    // The start-with-Windows entry of the removed install is gone (or the PC's own was left alone).
    expect(await regValue(RUN_KEY, RUN_VALUE)).toBe(runBefore);
    if (runBefore === undefined) expect(await regValue(APPROVED_KEY, RUN_VALUE)).toBeUndefined();
    // Default: the user's data is kept.
    expect(await fs.readFile(path.join(testData, 'profiles', 'keep.yaml'), 'utf8')).toBe(
      'name: keep me\n'
    );

    // ---- 6. install again; uninstall with --remove-data: the data goes too ----
    await install(manifest.next);
    // RIGREADY_HOME is honoured: this is the folder the uninstaller is told about.
    const elsewhere = path.join(work, 'data-elsewhere');
    await fs.mkdir(path.join(elsewhere, 'logs'), { recursive: true });
    await fs.writeFile(path.join(elsewhere, 'logs', 'rigready.log'), 'installer smoke\n');
    const notRigReady = path.join(work, 'not-rigready');
    await fs.mkdir(notRigReady, { recursive: true });
    await fs.writeFile(path.join(notRigReady, 'photo.txt'), 'not ours\n');
    await uninstall(['--remove-data'], { ...process.env, RIGREADY_HOME: elsewhere });
    expect(existsSync(elsewhere)).toBe(false);
    // The default folder was not what this uninstall was pointed at: still there.
    expect(existsSync(path.join(testData, 'profiles', 'keep.yaml'))).toBe(true);

    await install(manifest.next);
    // A folder that is not RigReady's (no log of the app in it) is never removed, whatever is asked.
    await uninstall(['--remove-data'], { ...process.env, RIGREADY_HOME: notRigReady });
    expect(existsSync(path.join(notRigReady, 'photo.txt'))).toBe(true);

    await install(manifest.next);
    await uninstall(['--remove-data']);
    expect(existsSync(testData)).toBe(false);
    expect(existsSync(shortcut)).toBe(false);
    expect(existsSync(testCache)).toBe(false);

    // ---- 7. the real RigReady on this PC, and the startup list, are exactly as before ----
    expect(await ownerState(manifest)).toEqual(before);
  } finally {
    for (const app of apps) await app.close().catch(() => undefined);
    await feed.close();
    // Whatever failed above: leave nothing of the test variant behind.
    if (existsSync(uninstaller)) {
      await runSilently(uninstaller, ['/S']).catch(() => undefined);
      await waitFor('cleanup', async () => !existsSync(installDir), 120_000).catch(() => undefined);
    }
    if (runBefore === undefined && (await regValue(RUN_KEY, RUN_VALUE)) !== undefined) {
      await run('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']).catch(() => undefined);
      await run('reg', ['delete', APPROVED_KEY, '/v', RUN_VALUE, '/f']).catch(() => undefined);
    }
    await fs.rm(testData, { recursive: true, force: true });
    await fs.rm(testCache, { recursive: true, force: true });
    for (const env of isolated) await env.cleanup().catch(() => undefined);
    await fs
      .rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      .catch(() => undefined);
  }
});
