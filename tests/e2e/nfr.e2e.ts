import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * The non-functional requirements that can only be proven in the running app:
 *   NFR-005  the renderer is sandboxed, isolated and held by a Content-Security-Policy
 *   PLAT-008 a run with RIGREADY_HOME set leaves the real ~/.rigready alone
 *   PLAT-013 scenario runs say so, in a badge
 *   NFR-006  no control on any route is a stub
 *   NFR-003  the window keeps answering while a long backup runs, which shows progress
 *            and can be cancelled
 */

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

/** Something still loading. */
const BUSY =
  '.v-progress-circular--indeterminate:visible, .v-progress-linear--active:visible, .v-skeleton-loader:visible';

/** Every route the feature manifests registered, read from the running app's router. */
const routesOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: {
        querySelector(selector: string): {
          __vue_app__: {
            config: { globalProperties: { $router: { getRoutes(): { path: string }[] } } };
          };
        };
      };
    };
    const app = scope.document.querySelector('#app').__vue_app__;
    return app.config.globalProperties.$router.getRoutes().map((route) => route.path);
  });

/**
 * Disabled controls the crawl meets that say nothing about why, kept here until their page
 * says it. Each is a finding, reported; the list must not grow.
 */
const DISABLED_FOR_NOW: Record<string, string> = {};

interface Snapshot {
  exists: boolean;
  entries: Record<string, string>;
}

/** Every file and folder below a folder with its size and modified time. Reads only. */
async function snapshot(dir: string): Promise<Snapshot> {
  const entries: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const stat = await fs.stat(full);
      const key = path.relative(dir, full);
      if (entry.isDirectory()) {
        entries[`${key}${path.sep}`] = 'folder';
        await walk(full);
      } else entries[key] = `${stat.size} bytes, modified ${stat.mtimeMs}`;
    }
  };
  try {
    await fs.access(dir);
  } catch {
    return { exists: false, entries };
  }
  await walk(dir);
  return { exists: true, entries };
}

