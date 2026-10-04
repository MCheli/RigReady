import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * Flying in one click (WOW-WIN-001): RigReady started with `--fly`, `--make-ready` or
 * `--setup`, cold and as a second start that hands over to the one already running. The
 * machine is the fake one of a scenario: what "launches" is a line in its process list.
 */

interface CommandView {
  run: {
    id: number;
    action: string;
    phase: string;
    outcome?: string;
    tone: string;
    headline: string;
    reasons: string[];
  } | null;
  /** Every program the fake machine was asked to start. */
  started: string[];
}

const command = (app: ElectronApplication): Promise<CommandView> =>
  app.evaluate(() =>
    (globalThis as unknown as { __rigreadyCommand(): CommandView }).__rigreadyCommand()
  );
const started = async (app: ElectronApplication): Promise<string[]> =>
  (await command(app)).started.map((exe) => path.win32.basename(exe));
const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);

const strip = (page: Page) => page.getByTestId('command-strip');
/**
 * A result that needs nothing more goes away by itself after some seconds, but not while
 * the pointer rests on it: the test keeps it there to read it, as a user would.
 */
const read = (page: Page): Promise<void> => strip(page).hover();
/** Scrolls an element to the middle of the window, clear of the page's sticky footer. */
const centre = (target: Locator): Promise<void> =>
  target.evaluate((el) => (el as unknown as ScrollTarget).scrollIntoView({ block: 'center' }));
interface ScrollTarget {
  scrollIntoView(options: { block: string }): void;
}

test('one click: --fly on a cold start arranges the monitors, starts TrackIR and launches', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('one-click-fly', 'one-click-fly', {
    args: ['--fly', 'DCS F/A-18C'],
  });
  // The command began with the app; the window shows where it has got to.
  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toHaveAttribute('data-phase', 'makingReady');
  await expect(page.getByTestId('command-headline')).toHaveText('Making DCS F/A-18C ready');
  // The monitor layout was applied and asks, as it always does.
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  expect(await started(app)).toEqual([]);
  await shot('keep-layout-asks');

  await page.getByTestId('keep-layout-keep').click();
  await expect(strip(page)).toHaveAttribute('data-outcome', 'launched');
  await read(page);
  await expect(page.getByTestId('command-headline')).toHaveText('Launched DCS.exe');
  await expect(strip(page)).toHaveAttribute('data-tone', 'ok');
  // TrackIR before the game, and nothing else.
  expect(await started(app)).toEqual(['TrackIR5.exe', 'DCS.exe']);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await shot('launched');
  expect(await axeViolations(page)).toEqual([]);
  expect(await colourOnlyStatus(page)).toEqual([]);

  // Put away by hand.
  await page.getByTestId('command-dismiss').click();
  await expect(strip(page)).toBeHidden();
});

test('one click: --fly stops in front of a required item that is not met, and says why', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('flying-pedals-unplugged', 'one-click-stopped', {
    args: ['--fly=dcs-f-a-18c'],
  });
  await expect(strip(page)).toHaveAttribute('data-outcome', 'stopped');
  await expect(strip(page)).toHaveAttribute('data-tone', 'bad');
  await expect(page.getByTestId('command-headline')).toHaveText(
    'DCS F/A-18C was not launched: 1 required item is not met'
  );
  await expect(page.getByTestId('command-reasons')).toContainText('T-Pendular-Rudder');
  // Nothing was launched, and the window is where the user can read it.
  expect(await started(app)).toEqual([]);
  expect(await windowVisible(app)).toBe(true);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('not-launched');
  expect(await axeViolations(page)).toEqual([]);
  expect(await colourOnlyStatus(page)).toEqual([]);
  // It stays until it is put away: it is the reason nothing happened.
  expect((await command(app)).run).toMatchObject({ outcome: 'stopped', action: 'fly' });
});

