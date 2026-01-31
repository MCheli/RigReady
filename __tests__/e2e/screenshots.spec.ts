import { test, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Screenshot capture tests for visual review.
 * These tests navigate to each view and capture a screenshot for visual inspection.
 * Screenshots are saved to __tests__/screenshots/ directory.
 */

let electronApp: ElectronApplication;
let page: Page;
const screenshotDir = path.join(__dirname, '../screenshots');

test.beforeAll(async () => {
  // Ensure screenshot directory exists
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // Launch the app
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
    cwd: path.join(__dirname, '../..'),
  });

  // Get the first window
  page = await electronApp.firstWindow();

  // Wait for the app to be ready
  await page.waitForLoadState('domcontentloaded');

  // Give Vue/Vuetify time to fully render
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  await electronApp.close();
});

test.describe('UI Screenshots', () => {
  test('capture Launch view', async () => {
    await page.click('text=Launch');
    await page.waitForSelector('h1:has-text("Launch Center")');
    await page.waitForTimeout(500); // Allow animations to complete
    await page.screenshot({
      path: path.join(screenshotDir, '01-launch-view.png'),
      fullPage: true,
    });
  });

  test('capture Devices view', async () => {
    await page.click('text=Devices');
    await page.waitForSelector('h1:has-text("Connected Devices")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '02-devices-view.png'),
      fullPage: true,
    });
  });

  test('capture Input Tester view', async () => {
    await page.click('text=Input Tester');
    await page.waitForSelector('h1:has-text("Input Tester")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '03-input-tester-view.png'),
      fullPage: true,
    });
  });

  test('capture Displays view', async () => {
    await page.click('text=Displays');
    await page.waitForSelector('h1:has-text("Display Configuration")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '04-displays-view.png'),
      fullPage: true,
    });
  });

  test('capture Keybindings view - Profiles tab', async () => {
    await page.click('text=Keybindings');
    await page.waitForSelector('h1:has-text("Keybinding Manager")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '05-keybindings-profiles-view.png'),
      fullPage: true,
    });
  });

  test('capture Keybindings view - Sim Backups tab', async () => {
    // Click on Sim Backups tab if it exists
    const simBackupsTab = page.locator('text=Sim Backups');
    if (await simBackupsTab.isVisible()) {
      await simBackupsTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotDir, '06-keybindings-backups-view.png'),
        fullPage: true,
      });
    }
  });

  test('capture Settings view', async () => {
    await page.click('text=Settings');
    await page.waitForSelector('h1:has-text("Settings")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '07-settings-view.png'),
      fullPage: true,
    });
  });

  test('capture Debug view', async () => {
    await page.click('text=Debug');
    await page.waitForSelector('h1:has-text("Debug")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '08-debug-view.png'),
      fullPage: true,
    });
  });
});
