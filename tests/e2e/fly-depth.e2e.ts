import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Fly mode in depth: switching, single checks, fixes, Make ready, launch steps, timing. */

const showWindow = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
const windowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);

test('fly: opens on the setup used last, switches in one click, broken files cannot be picked, the choice survives a restart', async ({
  rig,
}) => {
  const run = await rig.launch('fly-two-setups', 'fly-switch');
  const { page, shot } = run;
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('group-files')).toContainText('1 of 1 OK');
  await shot('uh-1h');

  await page.getByTestId('profile-switcher').click();
  const items = page.getByTestId('switcher-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('DCS F/A-18C');
  await expect(items.nth(0)).toContainText(/DCS World · used (Sep \d+|\d+ Sep)/);
  await expect(items.nth(1)).toContainText('DCS UH-1H');
  const broken = page.getByTestId('switcher-invalid');
  await expect(broken).toContainText('broken');
  await expect(broken).toContainText('Cannot be opened');
  await expect(broken).toHaveAttribute('aria-disabled', 'true');
  await broken.hover();
  await expect(
    page.getByRole('tooltip').filter({ hasText: 'The profile file broken.yaml is not valid.' })
  ).toBeVisible();
  await shot('switcher-open');

  await items.nth(0).click();
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('group-devices')).toContainText('12 of 12 OK');
  await expect(page.getByTestId('group-apps')).toContainText('3 of 3 OK');
  await expect(page.getByTestId('group-files')).toHaveCount(0);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('switched');

  const again = await run.restart();
  await expect(again.page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(again.page.getByTestId('fly-status-title')).toHaveText('Ready');
});

test('fly: when the setup used last no longer opens, it opens on another with a one-line notice', async ({
  rig,
}) => {
  const run = await rig.launch('fly-two-setups', 'fly-fallback');
  await expect(run.page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  // Broken by a hand edit while RigReady was closed.
  await fs.writeFile(path.join(run.dataRoot, 'profiles', 'fly-dcs-uh-1h.yaml'), 'name: [oops');
  const again = await run.restart();
  const { page, shot } = again;
  await expect(page.getByTestId('fly-notice')).toHaveText(
    'The setup you used last ("fly-dcs-uh-1h") could not be opened: The profile file fly-dcs-uh-1h.yaml is not valid YAML. Showing "DCS F/A-18C" instead.'
  );
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('fallback');
});

test('fly: one item is checked again on its own; the others keep their time', async ({ rig }) => {
  const { page, shot, mutate } = await rig.launch('flying-trackir-not-running', 'fly-recheck');
  const trackir = checkRow(page, 'TrackIR5');
  await expect(trackir).toHaveAttribute('data-status', 'fail');
  const simAppPro = checkRow(page, 'SimAppPro');
  const before = await simAppPro.getAttribute('data-checked-at');
  const trackirBefore = await trackir.getAttribute('data-checked-at');
  expect(before).toBeTruthy();
  await trackir.getByTestId('check-recheck').click();
  await expect(trackir).not.toHaveAttribute('data-checked-at', trackirBefore!);
  // Only that item was checked again.
  expect(await simAppPro.getAttribute('data-checked-at')).toBe(before);
  await expect(trackir).toHaveAttribute('data-status', 'fail');
  await shot('rechecked-one');

  // Re-check all runs every item again.
  const all = await page
    .getByTestId('check-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-checked-at')));
  await page.getByTestId('recheck').click();
  await expect(simAppPro).not.toHaveAttribute('data-checked-at', before!);
  const after = await page
    .getByTestId('check-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-checked-at')));
  expect(after.every((at, i) => at !== all[i])).toBe(true);

  // TrackIR is started by hand; checking it again shows it running. The group stays open.
  await page.getByTestId('group-toggle-apps').click();
  await page.getByTestId('group-toggle-apps').click();
  await mutate([
    {
      op: 'startProcess',
      name: 'TrackIR5.exe',
      path: 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe',
    },
  ]);
  await trackir.getByTestId('check-recheck').click();
  await expect(trackir).toHaveAttribute('data-status', 'pass');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('started-by-hand');
});

test('fly: a required device unplugged while the screen is open turns red on its own', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-all-good', 'fly-live-devices');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(checkRow(page, 'T-Pendular-Rudder')).toHaveAttribute('data-status', 'fail', {
    timeout: 2000,
  });
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('unplugged');
});

