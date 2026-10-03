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
import type { InputState } from '../../src/shared/models';

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
  /** The fake user folder: Saved Games, Documents, AppData, Program Files (x86)\Steam, ... */
  home: string;
  /** Saves artifacts/screens/<flow>/<nn>-<name>.png (numbered in call order). */
  shot(name: string): Promise<string>;
  /**
   * Changes the fake machine while the app runs, with the same mutations a scenario file
   * uses: await mutate([{ op: 'unplugDevice', match: { productId: 'B68F' } }]).
   */
  mutate(mutations: unknown[]): Promise<void>;
  /** Delivers controller input as if the user moved or pressed something. */
  sendInput(states: InputState[]): Promise<void>;
  /**
   * Changes files below the fake user folder through FileStore as one journaled action,
   * the way a feature would, so the change shows up on the Safety page.
   */
  changeFiles(reason: string, files: { path: string; content: string }[]): Promise<void>;
  /** Shows the real Identify labels on the monitors for a moment. */
  showLabels(
    items: {
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      caption?: string;
    }[],
    durationMs: number
  ): Promise<void>;
  /** Renders HTML with the real Render port and reports the size of what came back. */
  render(
    html: string,
    size: { width: number; height: number }
  ): Promise<{
    pngBytes: number;
    pngWidth: number;
    pngHeight: number;
    pdfBytes: number;
    pdfHeader: string;
  }>;
  /**
   * Quits the app and starts it again on the same data root and fake user folder, as a
   * user would. The returned page replaces the old one; screenshots keep counting.
   */
  restart(): Promise<RunningApp>;
}

export interface LaunchOptions {
  /** Extra environment variables for the app. */
  env?: Record<string, string>;
  /**
   * What the native file pickers return, one entry per call (relative paths are below
   * the fake user folder): { open: [['Documents/setup.rigready']], save: ['Documents/out.zip'] }.
   */
  dialogs?: { open?: string[][]; save?: (string | null)[] };
}

export interface Rig {
  /**
   * Starts the built app on a named scenario (fixtures/scenarios/<scenario>.yaml).
   * `flow` names the screenshot folder under artifacts/screens/.
   */
  launch(scenario: string, flow: string, options?: LaunchOptions): Promise<RunningApp>;
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
      async launch(scenario, flow, options = {}) {
        const isolated = await isolatedEnv({
          RIGREADY_SCENARIO: scenarioFile(scenario),
          ...(options.dialogs?.open
            ? { RIGREADY_DIALOG_OPEN: JSON.stringify(options.dialogs.open) }
            : {}),
          ...(options.dialogs?.save
            ? { RIGREADY_DIALOG_SAVE: JSON.stringify(options.dialogs.save) }
            : {}),
          ...options.env,
        });
        const dir = path.join(screensDir, flow);
        await fs.rm(dir, { recursive: true, force: true });
        await fs.mkdir(dir, { recursive: true });
        let count = 0;

        const open = async (): Promise<RunningApp> => {
          const app = await _electron.launch({
            ...(executablePath ? { executablePath, args: [] } : { args: [repoRoot] }),
            env: isolated.env,
          });
          const page = await app.firstWindow();
          const entry = { app, isolated, page };
          started.push(entry);
          await page.waitForLoadState('domcontentloaded');
          // Every scenario run says so on screen; this also proves the app is on fake providers.
          await expect(page.getByTestId('scenario-banner')).toBeVisible();

          const scenarioCall = async (input: unknown): Promise<Record<string, unknown>> => {
            const result = (await page.evaluate(
              (payload) =>
                (
                  globalThis as unknown as {
                    rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
                  }
                ).rigready.invoke('app:scenario', payload),
              input
            )) as {
              ok: boolean;
              value?: Record<string, unknown>;
              error?: { message: string; detail?: string };
            };
            if (!result.ok) {
              throw new Error(
                `scenario change failed: ${result.error?.message} ${result.error?.detail ?? ''}`
              );
            }
            return result.value ?? {};
          };

          return {
            app,
            page,
            dataRoot: isolated.dataRoot,
            home: path.join(isolated.root, 'scenario-home'),
            async shot(name) {
              count++;
              const file = path.join(dir, `${String(count).padStart(2, '0')}-${name}.png`);
              // Let fonts load and every running transition finish, so dialogs are fully shown.
              await page.evaluate('document.fonts.ready');
              // A dialog starts its own animation a couple of frames after it is mounted, so
              // "nothing is animating" only counts once it has held for a few frames.
              await page.evaluate(`(async () => {
                const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
                const running = () =>
                  document
                    .getAnimations()
                    .filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity)
                    .filter((a) => a.playState !== 'finished' && a.playState !== 'idle');
                for (let round = 0; round < 40; round++) {
                  const now = running();
                  if (now.length > 0) {
                    await Promise.all(now.map((a) => a.finished.catch(() => undefined)));
                    continue;
                  }
                  await frame();
                  await frame();
                  await frame();
                  if (running().length === 0) return;
                }
              })()`);
              await page.screenshot({ path: file });
              return file;
            },
            mutate: async (mutations) => void (await scenarioCall({ mutations })),
            sendInput: async (states) => void (await scenarioCall({ input: states })),
            changeFiles: async (reason, files) =>
              void (await scenarioCall({ change: { reason, files } })),
            showLabels: async (items, durationMs) =>
              void (await scenarioCall({ labels: { items, durationMs } })),
            render: async (html, size) =>
              (await scenarioCall({ render: { html, ...size } }))['render'] as never,
            async restart() {
              await app.close();
              started.splice(started.indexOf(entry), 1);
              return open();
            },
          };
        };
        return open();
      },
    };

    await use(rig);

    const roots = new Set<IsolatedEnv>();
    for (const { app, isolated, page } of started) {
      if (testInfo.status !== testInfo.expectedStatus) {
        await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined);
      }
      await app.close().catch(() => undefined);
      roots.add(isolated);
    }
    for (const isolated of roots) await isolated.cleanup().catch(() => undefined);
  },
});

export { expect };

/** The checklist row for a check title. */
export const checkRow = (page: Page, title: string) =>
  page.locator(`[data-testid="check-row"][data-title="${title}"]`);