test('nfr: the renderer is isolated and sandboxed, held by its CSP, and reaches main only through validated channels', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('flying-all-good', 'nfr-hardening');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // What Electron actually applied to the window, not what the source says.
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const applied = (
      window.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
    ).getLastWebPreferences();
    return {
      contextIsolation: applied['contextIsolation'],
      nodeIntegration: applied['nodeIntegration'],
      sandbox: applied['sandbox'],
      webSecurity: applied['webSecurity'],
      webviewTag: applied['webviewTag'],
    };
  });
  expect(prefs).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  expect(prefs.webSecurity).not.toBe(false);
  expect(prefs.webviewTag).not.toBe(true);

  // Nothing of Node or Electron in the page: only the two bridge functions.
  const surface = await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    return {
      require: typeof scope['require'],
      process: typeof scope['process'],
      module: typeof scope['module'],
      buffer: typeof scope['Buffer'],
      electron: typeof scope['electron'],
      ipcRenderer: typeof scope['ipcRenderer'],
      bridge: Object.keys(scope['rigready'] as object).sort(),
    };
  });
  expect(surface).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    buffer: 'undefined',
    electron: 'undefined',
    ipcRenderer: 'undefined',
    bridge: ['invoke', 'on'],
  });

  // The policy: scripts from the app only. An inline script, a remote script and eval are refused.
  const csp = await page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: {
        querySelector(s: string): { getAttribute(n: string): string | null } | null;
        createElement(tag: string): { src: string; textContent: string };
        head: { appendChild(el: unknown): void };
        addEventListener(
          type: string,
          fn: (e: { violatedDirective: string; blockedURI: string }) => void
        ): void;
      };
      setTimeout(code: string, ms: number): unknown;
      inlineRan?: boolean;
      evalRan?: boolean;
    };
    const violations: string[] = [];
    scope.document.addEventListener('securitypolicyviolation', (e) =>
      violations.push(`${e.violatedDirective} ${e.blockedURI}`)
    );
    const inline = scope.document.createElement('script');
    inline.textContent = 'globalThis.inlineRan = true;';
    scope.document.head.appendChild(inline);
    const remote = scope.document.createElement('script');
    remote.src = 'https://example.invalid/evil.js';
    scope.document.head.appendChild(remote);
    // Text run as code by the page itself (a string timer is an eval): refused without
    // 'unsafe-eval'. (Code the test evaluates through the debugger is exempt, so the page
    // has to do it.)
    try {
      scope.setTimeout('globalThis.evalRan = true', 0);
    } catch {
      // Refused at once: just as good.
    }
    return new Promise<{
      policy: string | null;
      violations: string[];
      inlineRan: boolean;
      evalRefused: boolean;
    }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            policy:
              scope.document
                .querySelector('meta[http-equiv="Content-Security-Policy"]')
                ?.getAttribute('content') ?? null,
            violations,
            inlineRan: scope.inlineRan === true,
            evalRefused: scope.evalRan !== true,
          }),
        300
      )
    );
  });
  expect(csp.policy).toContain("script-src 'self'");
  expect(csp.policy).not.toMatch(/https?:|unsafe-eval|\*/);
  expect(csp.inlineRan).toBe(false);
  expect(csp.evalRefused).toBe(true);
  expect(csp.violations.some((v) => v.includes('inline'))).toBe(true);
  expect(csp.violations.some((v) => v.includes('example.invalid'))).toBe(true);

  // Main answers only channels of a contract, only with valid input.
  const invoke = (
    channel: string,
    input?: unknown
  ): Promise<{ ok: boolean; error?: { code: string } }> =>
    page.evaluate(
      ([name, payload]) =>
        (
          globalThis as unknown as {
            rigready: {
              invoke(c: string, i: unknown): Promise<{ ok: boolean; error?: { code: string } }>;
            };
          }
        ).rigready.invoke(name as string, payload),
      [channel, input] as const
    );
  expect(await invoke('../evil')).toMatchObject({ ok: false, error: { code: 'ipc.channel' } });
  expect(await invoke('ELECTRON_BROWSER_REQUIRE')).toMatchObject({ ok: false });
  expect(await invoke('fly:check', { profileId: 42 })).toMatchObject({
    ok: false,
    error: { code: 'ipc.input' },
  });
  expect(await invoke('fly:check')).toMatchObject({ ok: false, error: { code: 'ipc.input' } });
  // A channel nobody declared never reaches a handler.
  const unknown = await page.evaluate(() =>
    (
      globalThis as unknown as { rigready: { invoke(c: string, i: unknown): Promise<unknown> } }
    ).rigready
      .invoke('fly:noSuchChannel', undefined)
      .then(
        () => 'answered',
        () => 'refused'
      )
  );
  expect(unknown).toBe('refused');
  // The scenario-only file channel keeps to the fake user folder.
  expect(
    await invoke('app:scenario', {
      change: { reason: 'x', files: [{ path: '../../outside.txt', content: 'x' }] },
    })
  ).toMatchObject({ ok: false, error: { code: 'scenario.invalid' } });
  expect(
    await invoke('app:scenario', {
      change: { reason: 'x', files: [{ path: 'C:/Windows/System32/x', content: 'x' }] },
    })
  ).toMatchObject({ ok: false, error: { code: 'scenario.invalid' } });
  // Nothing opens a second window in the app. (A file address, on purpose: an https link
  // would be handed to the real browser of this PC, which a test must not start.)
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await page.evaluate(() => {
    (globalThis as unknown as { open(url: string): unknown }).open('file:///C:/Windows/win.ini');
  });
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
    windows
  );
  await shot('still-the-app');
});