test('fly: Make ready fixes monitors, files and apps in that order, and ends Ready', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('fly-make-ready-all', 'fly-make-ready-all');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(page.getByTestId('fly-status-count')).toHaveText('(4)');
  await expect(checkRow(page, 'DCS options').getByTestId('check-fix')).toHaveText(
    /Restore options.lua from the copy you saved of 2026-10-01 \d\d:00/
  );
  // The full Hornet setup has a check of every kind: all five groups are on the screen,
  // in their fixed order, the passing ones folded to one line.
  await expect(page.locator('section.fly-group h2')).toHaveText([
    'Devices connected',
    'Apps and services',
    'Monitors',
    'Audio',
    'Config files',
  ]);
  await expect(page.getByTestId('group-audio')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('group-devices')).toContainText('3 of 3 OK');
  await shot('four-problems');

  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  // The monitors are done first.
  await expect(page.locator('[data-testid="fly-activity"] .fly-entry').first()).toContainText(
    'Monitor layout'
  );
  await shot('keep-prompt');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity-headline')).toHaveText('4 of 4 fixes worked');
  const entries = page.locator('[data-testid="fly-activity"] .fly-entry .rr-row-sub');
  await expect(entries).toHaveText(['Monitor layout', 'DCS options', 'SimAppPro', 'TrackIR']);
  await shot('ready');
});

test('fly: a fix that does not bring the app up leaves it red and says so', async ({ rig }) => {
  test.setTimeout(60_000);
  const { page, shot } = await rig.launch('fly-trackir-refused', 'fly-fix-verified');
  const trackir = checkRow(page, 'TrackIR');
  await expect(trackir).toHaveAttribute('data-status', 'fail');
  await trackir.getByTestId('check-fix').click();
  // Working on it: the button spins and cannot be pressed twice.
  await expect(trackir.getByTestId('check-fix')).toBeDisabled();
  await shot('fixing');
  await expect(trackir.getByTestId('fix-result')).toHaveText(
    'Started TrackIRLauncher.exe but TrackIR5.exe is not running after 10 s',
    { timeout: 20_000 }
  );
  await expect(trackir).toHaveAttribute('data-status', 'fail');
  // The way out: the setup editor, where the program can be put right.
  await expect(trackir.getByTestId('fix-edit-setup')).toHaveAttribute(
    'href',
    /#?\/configure\/profiles\/fly-trackir-launcher$/
  );
  await shot('still-red');
});

test('fly: services, config files, scripts and the game version, with instructions, confirmations and Mark verified', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('fly-generic-checks', 'fly-generic-checks');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(checkRow(page, 'HidHide service')).toHaveAttribute('data-status', 'pass');
  const srs = checkRow(page, 'DCS-SRS server');
  await expect(srs).toHaveAttribute('data-status', 'fail');
  await expect(srs).toContainText('Not installed');
  const content = checkRow(page, 'MFDs export in options.lua');
  await expect(content).toContainText('multiMonitorSetup is wwtMonitor, expected RigReady MFDs');
  await expect(content.getByTestId('check-fix')).toHaveText('Run set-mfds.cmd');
  const monitorSetup = checkRow(page, 'RigReady monitor setup');
  await expect(monitorSetup).toHaveAttribute('data-status', 'warn');
  await expect(monitorSetup).toContainText('No backup of this file yet');
  await expect(monitorSetup.getByTestId('check-fix')).toHaveCount(0);
  const script = checkRow(page, 'SRS radio check');
  await expect(script).toContainText('Exit code 2');
  await script.getByTestId('check-output-toggle').click();
  await expect(script.getByTestId('check-output')).toContainText(
    'SRS server not reachable on port 5002'
  );
  const game = checkRow(page, 'DCS not updated since verified');
  await expect(game).toHaveAttribute('data-status', 'warn');
  await expect(game).toContainText(
    'DCS World updated Steam build 25000000 -> Steam build 25625823 since you last verified'
  );
  // From a newer RigReady: an unknown check type is an error, an unknown fix offers no button.
  const unknown = checkRow(page, 'Backlight in sync');
  await expect(unknown).toHaveAttribute('data-status', 'error');
  await expect(unknown).toContainText(
    'Check type "winwing.backlight" is not available in this version of RigReady.'
  );
  const fanatec = checkRow(page, 'Fanatec service');
  await expect(fanatec).toHaveAttribute('data-status', 'warn');
  await expect(fanatec.getByTestId('check-fix')).toHaveCount(0);
  await srs.getByTestId('check-instructions').click();
  await expect(srs.getByTestId('instructions')).toContainText('tick Install server as a service');
  await shot('every-kind');
  await unknown.scrollIntoViewIfNeeded();
  await shot('script-output-and-error');

  // A link in instructions opens only after asking.
  await srs
    .getByTestId('instructions')
    .getByRole('link', { name: 'the SRS releases page' })
    .click();
  await expect(page.getByTestId('open-link')).toContainText(
    'https://github.com/ciribob/DCS-SimpleRadioStandalone/releases'
  );
  await page.getByTestId('open-link').getByRole('button', { name: 'Cancel' }).click();

  // The version check: confirm it, and it turns green.
  await game.getByTestId('check-acknowledge').click();
  await expect(game).toHaveAttribute('data-status', 'pass');
  await expect(game).toContainText('DCS World Steam build 25625823, verified');

  // A fix that runs a program shows exactly what will run first.
  await content.getByTestId('check-fix').click();
  await expect(page.getByTestId('confirm-run')).toBeVisible();
  await expect(page.getByTestId('confirm-run-exe')).toHaveText('{USER}/Scripts/set-mfds.cmd');
  await expect(page.getByTestId('confirm-run-arg')).toHaveText([
    '--monitor-setup',
    'RigReady MFDs',
  ]);
  await shot('confirm-run');
  await page.getByTestId('confirm-run-skip').click();
  await expect(page.getByTestId('confirm-run')).toHaveCount(0);
  await expect(content.getByTestId('fix-result')).toHaveCount(0);

  // Make ready asks the same; declined, it is "skipped by you", and the rest is listed for you.
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('confirm-run')).toBeVisible();
  await page.getByTestId('confirm-run-skip').click();
  await expect(page.getByTestId('step-skipped')).toContainText('Skipped by you');
  const needs = page.getByTestId('needs-you');
  await expect(needs).toHaveCount(6);
  await expect(needs.first()).toContainText('DCS-SRS server');
  await expect(needs.first()).toContainText('Download DCS-SRS');
  await shot('needs-you');

  // Approved, it runs, and is honest that the check still fails afterwards.
  await page.getByTestId('make-ready').click();
  await page.getByTestId('confirm-run-ok').click();
  await expect(page.getByTestId('step-failed')).toContainText(
    'Ran set-mfds.cmd, but the check still fails: multiMonitorSetup is wwtMonitor, expected RigReady MFDs'
  );
  await shot('ran-but-still-failing');
});

