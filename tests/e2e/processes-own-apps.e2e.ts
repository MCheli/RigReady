import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * "Always offer this app" (CFG-PROFILE-023): a program RigReady does not know is dug out
 * once on New setup, and from then on every new setup offers it ticked, under the name the
 * user gives it in Settings. A hand-edited list that names Windows or RigReady is refused.
 */

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);
const candidate = (page: Page, title: string) =>
  page.locator(`[data-testid="capture-candidate"][data-title="${title}"]`);
const bringUp = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => el.scrollIntoView({ block: 'start' }));

test('processes: an app RigReady does not know is offered in every new setup once the user asks, and the list is kept in Settings', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('processes-own-apps', 'processes-own-apps');
  await go(page, '/configure/profiles/capture');
  await expect(page.getByTestId('capture-group-apps')).toBeVisible();

  // Not known: behind "show all", not ticked, with the button on its row.
  await expect(candidate(page, 'SimTool')).toHaveCount(0);
  await page.getByTestId('capture-more-apps').click();
  const tool = candidate(page, 'SimTool');
  await expect(tool).toHaveAttribute('data-kept', 'no');
  await expect(tool).toContainText('D:\\Sims\\Tools\\SimTool.exe');
  await expect(tool.getByTestId('candidate-remember')).toHaveText('Always offer this app');
  // Windows' own programs and the known helpers have no such button.
  await expect(candidate(page, 'msedgewebview2').getByTestId('candidate-remember')).toHaveCount(0);
  await expect(candidate(page, 'TrackIR software').getByTestId('candidate-remember')).toHaveCount(
    0
  );
  await tool.scrollIntoViewIfNeeded();
  await shot('unknown-app');

  await tool.getByTestId('candidate-remember').click();
  // The row is what RigReady read back from its list: ticked, and said to be offered.
  const kept = candidate(page, 'SimTool');
  await expect(kept).toHaveAttribute('data-kept', 'yes');
  await expect(kept).toContainText('Always offered · D:\\Sims\\Tools\\SimTool.exe');
  await expect(kept.getByTestId('candidate-forget')).toHaveText('Stop offering it');
  await kept.scrollIntoViewIfNeeded();
  await shot('always-offered');
  const stored = JSON.parse(
    await fs.readFile(path.join(dataRoot, 'processes', 'known.json'), 'utf8')
  );
  expect(stored.apps.at(-1)).toMatchObject({
    name: 'SimTool.exe',
    title: 'SimTool',
    path: 'D:\\Sims\\Tools\\SimTool.exe',
    closeAtStandDown: false,
  });

  // Settings lists it, with the hand-edited entries RigReady refuses and why.
  await go(page, '/configure/settings');
  const section = page.getByTestId('own-apps');
  const own = section.locator('[data-testid="own-app"][data-name="SimTool.exe"]');
  await expect(own).toBeVisible();
  await expect(section.getByTestId('own-app-refused')).toHaveCount(2);
  await expect(
    section.locator('[data-testid="own-app-refused"][data-name="explorer.exe"]')
  ).toContainText('RigReady never offers it: it is part of Windows.');
  await expect(
    section.locator('[data-testid="own-app-refused"][data-name="RigReady.exe"]')
  ).toContainText('RigReady never offers it: it is RigReady itself.');
  await own.getByTestId('own-app-title').locator('input').fill('Sim Tool');
  await own.getByTestId('own-app-title').locator('input').press('Enter');
  await expect(own.getByTestId('own-app-title').locator('input')).toHaveValue('Sim Tool');
  await own.getByTestId('own-app-close').locator('input').check();
  await expect(own.getByTestId('own-app-close').locator('input')).toBeChecked();
  await section.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('settings');

  // The next new setup offers it ticked under that name, and closes it at Stand down.
  await go(page, '/configure/profiles');
  await go(page, '/configure/profiles/capture');
  const next = candidate(page, 'Sim Tool');
  await expect(next).toHaveAttribute('data-kept', 'yes');
  await expect(next).toContainText('closed at Stand down');
  await expect(page.getByTestId('capture-summary-standdown')).toContainText('Sim Tool');
  await bringUp(page, 'capture-group-apps');
  await shot('next-setup');

  // Taken off the list in Settings, it is behind "show all" again.
  await go(page, '/configure/settings');
  await page
    .locator('[data-testid="own-app"][data-name="SimTool.exe"]')
    .getByTestId('own-app-forget')
    .click();
  await expect(page.getByTestId('own-app')).toHaveCount(0);
  await expect(page.getByTestId('own-apps-empty')).toBeVisible();
  await page
    .locator('[data-testid="own-app-refused"][data-name="explorer.exe"]')
    .getByTestId('own-app-refused-remove')
    .click();
  await expect(page.getByTestId('own-app-refused')).toHaveCount(1);
  await go(page, '/configure/profiles');
  await go(page, '/configure/profiles/capture');
  await expect(page.getByTestId('capture-group-apps')).toBeVisible();
  await expect(candidate(page, 'SimTool')).toHaveCount(0);
});
