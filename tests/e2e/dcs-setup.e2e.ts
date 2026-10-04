import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** DCS World setup without SimAppPro: overview, screens, Export.lua, options.lua, SimAppPro checks. */

const openDcs = async (page: Page, tab?: 'screens' | 'export' | 'simapppro'): Promise<void> => {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-dcs').click();
  if (tab) await page.getByTestId(`dcs-tab-${tab}`).click();
};

const dcsFile = (home: string, ...parts: string[]): string =>
  path.join(home, 'Saved Games', 'DCS', ...parts);

async function chooseProfile(page: Page, name: string): Promise<void> {
  await page.getByTestId('profile-switcher').click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByTestId('profile-switcher')).toContainText(name);
}

test('dcs-setup: the overview shows install, version, screens, Export.lua, SimAppPro and aircraft', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-setup-overview');
  const { page, shot } = run;
  await openDcs(page);
  await expect(page.getByTestId('dcs-version')).toContainText('Steam build 25625823');
  await expect(page.getByTestId('dcs-card-install')).toContainText('Up to date');
  await expect(page.getByTestId('dcs-card-install')).toContainText('2.9.28.26283 on 2026-07-26');
  await expect(page.getByTestId('dcs-screens-status')).toContainText('Fits the monitors');
  await expect(page.getByTestId('dcs-card-screens')).toContainText('made by SimAppPro');
  await expect(page.getByTestId('dcs-card-export')).toContainText('DCS-BIOS');
  await expect(page.getByTestId('dcs-needs-export-script')).toBeVisible();
  await expect(page.getByTestId('dcs-card-simapppro')).toContainText('1.16.91');
  await expect(
    page.locator('[data-testid="dcs-aircraft"][data-unit="FA-18C_hornet"]')
  ).toContainText('bindings');
  await shot('overview');
  // Aircraft with bindings come first; the rest are one click away.
  await expect(page.getByTestId('dcs-aircraft')).toHaveCount(12);
  await page.getByTestId('dcs-aircraft-more').click();
  await expect(page.locator('[data-testid="dcs-aircraft"][data-unit="UH-1H"]')).toContainText(
    'UH-1H Huey'
  );
  await page.getByTestId('dcs-card-aircraft').scrollIntoViewIfNeeded();
  await shot('aircraft');
  await page.getByTestId('dcs-card-install').scrollIntoViewIfNeeded();

  // Remember this version as working; a Steam update then shows up as a change.
  await page.getByTestId('dcs-mark-verified').click();
  await expect(page.getByTestId('dcs-message')).toContainText(
    'Remembered Steam build 25625823 as working'
  );
  await expect(page.getByTestId('dcs-mark-verified')).toHaveCount(0);
  await expect(page.getByTestId('dcs-card-install')).toContainText('Confirmed working');
  // Steam queues an update and the build moves on.
  await run.mutate([
    {
      op: 'setSteamBuild',
      appId: '223750',
      buildId: '25700000',
      stateFlags: 6,
      targetBuildId: '25800000',
    },
  ]);
  // A Saved Games folder left from an earlier open beta install: no install uses it.
  await run.changeFiles('Old open beta folder', [
    { path: 'Saved Games/DCS.openbeta/Config/options.lua', content: 'options = {}\n' },
  ]);
  await expect(page.getByTestId('dcs-orphaned')).toBeVisible();
  await expect(page.getByTestId('dcs-card-install')).toContainText('Saved Games\\DCS.openbeta');
  await expect(page.getByTestId('dcs-update-pending')).toBeVisible();
  await expect(page.getByTestId('dcs-changed-since')).toContainText(
    'Steam build 25625823 → Steam build 25700000'
  );
  await shot('update-waiting');
});