test('fly: steps before and after launch; a step that must not fail pauses with Launch anyway; Stand down closes what they started', async ({
  rig,
}) => {
  const { page, shot, app } = await rig.launch('fly-actions', 'fly-launch-actions');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('fly-more').click();
  await page.getByTestId('fly-minimize-pref').click();
  await page.keyboard.press('Escape');

  await page.getByTestId('launch').click();
  const paused = page.getByTestId('launch-paused');
  await expect(paused).toContainText(
    '"Check TrackIR answers" failed: check-trackir.cmd exited with code 1'
  );
  await expect(paused).toContainText('TrackIR did not answer within 5 s');
  await shot('paused');
  // Cancel: the game is not started.
  await page.getByTestId('paused-cancel').click();
  await expect(page.getByTestId('fly-activity')).not.toContainText('Launched');

  await page.getByTestId('launch').click();
  await page.getByTestId('paused-launch').click();
  const activity = page.getByTestId('fly-activity');
  await expect(activity).toContainText('Launched DCS.exe');
  await expect(activity).toContainText('Started VoiceAttack.exe');
  await expect(activity).toContainText('Ran warmup.cmd');
  await expect(activity).toContainText('Started SR-ClientRadio.exe');
  await expect(page.locator('[data-testid="fly-activity"] .fly-entry .rr-row-sub')).toHaveText([
    'Before launch · Start VoiceAttack',
    'Before launch · Warm up the hub',
    'Before launch · Check TrackIR answers',
    'Game · DCS with launch steps',
    'After launch · Start SRS',
  ]);
  expect(await windowVisible(app)).toBe(true);
  await shot('launched');

  // The game is still running: Stand down asks before touching it.
  await page.getByTestId('stand-down').click();
  await expect(page.getByTestId('game-running')).toContainText('DCS.exe is still running');
  await shot('game-running');
  await page.getByTestId('game-leave').click();
  await expect(page.getByTestId('fly-activity-headline')).toHaveText('Closed 2 apps');
  await expect(activity).toContainText('Closed VoiceAttack.exe');
  await expect(activity).toContainText('Closed SR-ClientRadio.exe');
  await expect(activity).toContainText('Ran warmup.cmd');
  await expect(activity).not.toContainText('Closed DCS.exe');
  await shot('stood-down');
});

