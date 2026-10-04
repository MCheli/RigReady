import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const fail = (port: string, message: string) => ({ op: 'failProvider', port, message });
const recover = (port: string) => ({ op: 'failProvider', port, fail: false });

test('errors: a provider that fails is shown as a message on Fly, Devices, Monitors, Audio and Backups, and the pages recover', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'errors-provider');
  const { page, shot, mutate, dataRoot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Windows answers every question about the machine with a failure.
  await mutate([
    fail('devices', 'Windows could not list the USB devices.'),
    fail('displays', 'Windows could not read the monitor layout.'),
    fail('audio', 'Windows could not read the sound devices.'),
    fail('processes', 'Windows could not list the running programs.'),
  ]);

  // Fly: not a crash and not "Ready": every item says what went wrong.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const pedals = checkRow(page, 'T-Pendular-Rudder');
  await expect(pedals).toHaveAttribute('data-status', 'fail');
  await expect(pedals).toContainText('Windows could not list the USB devices.');
  await expect(checkRow(page, 'TrackIR5')).toContainText(
    'Windows could not list the running programs.'
  );
  await expect(page.getByTestId('group-displays')).toContainText(
    'Windows could not read the monitor layout.'
  );
  await shot('fly');

  // Devices.
  await page.getByTestId('mode-configure').click();
  await go(page, '/configure/devices');
  await expect(page.getByTestId('devices-error')).toContainText(
    'Windows could not list the USB devices.'
  );
  await shot('devices');

  // Monitors, with a way to try again.
  await go(page, '/configure/displays');
  const monitors = page.getByTestId('displays-load-error');
  await expect(monitors).toContainText('Windows could not read the monitor layout.');
  await shot('monitors');

  // Audio.
  await go(page, '/configure/audio');
  const audio = page.getByTestId('audio-load-error');
  await expect(audio).toContainText('Windows could not read the sound devices.');
  await shot('audio');

  // Diagnostics says which parts could not be read, and still shows the rest.
  await go(page, '/configure/diagnostics');
  const diagnostics = page.getByTestId('diagnostics-page');
  await expect(diagnostics.getByTestId('diagnostics-devices-problem')).toContainText(
    'Windows could not list the USB devices.'
  );
  await expect(diagnostics.getByTestId('diagnostics-monitors-problem')).toContainText(
    'Windows could not read the monitor layout.'
  );
  await expect(diagnostics.getByTestId('diagnostics-games')).toContainText('DCS World');
  await diagnostics.getByTestId('diagnostics-devices').scrollIntoViewIfNeeded();
  await shot('diagnostics');

  // Backups: the folder of saved backups cannot be listed (something else is in its place).
  await fs.writeFile(path.join(dataRoot, 'backups'), 'not a folder');
  await go(page, '/configure/backups');
  await expect(page.getByTestId('backup-error')).toContainText('Could not list');
  await shot('backups');
  await fs.rm(path.join(dataRoot, 'backups'));

  // Windows answers again: every page is back without a restart.
  await mutate(['devices', 'displays', 'audio', 'processes'].map(recover));
  await go(page, '/configure/audio');
  await expect(page.getByTestId('audio-load-error')).toHaveCount(0);
  await expect(page.getByTestId('audio-page')).toContainText('Speakers');
  await go(page, '/configure/displays');
  await expect(page.getByTestId('displays-load-error')).toHaveCount(0);
  await expect(page.getByTestId('displays-page')).toContainText('LC49G95T');
  await go(page, '/configure/devices');
  await expect(page.getByTestId('devices-error')).toHaveCount(0);
  await expect(page.getByTestId('devices-page')).toContainText('T-Pendular-Rudder');
  await go(page, '/configure/backups');
  await expect(page.getByTestId('backup-error')).toHaveCount(0);
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await shot('recovered');

  // Nothing of this was an unexpected error: no notice, and the log names no crash.
  await expect(page.getByTestId('error-notice')).toHaveCount(0);
});

test('errors: a driver call that never answers does not freeze Diagnostics', async ({ rig }) => {
  const run = await rig.launch('generic-fresh', 'errors-hung-provider');
  const { page, shot, mutate } = run;
  await expect(page.getByTestId('fly-empty')).toBeVisible();
  await mutate([{ op: 'hangProvider', port: 'devices' }]);
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-diagnostics').click();
  const root = page.getByTestId('diagnostics-page');
  await expect(root.getByTestId('diagnostics-devices-problem')).toContainText(
    'The device list did not answer within 5 s.',
    { timeout: 20_000 }
  );
  await expect(root.getByTestId('diagnostics-devices')).toContainText('BenQ GW2480');
  await expect(root.getByTestId('diagnostics-version')).toHaveText(/^\d+\./);
  await root.getByTestId('diagnostics-devices').scrollIntoViewIfNeeded();
  await shot('devices-silent');
});
