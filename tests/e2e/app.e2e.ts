import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkRow, expect, test } from './harness';

/** The app shell: settings, the safety journal, and what the harness offers every feature. */

test('settings: defaults are shown, a desk layout is saved and chosen, changes survive a restart', async ({
  rig,
}) => {
  const first = await rig.launch('desk-mfds-wrong', 'app-settings');
  let { page } = first;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  // The documented defaults.
  await expect(page.getByTestId('setting-backup-days').locator('input')).toHaveValue('30');
  await expect(page.getByTestId('setting-backup-groups').locator('input')).toHaveValue('50');
  await expect(page.getByTestId('setting-revert-seconds').locator('input')).toHaveValue('15');
  await expect(page.getByTestId('setting-check-timeout').locator('input')).toHaveValue('5');
  await expect(page.getByTestId('setting-import-cap').locator('input')).toHaveValue('200');
  await expect(page.getByTestId('setting-start-with-windows').locator('input')).not.toBeChecked();
  await expect(page.getByTestId('setting-minimize-to-tray').locator('input')).toBeChecked();
  await expect(page.getByTestId('ai-key-state')).toHaveText('No Anthropic API key');
  await first.shot('defaults');

  // Save the monitors as they are (the desk arrangement) and make that the desk layout.
  await page.getByTestId('layout-new-name').locator('input').fill('Desk');
  await page.getByTestId('layout-save-current').click();
  await expect(page.getByTestId('layout-row')).toHaveCount(1);
  await expect(page.getByTestId('layout-row')).toContainText('5 on');
  await page.getByTestId('setting-desk-layout').click();
  await page.getByRole('option', { name: 'Desk' }).click();
  await expect(page.getByTestId('layout-row')).toContainText('desk layout');

  await page.getByTestId('setting-start-with-windows').locator('input').check();
  await expect(page.getByTestId('settings-saved')).toHaveText('Saved');
  const revert = page.getByTestId('setting-revert-seconds').locator('input');
  await revert.fill('20');
  await revert.blur();
  await expect(page.getByTestId('settings-saved')).toHaveText('Saved');
  // Out of range is refused with a message, not silently accepted.
  const timeout = page.getByTestId('setting-check-timeout').locator('input');
  await timeout.fill('0');
  await timeout.blur();
  await expect(page.getByTestId('settings-error')).toContainText('not valid');
  await expect(page.getByTestId('setting-check-timeout').locator('input')).toHaveValue('5');

  // The key is stored encrypted: present afterwards, and nowhere in plain text.
  const key = 'test-key-not-a-real-one-0123456789';
  await page.getByTestId('ai-key-input').locator('input').fill(key);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-key-state')).toHaveText('An Anthropic API key is stored');
  await expect(page.getByTestId('ai-key-input').locator('input')).toHaveValue('');
  await first.shot('changed');
  const secret = await fs.readFile(path.join(first.dataRoot, 'secrets', 'anthropic-api-key.bin'));
  expect(secret.includes(Buffer.from(key))).toBe(false);
  expect(await fs.readFile(path.join(first.dataRoot, 'settings.json'), 'utf8')).not.toContain(key);

  const second = await first.restart();
  page = second.page;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('setting-revert-seconds').locator('input')).toHaveValue('20');
  await expect(page.getByTestId('setting-check-timeout').locator('input')).toHaveValue('5');
  await expect(page.getByTestId('layout-row')).toContainText('desk layout');
  await expect(page.getByTestId('ai-key-state')).toHaveText('An Anthropic API key is stored');
  await second.shot('after-restart');

  // Rename, then delete: the desk layout setting goes with it.
  await page.getByTestId('layout-rename').click();
  await page.getByTestId('layout-rename-input').locator('input').fill('Office');
  await page.getByTestId('layout-rename-save').click();
  await expect(page.getByTestId('layout-row')).toHaveAttribute('data-layout', 'Office');
  await page.getByTestId('layout-delete').click();
  await expect(page.getByTestId('layout-row')).toHaveCount(0);
  await page.getByTestId('ai-key-remove').click();
  await expect(page.getByTestId('ai-key-state')).toHaveText('No Anthropic API key');
  const settings = JSON.parse(
    await fs.readFile(path.join(second.dataRoot, 'settings.json'), 'utf8')
  );
  expect(settings).toMatchObject({ startWithWindows: true, aiKeyPresent: false });
  expect(settings.deskLayoutId).toBeUndefined();
});