test('dcs-setup: screens are imported from SimAppPro, written as RigReady.lua and selected in DCS', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-setup-screens');
  const { page, shot, home } = run;
  await openDcs(page, 'screens');
  await expect(page.getByTestId('screens-started')).toContainText(
    "SimAppPro's screen plan (F/A-18C Hornet)"
  );
  await expect(page.getByTestId('screen-map-box')).toHaveCount(3);
  await expect(page.getByTestId('screens-changes')).toContainText('Create');
  await expect(page.getByTestId('screens-changes')).toContainText(
    'monitor setup "wwtMonitor" → "rigready"'
  );
  await expect(page.locator('[data-testid="screens-crop-LEFT_MFCD-top"] input')).toHaveValue('256');
  await shot('imported');

  // What SimAppPro's own file looks like on these monitors.
  await page.getByTestId('screens-view-wwtMonitor').click();
  await expect(page.getByTestId('screens-viewing')).toContainText('wwtMonitor.lua');
  await expect(page.getByTestId('screen-map-box')).toHaveCount(4);
  await shot('viewing-simapppro-file');
  await page.getByTestId('screens-stop-viewing').click();

  await page.getByTestId('screens-show-lua').click();
  await expect(page.getByTestId('screens-lua')).toContainText('LEFT_MFCD =');
  await expect(page.getByTestId('screens-lua')).toContainText('x = 5896;');
  await shot('file-preview');

  await page.getByTestId('screens-apply').click();
  await expect(page.getByTestId('screens-done')).toContainText(
    'DCS will use the RigReady screen setup'
  );
  await expect(page.getByTestId('screens-done')).toContainText('Created RigReady.lua');
  await expect(page.getByTestId('screens-status')).toContainText(
    "DCS uses RigReady's screen setup"
  );
  await expect(page.getByTestId('screens-apply')).toHaveText('In use');
  const lua = await fs.readFile(dcsFile(home, 'Config', 'MonitorSetup', 'RigReady.lua'), 'utf8');
  expect(lua).toContain('CENTER_MFCD =\n{\n\tx = 6664;');
  expect(await fs.readFile(dcsFile(home, 'Config', 'options.lua'), 'utf8')).toContain(
    '["multiMonitorSetup"] = "rigready"'
  );
  await shot('in-use');

  // Crop more off the top of the left DDI by dragging its top edge down.
  await page.locator('[data-testid="screen-map-box"][data-name="LEFT_MFCD"]').click();
  const handle = page.locator(
    '[data-testid="screen-map-box"][data-name="LEFT_MFCD"] [data-testid="screen-map-handle-n"]'
  );
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="screens-crop-LEFT_MFCD-top"] input')).not.toHaveValue(
    '256'
  );
  await expect(page.getByTestId('screens-changes')).toContainText('Update');
  await shot('cropped');

  // Someone edits RigReady.lua by hand: RigReady shows the difference and asks.
  await run.changeFiles('Hand edit', [
    {
      path: 'Saved Games/DCS/Config/MonitorSetup/RigReady.lua',
      content: lua.replace('x = 6664;', 'x = 6670;'),
    },
  ]);
  await expect(page.getByTestId('screens-changes')).toContainText(
    'Replace (it was edited outside RigReady)'
  );
  await page.getByTestId('screens-apply').click();
  await expect(page.getByTestId('screens-overwrite')).toBeVisible();
  await expect(page.getByTestId('screens-overwrite')).toContainText('x = 6670;');
  await shot('edited-outside');
  await page.getByTestId('screens-overwrite-confirm').click();
  await expect(page.getByTestId('screens-done')).toContainText('Updated RigReady.lua');
  expect(
    await fs.readFile(dcsFile(home, 'Config', 'MonitorSetup', 'RigReady.lua'), 'utf8')
  ).toContain('x = 6664;');

  // Drag the AMPCD onto the ultrawide: it moves there, and RigReady points out it covers the main view.
  const ampcd = page.locator('[data-testid="screen-map-box"][data-name="CENTER_MFCD"]');
  await expect(page.getByTestId('screens-overwrite')).toHaveCount(0);
  await expect(page.locator('.v-overlay__scrim')).toHaveCount(0);
  await page.getByTestId('screen-map').scrollIntoViewIfNeeded();
  const from = (await ampcd.boundingBox())!;
  const ultrawide = (await page
    .locator('[data-testid="screen-map-display"][data-name="LC49G95T"]')
    .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(ultrawide.x + ultrawide.width / 2, ultrawide.y + ultrawide.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByTestId('screens-monitor-CENTER_MFCD')).toContainText('LC49G95T');
  await expect(page.getByTestId('screens-warnings')).toContainText(
    'AMPCD is drawn over the main view on LC49G95T'
  );
  // What writing would do follows the edit: the file changes and the window shrinks.
  await expect(page.getByTestId('screens-changes')).toContainText('Update');
  await expect(page.getByTestId('screens-changes')).toContainText('width 7424 → 6656');
  await expect(page.getByTestId('screens-apply')).toHaveText('Use in DCS');
  await shot('moved-to-main');
});