test('nfr: a scenario run shows its badge and never touches the real ~/.rigready', async ({
  rig,
}) => {
  // Read-only: the listing, sizes and modified times of the real folder, before and after.
  const real = path.join(os.homedir(), '.rigready');
  const before = await snapshot(real);

  const run = await rig.launch('flying-trackir-not-running', 'nfr-isolation');
  const { page, shot, dataRoot, home, app } = run;
  await expect(page.getByTestId('scenario-banner')).toHaveText(
    /Scenario: Flying, TrackIR software not running/
  );
  await shot('scenario-badge');
  // Where the app keeps its data in this run: the temp folder RIGREADY_HOME names.
  const info = (await page.evaluate(() =>
    (
      globalThis as unknown as { rigready: { invoke(c: string, i: unknown): Promise<unknown> } }
    ).rigready.invoke('app:info', undefined)
  )) as { ok: true; value: { dataRoot: string; scenario: string } };
  expect(info.value.dataRoot).toBe(dataRoot);
  expect(path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()))).toBe(true);
  expect(path.resolve(home).startsWith(path.resolve(os.tmpdir()))).toBe(true);
  expect(path.resolve(dataRoot).toLowerCase()).not.toBe(real.toLowerCase());

  // Do things that write: a fix, a setting, a layout, a backup of everything.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('mode-configure').click();
  await go(page, '/configure/backups');
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await go(page, '/configure/safety');
  await expect(page.getByTestId('safety-page')).toBeVisible();
  await shot('after-writes');

  // It all went to the temp data root.
  const written = await fs.readdir(dataRoot);
  expect(written).toEqual(expect.arrayContaining(['profiles', 'backups', 'logs']));
  expect((await fs.readdir(path.join(dataRoot, 'backups'))).some((f) => f.endsWith('.zip'))).toBe(
    true
  );

  await app.close();
  const after = await snapshot(real);
  expect(after.exists).toBe(before.exists);
  expect(after.entries).toEqual(before.entries);
});

