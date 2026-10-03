import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkRow, expect, test } from './harness';

/** Configure mode: create a setup by capturing the rig as it is, then find it in Fly. */

test('a new rig: capture the current state into a setup, which is then Ready', async ({ rig }) => {
  const { page, shot, dataRoot } = await rig.launch('flying-fresh', 'profile-capture');

  await expect(page.getByTestId('fly-empty')).toContainText('No setups yet');
  await shot('empty');
  await page.getByTestId('fly-create').click();

  const capture = page.getByTestId('capture-page');
  await expect(capture.getByTestId('capture-group-devices')).toContainText('WINWING MFD1-L');
  await expect(capture.getByTestId('capture-group-displays')).toContainText(
    'USB_Monitor (2 of 3): 768x1024 at 5888,0, rotated 90°'
  );
  // Nothing is saved without a name.
  await expect(page.getByTestId('capture-save')).toBeDisabled();
  await page.getByTestId('capture-name').locator('input').fill('DCS F/A-18C');
  await page
    .getByTestId('capture-launch-exe')
    .locator('input')
    .fill('C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe');

  // Running apps are the user's choice: find TrackIR and keep it.
  await page.getByTestId('capture-app-filter').locator('input').fill('trackir');
  const trackir = page.locator('[data-testid="capture-candidate"][data-title="TrackIR5"]');
  await trackir.getByRole('checkbox').check();
  await expect(page.getByTestId('capture-group-apps')).toContainText('1 of');

  // The Stream Deck is nice to have, not required.
  const streamDeck = page.locator('[data-testid="capture-candidate"][data-title="Stream Deck XL"]');
  await streamDeck.getByRole('checkbox').check();
  await streamDeck.getByTestId('candidate-optional').click();
  await shot('capture');

  await page.getByTestId('capture-save').click();

  // Back on Fly with the new setup active and everything green.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(page.getByTestId('group-apps')).toContainText('1 of 1 OK');
  await expect(page.getByTestId('group-displays')).toContainText('1 of 1 OK');
  await page.getByTestId('group-toggle-devices').click();
  await expect(checkRow(page, 'Stream Deck XL')).toContainText('optional');
  await shot('ready');

  // The setup is a YAML file in the isolated data root, nowhere else.
  const saved = await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8');
  expect(saved).toContain('name: DCS F/A-18C');
  expect(saved).toContain('type: process.running');

  // Configure mode: navigation comes from the feature manifests.
  await page.getByTestId('mode-configure').click();
  await expect(page.getByTestId('configure-nav')).toContainText('Setups');
  await expect(page.getByTestId('profile-row')).toContainText('DCS F/A-18C');
  await shot('setups');

  await page.getByTestId('nav-devices').click();
  await expect(page.getByTestId('devices-page')).toContainText('T-Pendular-Rudder');
  await shot('devices');

  await page.getByTestId('nav-displays').click();
  await expect(page.getByTestId('displays-map')).toContainText('USB_Monitor (3 of 3)');
  await expect(page.getByTestId('displays-page')).toContainText('Connected, turned off');
  await shot('monitors');

  await page.getByTestId('nav-games').click();
  await expect(page.getByTestId('games-page')).toContainText('DCS World');

  // Edit: rename, save, and Fly shows the new name.
  await page.getByTestId('nav-profiles').click();
  await page.getByTestId('profile-edit').click();
  await page.getByTestId('edit-name').locator('input').fill('Hornet');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('profile-row')).toContainText('Hornet');
  await page.getByTestId('mode-fly').click();
  await expect(page.getByTestId('profile-switcher')).toContainText('Hornet');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // Delete: back to the empty state.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('profile-delete').click();
  await page.getByTestId('profile-delete-confirm').click();
  await expect(page.getByTestId('profiles-empty')).toBeVisible();
});