test('fly: hidden after a launch by default, and back from the tray', async ({ rig }) => {
  const { page, app } = await rig.launch('flying-all-good', 'fly-launch-hides');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('launch').click();
  await expect.poll(() => windowVisible(app)).toBe(false);
  await app.evaluate(async () => {
    await (
      globalThis as unknown as { __rigreadyTrayClick(id: string): Promise<void> }
    ).__rigreadyTrayClick('open');
  });
  await expect.poll(() => windowVisible(app)).toBe(true);
  await showWindow(app);
  await expect(page.getByTestId('fly-activity')).toContainText('Launched DCS.exe');
});

// A wall-clock measurement of a whole process start: on a machine busy with other work
// (another test run, a build) one start can take longer than the app needs. The budget
// stays two seconds; the measurement is taken again, up to three times, before it counts
// as a failure. The packaged smoke measures the same on the build users get.
test.describe('startup time', () => {
  test.describe.configure({ retries: 2 });
  test('fly: usable within two seconds of starting', async ({ rig }) => {
    const started = Date.now();
    const { page, shot } = await rig.launch('flying-all-good', 'fly-startup-time');
    await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
    await expect(page.getByTestId('group-devices')).toBeVisible();
    await expect(page.getByTestId('launch')).toBeEnabled();
    const usable = Date.now() - started;
    console.log(`fly: usable ${usable} ms after process start`);
    test.info().annotations.push({ type: 'fly-usable-ms', description: String(usable) });
    expect(usable).toBeLessThan(2000);
    await shot('usable');
  });
});

test('fly: the Fly screen is one page with its own controls', async ({ rig }) => {
  const { page, shot } = await rig.launch('flying-optional-missing', 'fly');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  await expect(page.getByTestId('configure-nav')).toHaveCount(0);
  for (const id of [
    'profile-switcher',
    'fly-status',
    'make-ready',
    'launch',
    'recheck',
    'stand-down',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await shot('fly');
});

test('configure: one switch to Configure and back; the app starts in Fly', async ({ rig }) => {
  const run = await rig.launch('flying-optional-missing', 'configure');
  const { page, shot } = run;
  await expect(page.getByTestId('fly-page')).toBeVisible();
  await page.getByTestId('mode-configure').click();
  await expect(page.getByTestId('configure-nav')).toBeVisible();
  await expect(page.getByTestId('fly-page')).toHaveCount(0);
  await shot('configure');
  const again = await run.restart();
  await expect(again.page.getByTestId('fly-page')).toBeVisible();
  await again.page.getByTestId('mode-configure').click();
  await again.page.getByTestId('mode-fly').click();
  await expect(again.page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
});

test('fly: Stand down applies the desk layout chosen in Settings, with the keep prompt', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('desk-mfds-wrong', 'fly-stand-down-desk');
  // At the desk: save this arrangement as the desk layout.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('layout-new-name').locator('input').fill('Desk');
  await page.getByTestId('layout-save-current').click();
  await page.getByTestId('setting-desk-layout').click();
  await page.getByRole('option', { name: 'Desk' }).click();
  await expect(page.getByTestId('layout-row')).toContainText('desk layout');

  // Fly, then stand down.
  await page.getByTestId('mode-fly').click();
  await page.getByTestId('make-ready').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.getByTestId('stand-down').click();
  // The desk layout is applied, and Stand down waits for the answer before it reports.
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await shot('desk-applied');
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Applied desk layout "Desk"');
  await expect(checkRow(page, 'Monitor layout')).toContainText('DELL G3223D is on, expected off');
  await shot('at-the-desk');
});

test('fly: a path whose game folder is not on this PC is an error, not "Missing"', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('fly-two-setups', 'fly-path-variable');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await mutate([{ op: 'removeFile', path: 'Saved Games/DCS' }]);
  const options = checkRow(page, 'DCS options');
  await expect(options).toHaveAttribute('data-status', 'error');
  await expect(options).toContainText('DCS user folder not found');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('variable-missing');
});

test('fly: Start SimAppPro from its row turns it green', async ({ rig }) => {
  const { page, shot, mutate } = await rig.launch('flying-all-good', 'fly-start-app');
  await mutate([{ op: 'stopProcess', name: 'SimAppPro.exe' }]);
  const row = checkRow(page, 'SimAppPro');
  await expect(row).toHaveAttribute('data-status', 'fail');
  await expect(row.getByTestId('check-fix')).toHaveText('Start SimAppPro.exe');
  await shot('not-running');
  await page.getByTestId('group-toggle-apps').click();
  await page.getByTestId('group-toggle-apps').click();
  await row.getByTestId('check-fix').click();
  await expect(row.getByTestId('fix-result')).toHaveText('Started SimAppPro.exe');
  await expect(row).toHaveAttribute('data-status', 'pass');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('started');
});
