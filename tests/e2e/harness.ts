import {
  test as base,
  _electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * End-to-end harness. Every launch is isolated: USERPROFILE, APPDATA, LOCALAPPDATA and
 * RIGREADY_HOME all point into a fresh temp directory (Electron crashes if only
 * USERPROFILE is redirected), and the app runs on fixture-backed providers through
 * RIGREADY_SCENARIO. Nothing touches the real profile or the real hardware.
 *
 *   test('pedals unplugged', async ({ rig }) => {
 *     const { page, shot } = await rig.launch('flying-pedals-unplugged', 'fly-pedals-unplugged');
 *     await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
 *     await shot('not-ready');   // artifacts/screens/fly-pedals-unplugged/01-not-ready.png
 *   });
 */

export const repoRoot = path.resolve(__dirname, '..', '..');
export const screensDir = path.join(repoRoot, 'artifacts', 'screens');

export interface IsolatedEnv {
  /** The temp directory everything lives in. */
  root: string;
  dataRoot: string;
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

/** A fresh, empty user profile in a temp directory, and the environment that points at it. */
export async function isolatedEnv(extra: Record<string, string> = {}): Promise<IsolatedEnv> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-e2e-'));
  const user = path.join(root, 'user');
  const dataRoot = path.join(root, 'rigready');
  const appData = path.join(user, 'AppData', 'Roaming');
  const localAppData = path.join(user, 'AppData', 'Local');
  for (const dir of [appData, localAppData, dataRoot]) await fs.mkdir(dir, { recursive: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['RIGREADY_SCENARIO'];
  Object.assign(env, {
    USERPROFILE: user,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    RIGREADY_HOME: dataRoot,
    ...extra,
  });
  return {
    root,
    dataRoot,
    env,
    cleanup: async () => {
      // The app may still be releasing its log file for a moment after exit.
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

export const scenarioFile = (name: string): string =>
  path.join(repoRoot, 'fixtures', 'scenarios', `${name}.yaml`);

export interface RunningApp {
  app: ElectronApplication;
  page: Page;
  dataRoot: string;
  /** Saves artifacts/screens/<flow>/<nn>-<name>.png (numbered in call order). */
  shot(name: string): Promise<string>;
}

export interface Rig {
  /**
   * Starts the built app on a named scenario (fixtures/scenarios/<scenario>.yaml).
   * `flow` names the screenshot folder under artifacts/screens/.
   */
  launch(scenario: string, flow: string): Promise<RunningApp>;
}

export interface HarnessOptions {
  /** Packaged executable to run instead of the dev build (packaged smoke test). */
  executablePath: string | undefined;
}

export const test = base.extend<{ rig: Rig } & HarnessOptions>({
  executablePath: [undefined, { option: true }],

  rig: async ({ executablePath }, use, testInfo) => {
    const started: { app: ElectronApplication; isolated: IsolatedEnv; page: Page }[] = [];

    const rig: Rig = {
      async launch(scenario, flow) {
        const isolated = await isolatedEnv({ RIGREADY_SCENARIO: scenarioFile(scenario) });
        const app = await _electron.launch({
          ...(executablePath ? { executablePath, args: [] } : { args: [repoRoot] }),
          env: isolated.env,
        });
        const page = await app.firstWindow();
        started.push({ app, isolated, page });
        await page.waitForLoadState('domcontentloaded');
        // Every scenario run says so on screen; this also proves the app is on fake providers.
        await expect(page.getByTestId('scenario-banner')).toBeVisible();

        const dir = path.join(screensDir, flow);
        await fs.rm(dir, { recursive: true, force: true });
        await fs.mkdir(dir, { recursive: true });
        let count = 0;
        return {
          app,
          page,
          dataRoot: isolated.dataRoot,
          async shot(name) {
            count++;
            const file = path.join(dir, `${String(count).padStart(2, '0')}-${name}.png`);
            // Let fonts load and every running transition finish, so dialogs are fully shown.
            await page.evaluate('document.fonts.ready');
            await page.evaluate(
              'Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined)))'
            );
            await page.screenshot({ path: file });
            return file;
          },
        };
      },
    };

    await use(rig);

    for (const { app, isolated, page } of started) {
      if (testInfo.status !== testInfo.expectedStatus) {
        await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined);
      }
      await app.close().catch(() => undefined);
      await isolated.cleanup().catch(() => undefined);
    }
  },
});

export { expect };

/** The checklist row for a check title. */
export const checkRow = (page: Page, title: string) =>
  page.locator(`[data-testid="check-row"][data-title="${title}"]`);
