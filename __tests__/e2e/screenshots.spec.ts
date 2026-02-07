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
    await page.click('.v-list-item-title:has-text("Launch")');
    await page.waitForSelector('h1:has-text("Launch Center")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '01-launch-view.png'),
      fullPage: true,
    });
  });

  test('capture Devices view', async () => {
    await page.click('.v-list-item-title:has-text("Devices")');
    await page.waitForSelector('h1:has-text("Connected Devices")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '02-devices-view.png'),
      fullPage: true,
    });
  });

  test('capture Input Tester view', async () => {
    await page.click('.v-list-item-title:has-text("Input Tester")');
    await page.waitForSelector('h1:has-text("Input Tester")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '03-input-tester-view.png'),
      fullPage: true,
    });
  });

  test('capture Displays view', async () => {
    await page.click('.v-list-item-title:has-text("Displays")');
    await page.waitForSelector('h1:has-text("Display Configuration")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '04-displays-view.png'),
      fullPage: true,
    });
  });

  test('capture Keybindings view - Profiles tab', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await page.waitForSelector('h1:has-text("Keybinding Manager")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '05-keybindings-profiles-view.png'),
      fullPage: true,
    });
  });

  test('capture Keybindings view - Sim Backups tab', async () => {
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
    await page.click('.v-list-item-title:has-text("Settings")');
    await page.waitForSelector('h1:has-text("Settings")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '07-settings-view.png'),
      fullPage: true,
    });
  });

  test('capture Debug view', async () => {
    await page.click('.v-list-item-title:has-text("Debug")');
    await page.waitForSelector('h1:has-text("Debug")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '08-debug-view.png'),
      fullPage: true,
    });
  });

  // ===== New screenshots for MVP views =====

  test('capture Profiles view', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '09-profiles-view.png'),
      fullPage: true,
    });
  });

  test('capture Profiles create dialog', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(300);
    const newProfileBtn = page.locator('button:has-text("New Profile")');
    if (await newProfileBtn.isVisible()) {
      await newProfileBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotDir, '10-profiles-create-dialog.png'),
        fullPage: true,
      });
      // Close dialog if open
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });

  test('capture Checklist view', async () => {
    await page.click('.v-list-item-title:has-text("Checklist")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '11-checklist-view.png'),
      fullPage: true,
    });
  });

  test('capture Profile Wizard step 1', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(300);
    const wizardBtn = page.locator('button', { hasText: /^Wizard$/ });
    if (await wizardBtn.isVisible()) {
      await wizardBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotDir, '12-profile-wizard-step1.png'),
        fullPage: true,
      });
      // Navigate back to profiles
      const backBtn = page.locator('button:has-text("Back")');
      if (await backBtn.isVisible()) {
        await backBtn.click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('capture Keybindings - Duplicates tab', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await page.waitForTimeout(300);
    const tab = page.locator('text=Duplicates');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotDir, '13-keybindings-duplicates-tab.png'),
        fullPage: true,
      });
    }
  });

  test('capture Keybindings - Per Device tab', async () => {
    const tab = page.locator('text=Per Device');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotDir, '14-keybindings-per-device-tab.png'),
        fullPage: true,
      });
    }
  });

  test('capture Keybindings - Snapshots tab', async () => {
    const tab = page.locator('text=Snapshots');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotDir, '15-keybindings-snapshots-tab.png'),
        fullPage: true,
      });
    }
  });

  test('capture Keybindings - UUID Migration tab', async () => {
    const tab = page.locator('text=UUID Migration');
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotDir, '16-keybindings-uuid-migration-tab.png'),
        fullPage: true,
      });
    }
  });

  test('capture Stream Deck view', async () => {
    await page.click('.v-list-item-title:has-text("Stream Deck")');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, '17-streamdeck-view.png'),
      fullPage: true,
    });
  });
});
