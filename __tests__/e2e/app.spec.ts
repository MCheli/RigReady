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
    // Check for navigation items in the drawer (using v-list-item-title class)
    await expect(page.locator('.v-list-item-title:has-text("Launch")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Devices")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Input Tester")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Displays")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Keybindings")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Settings")')).toBeVisible();
    await expect(page.locator('.v-list-item-title:has-text("Debug")')).toBeVisible();
  });

  test('should show Launch view by default', async () => {
    // The Launch view should be active by default
    await expect(page.locator('h1:has-text("Launch Center")')).toBeVisible();
  });

  test('should navigate to Devices view', async () => {
    await page.click('text=Devices');
    await expect(page.locator('h1:has-text("Connected Devices")')).toBeVisible();
  });

  test('should navigate to Input Tester view', async () => {
    // Click on Input Tester in the navigation
    await page.click('text=Input Tester');

    // Should show the Input Tester heading
    await expect(page.locator('h1:has-text("Input Tester")')).toBeVisible();
  });

  test('should navigate to Displays view', async () => {
    await page.click('text=Displays');
    await expect(page.locator('h1:has-text("Display Configuration")')).toBeVisible();
  });

  test('should navigate to Keybindings view', async () => {
    await page.click('text=Keybindings');
    await expect(page.locator('h1:has-text("Keybinding Manager")')).toBeVisible();
  });

  test('should navigate to Settings view', async () => {
    await page.click('text=Settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('should navigate to Debug view', async () => {
    await page.click('text=Debug');
    await expect(page.locator('h1:has-text("Debug")')).toBeVisible();
  });

  test('should show system info in Debug view', async () => {
    // Navigate to debug if not already there
    await page.click('text=Debug');

    // Check for system info card
    await expect(page.locator('text=System Information')).toBeVisible();
    await expect(page.locator('text=Platform:')).toBeVisible();
    await expect(page.locator('text=Electron:')).toBeVisible();
  });

  test('should show footer with attribution', async () => {
    // Check for footer elements
    await expect(page.locator('text=Mark Cheli')).toBeVisible();
    await expect(page.locator('text=rigready.io')).toBeVisible();
    await expect(page.locator('text=GitHub')).toBeVisible();
  });

  test('should navigate back to Launch view', async () => {
    await page.click('text=Launch');
    await expect(page.locator('h1:has-text("Launch Center")')).toBeVisible();
  });

  test('should show New Profile button on Launch view', async () => {
    await expect(page.locator('button:has-text("New Profile")')).toBeVisible();
  });

  test('should show Refresh Status button on Launch view', async () => {
    await expect(page.locator('button:has-text("Refresh Status")')).toBeVisible();
  });

  test('should show Running Support Software section', async () => {
    await expect(page.locator('text=Running Support Software')).toBeVisible();
  });

  test('should show input state UI immediately when a device is selected in Input Tester', async () => {
    // Navigate to Input Tester
    await page.click('text=Input Tester');
    await expect(page.locator('h1:has-text("Input Tester")')).toBeVisible();

    // Wait for devices dropdown to be available
    const dropdown = page.locator('.v-select');
    await expect(dropdown).toBeVisible();

    // Check if there are any devices available by clicking the dropdown
    await dropdown.click();

    // Wait a moment for dropdown options to appear
    await page.waitForTimeout(500);

    // Try to find device options in the dropdown menu
    const deviceOptions = page.locator('.v-list-item').filter({ hasText: /pygame:|hid:/ });
    const deviceCount = await deviceOptions.count();

    if (deviceCount > 0) {
      // Select the first device
      await deviceOptions.first().click();

      // Wait for input state to initialize
      await page.waitForTimeout(300);

      // Verify the input state UI is visible (Device Info card) - this should appear immediately
      // without requiring any button press on the device
      await expect(page.locator('text=Device Info')).toBeVisible({ timeout: 3000 });

      // Also verify we see the input counts (Axes, Buttons, Hats chips)
      await expect(page.locator('text=/\\d+ Axes/')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('text=/\\d+ Buttons/')).toBeVisible({ timeout: 3000 });
    } else {
      // No devices available - close dropdown and verify empty state message
      await page.keyboard.press('Escape');
      await expect(
        page.locator('text=Select a device from the dropdown to test inputs.')
      ).toBeVisible();
    }
  });

  test('should allow clicking on a device in Devices view to navigate to Input Tester', async () => {
    // Navigate to Devices view
    await page.click('text=Devices');
    await expect(page.locator('h1:has-text("Connected Devices")')).toBeVisible();

    // Wait for devices to load
    await page.waitForTimeout(1000);

    // Check if there are any "Test Inputs" buttons on device cards
    const testButtons = page.locator('button:has-text("Test Inputs")');
    const buttonCount = await testButtons.count();

    if (buttonCount > 0) {
      // Click the first Test Inputs button
      await testButtons.first().click();

      // Should navigate to Input Tester
      await expect(page.locator('h1:has-text("Input Tester")')).toBeVisible({ timeout: 3000 });

      // Should have a device selected (Device Info card visible)
      await expect(page.locator('text=Device Info')).toBeVisible({ timeout: 3000 });
    } else {
      // No testable devices - test passes by verifying we're on the Devices view
      await expect(page.locator('h1:has-text("Connected Devices")')).toBeVisible();
    }
  });
});
