import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  // Build the app first
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
    cwd: path.join(__dirname, '../..'),
  });

  // Get the first window
  page = await electronApp.firstWindow();

  // Wait for the app to be ready
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

test.describe('RigReady App', () => {
  test('should display the app title', async () => {
    const title = await page.title();
    expect(title).toBe('RigReady');
  });

  test('should show navigation drawer with menu items', async () => {
    // Check for all navigation items in the drawer
    await expect(page.locator('.v-list-item-title:has-text("Profiles")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Checklist")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Launch")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Devices")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Input Tester")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Displays")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Keybindings")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Stream Deck")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Settings")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Debug")')).toBeVisible();
  });

  test('should show Profiles view by default', async () => {
    // The Profiles view should be active by default (currentSection defaults to 'profiles')
    await expect(page.locator('text=Profiles').first()).toBeVisible();
  });

  test('should navigate to Profiles view', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(300);
    // Check for "Profiles" heading
    await expect(page.locator('text=Profiles').first()).toBeVisible();
  });

  test('should show "New Profile" and "Wizard" buttons in Profiles view', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(300);
    await expect(page.locator('button:has-text("New Profile")')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wizard', exact: true })).toBeVisible();
  });

  test('should navigate to Checklist view', async () => {
    await page.click('.v-list-item-title:has-text("Checklist")');
    await page.waitForTimeout(300);
    await expect(page.locator('text=Pre-Flight Checklist')).toBeVisible();
  });

  test('should navigate to Devices view', async () => {
    await page.click('.v-list-item-title:has-text("Devices")');
    await expect(page.locator('h1:has-text("Connected Devices")')).toBeVisible();
  });

  test('should navigate to Input Tester view', async () => {
    await page.click('.v-list-item-title:has-text("Input Tester")');
    await expect(page.locator('h1:has-text("Input Tester")')).toBeVisible();
  });

  test('should navigate to Displays view', async () => {
    await page.click('.v-list-item-title:has-text("Displays")');
    await expect(page.locator('h1:has-text("Display Configuration")')).toBeVisible();
  });

  test('should navigate to Keybindings view', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await expect(page.locator('h1:has-text("Keybinding Manager")')).toBeVisible();
  });

  test('should show Keybindings tabs', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await page.waitForTimeout(300);
    // Verify all tabs are visible
    await expect(page.locator('text=Keybinding Profiles')).toBeVisible();
    await expect(page.locator('text=Sim Backups')).toBeVisible();
    await expect(page.locator('text=DCS Bindings')).toBeVisible();
    await expect(page.locator('text=Duplicates')).toBeVisible();
    await expect(page.locator('text=Per Device')).toBeVisible();
    await expect(page.locator('text=Snapshots')).toBeVisible();
    await expect(page.locator('text=UUID Migration')).toBeVisible();
  });

  test('should click Duplicates tab in Keybindings view', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await page.waitForTimeout(300);
    const duplicatesTab = page.locator('text=Duplicates');
    if (await duplicatesTab.isVisible()) {
      await duplicatesTab.click();
      await page.waitForTimeout(300);
    }
  });

  test('should click Per Device tab in Keybindings view', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await page.waitForTimeout(300);
    const perDeviceTab = page.locator('text=Per Device');
    if (await perDeviceTab.isVisible()) {
      await perDeviceTab.click();
      await page.waitForTimeout(300);
    }
  });

  test('should click UUID Migration tab in Keybindings view', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await page.waitForTimeout(300);
    const uuidTab = page.locator('text=UUID Migration');
    if (await uuidTab.isVisible()) {
      await uuidTab.click();
      await page.waitForTimeout(300);
    }
  });

  test('should navigate to Settings view', async () => {
    await page.click('.v-list-item-title:has-text("Settings")');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('should navigate to Debug view', async () => {
    await page.click('.v-list-item-title:has-text("Debug")');
    await expect(page.locator('h1:has-text("Debug")')).toBeVisible();
  });

  test('should show system info in Debug view', async () => {
    await page.click('.v-list-item-title:has-text("Debug")');
    await expect(page.locator('text=System Information')).toBeVisible();
    await expect(page.locator('text=Platform:')).toBeVisible();
    await expect(page.locator('text=Electron:')).toBeVisible();
  });

  test('should show footer with attribution', async () => {
    await expect(page.locator('text=Mark Cheli')).toBeVisible();
    await expect(page.locator('text=rigready.io')).toBeVisible();
    await expect(page.locator('text=GitHub')).toBeVisible();
  });

  test('should show input state UI immediately when a device is selected in Input Tester', async () => {
    await page.click('.v-list-item-title:has-text("Input Tester")');
    await expect(page.locator('h1:has-text("Input Tester")')).toBeVisible();

    const dropdown = page.locator('.v-select');
    await expect(dropdown).toBeVisible();
    await dropdown.click();
    await page.waitForTimeout(500);

    const deviceOptions = page.locator('.v-list-item').filter({ hasText: /pygame:|hid:/ });
    const deviceCount = await deviceOptions.count();

    if (deviceCount > 0) {
      await deviceOptions.first().click();
      await page.waitForTimeout(300);
      await expect(page.locator('text=Device Info')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('text=/\\d+ Axes/')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('text=/\\d+ Buttons/')).toBeVisible({ timeout: 3000 });
    } else {
      await page.keyboard.press('Escape');
      await expect(
        page.locator('text=Select a device from the dropdown to test inputs.')
      ).toBeVisible();
    }
  });

  test('should allow clicking on a device in Devices view to navigate to Input Tester', async () => {
    await page.click('.v-list-item-title:has-text("Devices")');
    await expect(page.locator('h1:has-text("Connected Devices")')).toBeVisible();
    await page.waitForTimeout(1000);

    const testButtons = page.locator('button:has-text("Test Inputs")');
    const buttonCount = await testButtons.count();

    if (buttonCount > 0) {
      await testButtons.first().click();
      await expect(page.locator('h1:has-text("Input Tester")')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('text=Device Info')).toBeVisible({ timeout: 3000 });
    } else {
      await expect(page.locator('h1:has-text("Connected Devices")')).toBeVisible();
    }
  });
});