test('dcs-setup: Export.lua gets the DCS-ExportScript line the Stream Deck plugin needs; a rewrite is noticed and put right', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-setup-export');
  const { page, shot, home } = run;
  await openDcs(page, 'export');
  await expect(page.getByTestId('export-streamdeck')).toContainText(
    'Install DCS-ExportScript first'
  );
  await expect(page.locator('[data-testid="export-tool"][data-tool="wwt"]')).toHaveAttribute(
    'data-active',
    'true'
  );
  await expect(page.locator('[data-testid="export-tool"][data-tool="dcs-bios"]')).toHaveAttribute(
    'data-active',
    'true'
  );
  await expect(page.getByTestId('export-line')).toHaveCount(4);
  await expect(page.getByTestId('export-file')).toContainText('CRLF');
  await shot('needs-export-script');

  // The user copies DCS-ExportScript into Saved Games; the page offers to load it.
  await run.changeFiles('Install DCS-ExportScript', [
    {
      path: 'Saved Games/DCS/Scripts/DCS-ExportScript/ExportScript.lua',
      content: '-- ExportScript\n',
    },
  ]);
  await page.getByTestId('export-streamdeck-add').click();
  await expect(page.getByTestId('export-confirm')).toBeVisible();
  await expect(page.getByTestId('export-confirm')).toContainText(
    '+ dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])'
  );
  await shot('confirm-add');
  await page.getByTestId('export-confirm-apply').click();
  await expect(page.getByTestId('export-message')).toContainText(
    'Export.lua: Add DCS-ExportScript'
  );
  await expect(page.getByTestId('export-streamdeck')).toHaveCount(0);
  const file = dcsFile(home, 'Scripts', 'Export.lua');
  const written = await fs.readFile(file, 'utf8');
  // Every earlier line kept its own ending: CRLF for WinWing, LF for DCS-BIOS.
  expect(written).toBe(
    "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n\r\ndofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\ndofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])\r\n"
  );
  await shot('added');

  // Another program writes its own version without the new line.
  await run.mutate([
    {
      op: 'writeFile',
      path: 'Saved Games/DCS/Scripts/Export.lua',
      content:
        "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n\r\ndofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\n",
    },
  ]);
  await expect(page.getByTestId('export-changed')).toContainText('Changed outside RigReady');
  await expect(page.getByTestId('export-changed')).toContainText(
    'DCS-ExportScript\\ExportScript.lua'
  );
  await shot('changed-outside');
  await page.getByTestId('export-restore').click();
  await expect(page.getByTestId('export-confirm')).toBeVisible();
  await page.getByTestId('export-confirm-apply').click();
  await expect(page.getByTestId('export-message')).toContainText('Put back DCS-ExportScript');
  await expect(page.getByTestId('export-changed')).toHaveCount(0);
  expect(await fs.readFile(file, 'utf8')).toBe(written);
});

