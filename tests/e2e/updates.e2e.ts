import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { UPDATE_FEED_FILE, type FakeUpdateFeedState } from '../../src/platform/fake/updater';
import { expect, repoRoot, test, type RunningApp } from './harness';

/**
 * Updates of RigReady itself, on the fake update feed every scenario run uses (it never
 * touches the network). The test publishes versions by writing the feed's file in the
 * fake user folder.
 */

const publish = (run: RunningApp, feed: FakeUpdateFeedState): Promise<void> =>
  fs.writeFile(path.join(run.home, UPDATE_FEED_FILE), JSON.stringify(feed));

const option = (page: Page, text: string) =>
  page.locator('.v-overlay--active .v-list-item').filter({ hasText: text });

async function openUpdates(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('updates-section')).toBeVisible();
  await page.getByTestId('updates-section').scrollIntoViewIfNeeded();
}

test('updates: checked at start, downloaded in the background, installed only on confirmation and never while a game runs', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'updates');
  const { page, shot } = run;
  const version = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
    .version as string;
  await openUpdates(page);
  const section = page.getByTestId('updates-section');
  const status = page.getByTestId('update-status');

  // About: this version, this channel.
  await expect(page.getByTestId('about-version')).toHaveText(version);
  await expect(page.getByTestId('about-channel')).toHaveText('Stable');
  await expect(page.getByTestId('update-automatic').locator('input')).toBeChecked();

  // The check at start runs by itself a few seconds in; nothing is published yet.
  await expect(section).toHaveAttribute('data-phase', 'noRelease');
  await expect(status).toContainText('Nothing has been published on the stable channel yet.');
  await page.getByTestId('about-section').scrollIntoViewIfNeeded();
  await shot('nothing-published');

  // A release appears. The check finds it and downloads it in the background.
  await publish(run, {
    stable: {
      version: '2.1.0',
      notes: 'Faster checks, and the monitor layout is applied in one step.',
    },
    beta: { version: '2.2.0-beta.1' },
    hold: true,
  });
  await page.getByTestId('update-check').click();
  await expect(section).toHaveAttribute('data-phase', 'downloading');
  await expect(status).toHaveText('Version 2.1.0 is being downloaded in the background… 40%');
  await expect(page.getByTestId('update-install')).toHaveCount(0);
  await shot('downloading');

  await publish(run, {
    stable: {
      version: '2.1.0',
      notes: 'Faster checks, and the monitor layout is applied in one step.',
    },
  });
  await expect(section).toHaveAttribute('data-phase', 'ready');
  await expect(status).toHaveText(
    'Version 2.1.0 is downloaded. It is installed when you restart RigReady here, or the next time you quit it.'
  );
  await expect(page.getByTestId('update-install')).toHaveText('Restart to install');
  await shot('downloaded');

  // A game is running: the confirmation is refused, and says why.
  await run.mutate([{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\Games\\DCS\\bin\\DCS.exe' }]);
  await page.getByTestId('update-install').click();
  await expect(status).toContainText('DCS.exe is running, so version 2.1.0 was not installed.');
  await expect(section).toHaveAttribute('data-phase', 'ready');
  await expect(page.getByTestId('update-error')).toHaveCount(0);
  await shot('refused-while-game-runs');

  // The game is closed: now the confirmation goes through.
  await run.mutate([{ op: 'stopProcess', name: 'DCS.exe' }]);
  await page.getByTestId('update-install').click();
  await expect(section).toHaveAttribute('data-phase', 'installing');
  await expect(status).toHaveText('Restarting to install version 2.1.0…');
  await shot('restarting-to-install');
});

test('updates: the beta channel and the off switch are choices that survive a restart', async ({
  rig,
}) => {
  const first = await rig.launch('flying-all-good', 'updates-channel');
  let { page } = first;
  const version = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
    .version as string;
  await openUpdates(page);
  const phase = (): ReturnType<Page['getByTestId']> => page.getByTestId('updates-section');
  await expect(phase()).toHaveAttribute('data-phase', 'noRelease');

  // The newest release is the version that is running; a beta is out as well.
  await publish(first, { stable: { version }, beta: { version: '2.2.0-beta.1' } });
  // Stable: a beta is not for this PC.
  await page.getByTestId('update-check').click();
  await expect(phase()).toHaveAttribute('data-phase', 'upToDate');
  await expect(page.getByTestId('update-status')).toContainText(
    `RigReady ${version} is the newest version on the stable channel.`
  );

  // Beta: the new channel is checked at once and its version comes down.
  await page.getByTestId('update-channel').click();
  await option(page, 'Beta').click();
  await expect(phase()).toHaveAttribute('data-phase', 'ready');
  await expect(page.getByTestId('update-status')).toContainText(
    'Version 2.2.0-beta.1 is downloaded.'
  );
  await expect(page.getByTestId('about-channel')).toHaveText('Beta');

  // Automatic checks off: nothing is installed on quit any more, and the page says so.
  await page.getByTestId('update-automatic').locator('input').click();
  await expect(page.getByTestId('update-automatic').locator('input')).not.toBeChecked();
  await expect(page.getByTestId('update-status')).toHaveText(
    'Version 2.2.0-beta.1 is downloaded. It is installed when you restart RigReady here.'
  );
  await page.getByTestId('about-section').scrollIntoViewIfNeeded();
  await first.shot('beta-channel-automatic-off');
  const stored = JSON.parse(await fs.readFile(path.join(first.dataRoot, 'settings.json'), 'utf8'));
  expect(stored.updates).toEqual({ check: false, channel: 'beta' });

  const second = await first.restart();
  page = second.page;
  await openUpdates(page);
  await expect(page.getByTestId('update-automatic').locator('input')).not.toBeChecked();
  await expect(page.getByTestId('about-channel')).toHaveText('Beta');
  // Off means off: no check happens by itself after the restart.
  await expect(page.getByTestId('update-status')).toHaveText('Automatic checks are off.');
  await page.getByTestId('about-section').scrollIntoViewIfNeeded();
  await second.shot('after-restart');
});