test('one click: an unknown setup opens the window and names the setups there are', async ({
  rig,
}) => {
  const { page, app, shot } = await rig.launch('fly-two-setups', 'one-click-unknown', {
    args: ['--fly', 'F-16C Viper'],
  });
  await expect(strip(page)).toHaveAttribute('data-outcome', 'stopped');
  await expect(page.getByTestId('command-headline')).toHaveText('There is no setup "F-16C Viper"');
  await expect(page.getByTestId('command-reasons')).toHaveText(
    'Setups on this PC: DCS F/A-18C, DCS UH-1H.'
  );
  await expect(strip(page)).toHaveAttribute('data-tone', 'warn');
  // The setup in use is still the one used last.
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  expect(await started(app)).toEqual([]);
  await shot('unknown-setup');
});

test('one click: "Do not launch" while Make ready is still working keeps the game from starting', async ({
  rig,
}) => {
  const { page, app, shot, mutate } = await rig.launch('one-click-slow-start', 'one-click-cancel', {
    args: ['--fly=one-click-slow'],
  });
  await expect(strip(page)).toHaveAttribute('data-phase', 'makingReady');
  await expect(page.getByTestId('command-step')).toContainText('TrackIR');
  await expect(page.getByTestId('command-step')).toContainText('0 of 1');
  await shot('making-ready');
  expect(await axeViolations(page)).toEqual([]);

  await page.getByTestId('command-cancel').click();
  await expect(page.getByTestId('command-headline')).toHaveText(
    'Making DCS F/A-18C evening ready. It will not be launched'
  );
  await expect(page.getByTestId('command-cancel')).toHaveCount(0);

  // TrackIR comes up at last: the rig is ready, and the game is still not started.
  await mutate([
    { op: 'failProcessStart', name: 'TrackIR5.exe', mode: 'off' },
    {
      op: 'startProcess',
      name: 'TrackIR5.exe',
      path: 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe',
    },
  ]);
  await expect(strip(page)).toHaveAttribute('data-outcome', 'cancelled');
  await read(page);
  await expect(page.getByTestId('command-headline')).toHaveText(
    'DCS F/A-18C evening is ready. Not launched, as you asked'
  );
  expect(await started(app)).toEqual(['TrackIR5.exe']);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('not-launched-as-asked');
});