test('safety: changes are listed by action with their files, and Undo puts the files back', async ({
  rig,
}) => {
  const run = await rig.launch('desk-mfds-wrong', 'app-safety');
  const { page } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-safety').click();
  await expect(page.getByTestId('safety-empty')).toBeVisible();
  await run.shot('nothing-changed');

  const options = path.join(run.home, 'Saved Games', 'DCS', 'Config', 'options.lua');
  const original = await fs.readFile(options);
  await run.changeFiles('Set up MFD screens for the F/A-18C', [
    {
      path: 'Saved Games/DCS/Config/options.lua',
      content: 'options = { multiMonitorSetup = "rigready" }\n',
    },
    { path: 'Saved Games/DCS/Config/MonitorSetup/RigReady.lua', content: '-- viewports\n' },
  ]);
  await run.changeFiles('Add RigReady line to Export.lua', [
    { path: 'Saved Games/DCS/Scripts/Export.lua', content: '-- changed\n' },
  ]);
  // The page refreshes by itself when something changes the machine.
  await expect(page.getByTestId('change-group')).toHaveCount(2);
  const mfd = page.locator(
    '[data-testid="change-group"][data-reason="Set up MFD screens for the F/A-18C"]'
  );
  await expect(mfd).toContainText('2 files');
  await mfd.getByTestId('change-toggle').click();
  await expect(mfd.getByTestId('change-file')).toHaveCount(2);
  await expect(mfd.getByTestId('change-file').first()).toContainText('Changed');
  await expect(mfd.getByTestId('change-file').nth(1)).toContainText('Created');
  await expect(page.getByTestId('safety-usage')).toContainText('30 days');
  await run.shot('two-changes');

  await mfd.getByTestId('change-undo').click();
  await expect(page.getByTestId('safety-message')).toContainText('Undid "Set up MFD screens');
  await expect(mfd).toHaveAttribute('data-undone', 'true');
  expect(await fs.readFile(options)).toEqual(original);
  await expect(
    fs.access(path.join(run.home, 'Saved Games', 'DCS', 'Config', 'MonitorSetup', 'RigReady.lua'))
  ).rejects.toThrow();
  await run.shot('undone');

  // The other file is changed again behind RigReady's back: Undo asks first.
  await fs.writeFile(
    path.join(run.home, 'Saved Games', 'DCS', 'Scripts', 'Export.lua'),
    '-- by DCS-BIOS\n'
  );
  const exportGroup = page.locator(
    '[data-testid="change-group"][data-reason="Add RigReady line to Export.lua"]'
  );
  await exportGroup.getByTestId('change-undo').click();
  await expect(page.getByTestId('undo-confirm')).toContainText('was changed again');
  await run.shot('changed-since');
  await page.getByTestId('undo-force').click();
  await expect(exportGroup).toHaveAttribute('data-undone', 'true');
});

test('harness: live changes reach the screen, dialogs are scripted, HTML renders to PNG and PDF', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'app-harness', {
    dialogs: { open: [['Documents/setup.rigready']], save: ['Documents/out.zip'] },
  });
  const { page } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Unplug the pedals while the app is running: the checklist follows without a click.
  await run.mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(checkRow(page, 'T-Pendular-Rudder')).toHaveAttribute('data-status', 'fail');
  await run.shot('unplugged-live');
  await expect(run.mutate([{ op: 'stopProcess', name: 'NotRunning.exe' }])).rejects.toThrow(
    /matched no process/
  );

  // The real Render port: exact pixel size on any display scaling, and a real PDF.
  const rendered = await run.render(
    '<html><body style="margin:0;background:#123456"><h1 style="color:white">Kneeboard</h1></body></html>',
    { width: 768, height: 1024 }
  );
  expect(rendered).toMatchObject({ pngWidth: 768, pngHeight: 1024, pdfHeader: '%PDF-' });
  expect(rendered.pngBytes).toBeGreaterThan(500);
  expect(rendered.pdfBytes).toBeGreaterThan(500);
  // The temp HTML file is gone again.
  const tmp = await fs.readdir(path.join(run.dataRoot, 'tmp')).catch(() => []);
  expect(tmp).toEqual([]);

  // The real Identify overlay: one label window per monitor, gone again after the time given.
  const windowsBefore = run.app.windows().length;
  await run.showLabels(
    [
      { x: 0, y: 0, width: 1280, height: 720, text: '1', caption: 'Main' },
      { x: 100000, y: 0, width: 800, height: 600, text: '2' },
    ],
    700
  );
  expect(run.app.windows().length).toBe(windowsBefore + 2);
  await expect.poll(() => run.app.windows().length, { timeout: 5000 }).toBe(windowsBefore);

  // The recorded rig's files are in the fake user folder, install files included.
  await expect(
    fs.access(
      path.join(run.home, 'Program Files (x86)', 'Steam', 'steamapps', 'appmanifest_223750.acf')
    )
  ).resolves.toBeUndefined();
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-games').click();
  await expect(page.getByTestId('game-row').first()).toContainText('DCSWorld');
});
