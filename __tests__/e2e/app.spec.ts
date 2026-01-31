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

test.describe('Sim Manager App', () => {
  test('should display the app title', async () => {
    const title = await page.title();
    expect(title).toBe('Sim Manager');
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
    await expect(page.locator('text=GitHub')).toBeVisible();
    await expect(page.locator('text=MIT')).toBeVisible();
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
});