test('one click: a second start hands over to the running RigReady, which comes forward and does it', async ({
  rig,
}) => {
  const run = await rig.launch('fly-two-setups', 'one-click-second-start');
  const { page, app, shot, mutate } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  // No command so far: nothing to show.
  expect((await command(app)).run).toBeNull();
  await expect(strip(page)).toHaveCount(0);

  // In the tray, window closed.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect.poll(() => windowVisible(app)).toBe(false);

  // --setup: the window comes forward on the other setup, and nothing else happens.
  expect(await run.secondStart(['--setup', 'DCS F/A-18C'])).toBe(0);
  await expect.poll(() => windowVisible(app)).toBe(true);
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect
    .poll(async () => (await command(app)).run)
    .toMatchObject({ action: 'select', outcome: 'selected', headline: 'Showing DCS F/A-18C' });
  expect(await started(app)).toEqual([]);

  // --make-ready from a Configure page: fixes, no launch, and a way back to the Fly screen.
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  await page.getByTestId('mode-configure').click();
  await expect(page.getByTestId('profiles-page')).toBeVisible();
  expect(await run.secondStart(['--make-ready=dcs-f-a-18c'])).toBe(0);
  await expect(strip(page)).toHaveAttribute('data-outcome', 'ready');
  await read(page);
  await expect(page.getByTestId('command-headline')).toHaveText('DCS F/A-18C is ready');
  expect(await started(app)).toEqual(['TrackIR5.exe']);
  await shot('made-ready-from-a-second-start');
  await page.getByTestId('command-open-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('command-open-fly')).toHaveCount(0);

  // --fly: launches, and the window gets out of the way as after any launch.
  expect(await run.secondStart(['--fly=dcs-f-a-18c'])).toBe(0);
  await expect.poll(() => started(app)).toEqual(['TrackIR5.exe', 'DCS.exe']);
  await expect.poll(() => windowVisible(app)).toBe(false);
  expect((await command(app)).run).toMatchObject({
    action: 'fly',
    outcome: 'launched',
    headline: 'Launched DCS.exe',
  });
});

interface BuiltLink {
  target: string;
  args: string[];
  description?: string;
}
const shortcuts = (app: ElectronApplication): Promise<BuiltLink[]> =>
  app.evaluate(() =>
    (globalThis as unknown as { __rigreadyShortcuts(): BuiltLink[] }).__rigreadyShortcuts()
  );

test('one click: a desktop shortcut is made in the setup editor, flies when it is started, and is removed again', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'one-click-shortcut');
  const { page, app, shot, home, mutate } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const file = path.join(home, 'Desktop', 'DCS F-A-18C - RigReady.lnk');

  await page.getByTestId('mode-configure').click();
  await page.getByTestId('profile-edit').first().click();
  const panel = page.getByTestId('edit-shortcut');
  await centre(panel);
  await expect(panel).toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('shortcut-state')).toHaveText('Not on the desktop yet.');
  await expect(page.getByTestId('shortcut-file')).toHaveText(file);
  await shot('not-on-the-desktop-yet');

  // Shown first: the one file that will be written, and where.
  await page.getByTestId('shortcut-create').click();
  await expect(page.getByTestId('shortcut-confirm')).toBeVisible();
  await expect(page.getByTestId('change-preview-summary')).toHaveText('1 file created');
  await expect(page.getByTestId('change-preview-file')).toContainText('DCS F-A-18C - RigReady.lnk');
  expect(existsSync(file)).toBe(false);
  await shot('shown-first');
  expect(await axeViolations(page)).toEqual([]);

  await page.getByTestId('shortcut-go').click();
  await expect(panel).toHaveAttribute('data-state', 'current');
  await expect(page.getByTestId('shortcut-state')).toHaveText(
    'On the desktop: DCS F-A-18C - RigReady.lnk'
  );
  expect(existsSync(file)).toBe(true);
  await centre(panel);
  await shot('on-the-desktop');
  expect(await axeViolations(page)).toEqual([]);
  expect(await colourOnlyStatus(page)).toEqual([]);

  // What the fake machine was asked to make: this RigReady, asked to fly this setup by id.
  const [link] = await shortcuts(app);
  expect(link).toMatchObject({
    args: ['--fly=dcs-f-a-18c'],
    description: 'Make the rig ready for DCS F/A-18C and launch it',
  });
  expect(path.win32.basename(link!.target)).toBe('RigReady.exe');

  // A name that is not saved yet cannot go on a shortcut: the panel says so.
  await page.getByTestId('edit-name').locator('input').fill('Hornet evening');
  await expect(page.getByTestId('shortcut-blocked')).toHaveText(
    'Save the setup first: the shortcut takes its name from the setup.'
  );
  await expect(page.getByTestId('shortcut-remove')).toBeDisabled();
  await page.getByTestId('edit-name').locator('input').fill('DCS F/A-18C');
  await expect(page.getByTestId('shortcut-blocked')).toHaveCount(0);

  // The change is on the Safety page like any other, with Undo.
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('change-group').first()).toContainText(
    'Create a desktop shortcut for "DCS F/A-18C"'
  );
  await shot('on-the-safety-page');

  // Double-clicking it is a second start with the shortcut's own arguments.
  await mutate([{ op: 'stopProcess', name: 'TrackIR5.exe' }]);
  expect(await run.secondStart(link!.args)).toBe(0);
  await expect.poll(() => started(app)).toEqual(['TrackIR5.exe', 'DCS.exe']);
  await expect.poll(async () => (await command(app)).run?.outcome).toBe('launched');
  // After the launch the window got out of the way; back to the editor.
  await expect.poll(() => windowVisible(app)).toBe(false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
  await expect.poll(() => windowVisible(app)).toBe(true);

  // Removed again, shown first, and the file is gone.
  await page.getByTestId('nav-profiles').click();
  await page.getByTestId('profile-edit').first().click();
  await expect(panel).toHaveAttribute('data-state', 'current');
  await page.getByTestId('shortcut-remove').click();
  await expect(page.getByTestId('change-preview-summary')).toHaveText('1 file deleted');
  await page.getByTestId('shortcut-go').click();
  await expect(panel).toHaveAttribute('data-state', 'none');
  await expect(page.getByTestId('shortcut-done')).toHaveText(
    'The shortcut was removed from the desktop.'
  );
  expect(existsSync(file)).toBe(false);
});