test('dcs-setup: Export.lua overwritten without DCS-BIOS fails the check and Make ready puts the line back', async ({
  rig,
}) => {
  const { page, shot, home } = await rig.launch(
    'dcs-setup-export-overwritten',
    'dcs-setup-export-overwritten'
  );
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  const row = checkRow(page, 'Export.lua tools');
  await expect(row).toHaveAttribute('data-status', 'fail');
  await expect(row).toContainText('DCS-BIOS is missing from Export.lua');
  await expect(row.getByTestId('check-fix')).toContainText('Put back the missing Export.lua lines');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('missing');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Added DCS-BIOS to Export.lua');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  expect(await fs.readFile(dcsFile(home, 'Scripts', 'Export.lua'), 'utf8')).toContain(
    'DCS-BIOS\\BIOS.lua'
  );
  await page.getByTestId('group-toggle-files').click();
  await expect(checkRow(page, 'Export.lua tools')).toHaveAttribute('data-status', 'pass');
  await shot('fixed');
});

test('dcs-setup: a rotated MFD screen also warns about the DCS monitor setup, and both clear after the layout fix', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('dcs-setup-mfd-rotated', 'dcs-setup-mfd-rotated');
  await expect(checkRow(page, 'Monitor layout')).toHaveAttribute('data-status', 'fail');
  const monitor = checkRow(page, 'DCS monitor setup');
  await expect(monitor).toHaveAttribute('data-status', 'warn');
  await expect(monitor).toContainText('LEFT_MFCD (752x762 at 5896,256) is not on the monitors');
  await shot('both-warn');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-keep').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-status-sub')).toHaveText(
    'Everything this setup needs is in place'
  );
  await page.getByTestId('group-toggle-displays').click();
  await expect(checkRow(page, 'DCS monitor setup')).toHaveAttribute('data-status', 'pass');
  await expect(checkRow(page, 'DCS monitor setup')).toContainText(
    '"winwing" (wwtMonitor.lua) fits the monitors'
  );
  await shot('both-clear');
});

test('dcs-setup: SimAppPro not running fails only the setup that uses WinWing runtime features', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('dcs-setup-simapppro-not-running', 'dcs-setup-simapppro');
  const row = checkRow(page, 'SimAppPro running');
  await expect(row).toHaveAttribute('data-status', 'fail');
  await expect(row).toContainText('needed for UFC/ICP displays and backlight sync');
  await expect(row.getByTestId('check-fix')).toContainText('Start SimAppPro');
  await shot('hornet-not-running');

  await chooseProfile(page, 'DCS UH-1H');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(checkRow(page, 'SimAppPro running')).toHaveCount(0);
  await expect(page.getByTestId('group-apps')).toHaveCount(0);
  await shot('huey-no-simapppro');

  await chooseProfile(page, 'DCS F/A-18C');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-activity')).toContainText('Started SimAppPro');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  await openDcs(page, 'simapppro');
  await expect(
    page.locator('[data-testid="sap-profile"][data-profile="dcs-setup-hornet"]')
  ).toContainText('Checks that SimAppPro is running');
  await expect(
    page.locator('[data-testid="sap-profile"][data-profile="dcs-setup-huey"]')
  ).toContainText('Does not need SimAppPro');
  await expect(page.getByTestId('sap-replaced')).toContainText('MFD screen layout');
  await shot('simapppro-page');

  // The Huey gets vibration: now it checks for SimAppPro too.
  await page.locator('[data-testid="sap-feature-dcs-setup-huey-vibration"] input').check();
  await page.getByTestId('sap-save-dcs-setup-huey').click();
  await expect(page.getByTestId('sap-message')).toContainText(
    '"DCS UH-1H" now checks that SimAppPro is running'
  );
  await page.getByTestId('mode-fly').click();
  await chooseProfile(page, 'DCS UH-1H');
  await page.getByTestId('group-toggle-apps').click();
  await expect(checkRow(page, 'SimAppPro running')).toHaveAttribute('data-status', 'pass');
});