test('nfr: every route of every feature renders, and no visible control is a stub', async ({
  rig,
}) => {
  test.setTimeout(300_000);
  const { page, shot } = await rig.launch('flying-all-good', 'nfr-crawl');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const all = await routesOf(page);
  // Every page a link can reach directly: routes without a parameter, and those whose
  // parameters are all optional, opened without them.
  const routes = [...new Set(all.map((r) => r.replace(/\/:[^/]+\?/g, '')))].filter(
    (r) => !r.includes(':') && !r.includes('*') && r !== '/' && r !== '/configure' && r !== ''
  );
  expect(routes.length).toBeGreaterThan(25);
  // Every navigation entry is one of them.
  await page.getByTestId('mode-configure').click();
  await expect(page.getByTestId('configure-nav').locator('a').first()).toBeVisible();
  const offered = await page
    .getByTestId('configure-nav')
    .locator('a')
    .evaluateAll((links) => links.map((a) => (a.getAttribute('href') ?? '').replace(/^#/, '')));
  expect(offered.length).toBeGreaterThan(10);
  expect(offered.filter((route) => !routes.includes(route))).toEqual([]);

  const findings: string[] = [];
  let controls = 0;
  for (const route of routes) {
    await go(page, route);
    await expect
      .poll(() =>
        page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)
      )
      .toBe(`#${route}`);
    // The page has finished drawing: the same controls twice in a row, and nothing loading.
    let seen = -1;
    await expect
      .poll(
        async () => {
          const now = await page.locator('button:visible, a.v-btn:visible').count();
          const settled = now === seen;
          seen = now;
          return settled;
        },
        { intervals: [150, 150, 150, 300] }
      )
      .toBe(true);
    await expect(page.locator(BUSY), route).toHaveCount(0);
    // A page, not the "not found" screen, and no error.
    await expect(page.getByText('There is nothing at this address.'), route).toHaveCount(0);
    await expect(page.locator('.v-alert.text-error, .v-alert.bg-error'), route).toHaveCount(0);
    const audit = await page.evaluate(() => {
      interface El {
        getBoundingClientRect(): { width: number; height: number };
        getAttribute(name: string): string | null;
        hasAttribute(name: string): boolean;
        closest(selector: string): unknown;
        textContent: string | null;
        disabled?: boolean;
        classList: { contains(name: string): boolean };
        title?: string;
      }
      const scope = globalThis as unknown as {
        document: { querySelectorAll(s: string): Iterable<El>; body: { innerText: string } };
        getComputedStyle(el: El): { visibility: string; display: string };
      };
      const visible = (el: El): boolean => {
        const box = el.getBoundingClientRect();
        const style = scope.getComputedStyle(el);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      };
      const stubs: string[] = [];
      const dead: string[] = [];
      let count = 0;
      for (const el of scope.document.querySelectorAll('button, a.v-btn, [role="button"]')) {
        if (!visible(el)) continue;
        count++;
        const label = (
          el.getAttribute('data-testid') ??
          el.getAttribute('aria-label') ??
          el.textContent ??
          ''
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 50);
        const disabled =
          el.disabled === true ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.classList.contains('v-btn--disabled');
        // Whether a button has a handler cannot be read from the page of a production build
        // (Vuetify takes the handler as a prop): tests/unit/noStubs.test.ts proves that from
        // the source, for every button of every component. Here: what the user can see.
        // A control must say what it is: text, or a label or title for an icon.
        const name = (
          (el.textContent ?? '') +
          (el.getAttribute('aria-label') ?? '') +
          (el.getAttribute('title') ?? '')
        ).trim();
        if (name === '') stubs.push(label || '(unnamed)');
        // A control that cannot be used must say why: a title or description of its own,
        // or the row, panel, card or dialog it sits in.
        if (disabled) {
          const explained =
            (el.getAttribute('title') ?? '') !== '' ||
            el.hasAttribute('aria-describedby') ||
            el.closest('[title], .rr-row, .rr-panel, .v-card, .v-toolbar, .v-list-item') !== null;
          if (!explained) dead.push(label);
        }
      }
      const text = scope.document.body.innerText;
      const words =
        /not (yet )?implemented|coming soon|under construction|\bTODO\b|lorem ipsum/i.exec(text);
      return { count, stubs, dead, words: words ? words[0] : null };
    });
    controls += audit.count;
    for (const label of audit.stubs) findings.push(`${route}: "${label}" has no name`);
    for (const label of audit.dead) {
      if (`${route} ${label}` in DISABLED_FOR_NOW) continue;
      findings.push(`${route}: "${label}" is disabled with nothing to say why`);
    }
    if (audit.words) findings.push(`${route}: the page says "${audit.words}"`);
  }
  console.log(`  NFR-006 crawl: ${routes.length} routes, ${controls} visible controls`);
  expect(findings).toEqual([]);
  expect(controls).toBeGreaterThan(60);
  await go(page, '/configure/settings');
  await shot('last-route');
});

test('nfr: the window answers within 100 ms while a 10 s backup runs; the backup shows progress and can be cancelled', async ({
  rig,
}) => {
  test.setTimeout(180_000);
  const { page, shot, mutate, dataRoot } = await rig.launch('backup-dcs', 'nfr-long-backup');
  await page.getByTestId('mode-configure').click();
  const pages: [string, string][] = [
    ['/configure/devices', 'devices-page'],
    ['/configure/displays', 'displays-page'],
    ['/configure/profiles', 'profiles-page'],
    ['/configure/settings', 'settings-page'],
    ['/configure/backups', 'backups-page'],
  ];
  // Open each page once, so what is measured later is the app answering, not a first load.
  for (const [route, testId] of pages) {
    await go(page, route);
    await expect(page.getByTestId(testId)).toBeVisible();
  }
  // Track DCS's settings folder (as the Tracked files tab does), so there is something to back up.
  const tracked = await page.evaluate(() =>
    (
      globalThis as unknown as {
        rigready: { invoke(c: string, i: unknown): Promise<{ ok: boolean }> };
      }
    ).rigready.invoke('backup:saveItem', {
      scope: '@always',
      item: { label: 'DCS settings and bindings', path: '{DCS_USER}/Config', kind: 'folder' },
    })
  );
  expect(tracked.ok).toBe(true);
  await go(page, '/configure/settings');
  await go(page, '/configure/backups');
  await expect(page.getByTestId('backup-summary')).toContainText('1 tracked item');
  const summary = await page.getByTestId('backup-summary').innerText();
  const files = Number(/([\d,]+) files?/.exec(summary)?.[1]?.replace(/,/g, '') ?? 0);
  expect(files).toBeGreaterThan(10);
  // Slow enough that the whole backup takes ten seconds or more.
  const perFile = Math.ceil(10_000 / files);
  await mutate([{ op: 'slowFiles', ms: perFile }]);

  const started = Date.now();
  await page.getByTestId('backup-all').click();
  const progress = page.getByTestId('backup-progress');
  await expect(progress).toBeVisible();
  await expect(page.getByTestId('backup-progress-text')).toContainText(/\d+ of \d+/);
  const first = await page.getByTestId('backup-progress-text').innerText();
  await expect(page.getByTestId('backup-progress-text')).not.toHaveText(first);
  await shot('running');

  // Navigate while it runs, timed inside the page: from the click of a link to the page being there.
  const latency = (route: string, testId: string): Promise<number> =>
    page.evaluate(
      ([hash, id]) =>
        new Promise<number>((resolve) => {
          const scope = globalThis as unknown as {
            location: { hash: string };
            document: { querySelector(s: string): unknown };
            performance: { now(): number };
            requestAnimationFrame(fn: () => void): void;
          };
          const begun = scope.performance.now();
          scope.location.hash = hash as string;
          const look = (): void => {
            if (scope.document.querySelector(`[data-testid="${id}"]`)) {
              resolve(scope.performance.now() - begun);
            } else scope.requestAnimationFrame(look);
          };
          look();
        }),
      [`#${route}`, testId] as const
    );
  const timings: number[] = [];
  for (let round = 0; round < 2; round++) {
    for (const [route, testId] of pages.slice(0, 4)) {
      timings.push(await latency(route, testId));
    }
  }
  // Main answers too: the Devices page gets its data while the backup is being read.
  await go(page, '/configure/devices');
  await expect(page.getByTestId('devices-page')).toContainText('T-Pendular-Rudder');
  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(
    `  NFR-003: navigation while a ${perFile} ms/file backup of ${files} files runs: ${timings.map((t) => `${t.toFixed(0)} ms`).join(', ')}; median ${median.toFixed(0)} ms, worst ${sorted.at(-1)!.toFixed(0)} ms (limit 100 ms)`
  );
  expect(median).toBeLessThan(100);
  expect(sorted.at(-1)!).toBeLessThan(250);

  // Back on the page, the backup is still shown as running, further along.
  await go(page, '/configure/backups');
  await expect(page.getByTestId('backup-progress')).toBeVisible();
  await expect(page.getByTestId('backup-progress-text')).toContainText(/\d+ of \d+/);
  expect(Date.now() - started).toBeLessThan(10_000 + 60_000);
  await shot('still-running');

  // Cancel: it stops, says so, and nothing was written.
  await page.getByTestId('backup-cancel').click();
  await expect(page.getByTestId('backup-cancelled')).toHaveText(
    'The backup was cancelled. Nothing was written.'
  );
  await expect(page.getByTestId('backup-progress')).toHaveCount(0);
  await expect(page.getByTestId('backup-error')).toHaveCount(0);
  await expect(page.getByTestId('backup-row')).toHaveCount(0);
  const archives = await fs.readdir(path.join(dataRoot, 'backups')).catch(() => [] as string[]);
  expect(archives.filter((f) => f.endsWith('.zip'))).toEqual([]);
  await shot('cancelled');

  // At normal speed the same backup then runs to the end.
  await mutate([{ op: 'slowFiles', ms: 0 }]);
  await page.getByTestId('backup-all').click();
  await expect(page.getByTestId('backup-outcome-title')).toContainText('Backed up');
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await shot('backed-up');
});