test('dcs-setup: simapppro-rewrote-monitorsetup — SimAppPro puts its setup back into options.lua, the Play screen warns and restores', async ({
  rig,
}) => {
  const run = await rig.launch('dcs-setup-flying', 'dcs-setup-simapppro-rewrote');
  const { page, shot, home } = run;
  await openDcs(page, 'screens');
  await expect(page.getByTestId('screen-map-box')).toHaveCount(3);
  await page.getByTestId('screens-apply').click();
  await expect(page.getByTestId('screens-done')).toContainText(
    'DCS will use the RigReady screen setup'
  );

  // SimAppPro's MFD wizard is applied again: it writes its own file name into options.lua.
  const options = dcsFile(home, 'Config', 'options.lua');
  const text = await fs.readFile(options, 'utf8');
  await run.mutate([
    {
      op: 'writeFile',
      path: 'Saved Games/DCS/Config/options.lua',
      content: text.replace('"rigready"', '"wwtMonitor"'),
    },
  ]);

  await page.getByTestId('dcs-tab-overview').click();
  await expect(page.getByTestId('dcs-managed-changed')).toContainText(
    'options.lua was changed outside RigReady'
  );
  await page.getByTestId('dcs-tab-simapppro').click();
  await expect(
    page.locator('[data-testid="sap-managed-file"][data-status="changed"]')
  ).toContainText('Monitor setup is "wwtMonitor"; RigReady set "rigready"');
  await shot('simapppro-page-changed');

  await page.getByTestId('mode-fly').click();
  await chooseProfile(page, 'DCS UH-1H');
  const row = checkRow(page, 'DCS files RigReady manages');
  await expect(row).toHaveAttribute('data-status', 'warn');
  await expect(row).toContainText('options.lua changed outside RigReady');
  await expect(row).toContainText(
    'options.lua: Monitor setup is "wwtMonitor"; RigReady set "rigready"'
  );
  await expect(row.getByTestId('check-fix')).toContainText("Restore RigReady's version");
  await shot('fly-warning');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-activity')).toContainText(
    "Restored RigReady's version of options.lua"
  );
  await expect(page.getByTestId('fly-status-sub')).toHaveText(
    'Everything this setup needs is in place'
  );
  expect(await fs.readFile(options, 'utf8')).toBe(text);
  await shot('restored');
});

test('dcs-setup: on a PC without DCS every tab says so the same way, SimAppPro included', async ({
  rig,
}) => {
  // The owner's rig with DCS removed: SimAppPro is installed, DCS is not.
  const { page, shot } = await rig.launch('dcs-bindings-no-dcs', 'dcs-setup-no-dcs');
  await openDcs(page);
  for (const tab of ['overview', 'screens', 'export', 'simapppro'] as const) {
    await page.getByTestId(`dcs-tab-${tab}`).click();
    const missing = page.getByTestId('dcs-not-found');
    await expect(missing.getByTestId('not-here-title')).toHaveText(
      'DCS World was not found on this PC'
    );
    await expect(missing.getByTestId('not-here-looked')).toHaveText(
      'RigReady looked in every Steam library, the standalone install folders and Saved Games\\DCS.'
    );
    await expect(missing.getByTestId('not-here-game-page')).toHaveText('DCS World game page');
    await shot(tab);
  }
  // The SimAppPro tab shows none of what needs DCS, and says what it found of SimAppPro.
  await expect(page.getByTestId('sap-replaced')).toHaveCount(0);
  await expect(page.getByTestId('sap-managed')).toHaveCount(0);
  await expect(page.getByTestId('sap-without-dcs')).toContainText(
    'SimAppPro 1.16.91 is installed on this PC.'
  );
  // The link leads to the page where the folder can be chosen by hand.
  await page.getByTestId('not-here-game-page').click();
  await expect(page.getByTestId('game-title')).toHaveText('DCS World');
  await expect(page.getByTestId('game-not-found').getByTestId('not-here-title')).toHaveText(
    'DCS World was not found on this PC'
  );
  await shot('game-page');
});
