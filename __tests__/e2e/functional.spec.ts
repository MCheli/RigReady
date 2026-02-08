import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

/**
 * Functional E2E Tests
 *
 * Unlike the navigation/screenshot tests, these tests actually interact with
 * the app: filling forms, clicking buttons, creating data, and verifying
 * outcomes. Tests run sequentially and share state (profiles created in
 * earlier tests are visible in later ones).
 */

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
    cwd: path.join(__dirname, '../..'),
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await electronApp.close();
});

// ============================================================================
// Profile Wizard — Full walkthrough
// ============================================================================

test.describe('Profile Wizard: Full creation flow', () => {
  test('should open wizard from Profiles view', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(500);
    const wizardBtn = page.getByRole('button', { name: 'Wizard', exact: true });
    await expect(wizardBtn).toBeVisible();
    await wizardBtn.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('h1:has-text("Profile Wizard")')).toBeVisible();
  });

  test('Step 1: Next is disabled without a name', async () => {
    const nextBtn = page.locator('button:has-text("Next")');
    await expect(nextBtn).toBeDisabled();
  });

  test('Step 1: Fill name and select "Other" simulator', async () => {
    // Type a profile name
    const nameField = page.locator('input').first();
    await nameField.fill('E2E Test Profile');
    await page.waitForTimeout(200);

    // Open the game selector and pick "Other"
    const gameSelect = page.locator('.v-select').first();
    await gameSelect.click();
    await page.waitForTimeout(300);
    const otherOption = page.locator('.v-list-item').filter({ hasText: 'Other' });
    if (await otherOption.isVisible()) {
      await otherOption.click();
      await page.waitForTimeout(200);
    } else {
      // Close dropdown and proceed with default
      await page.keyboard.press('Escape');
    }

    // Next should now be enabled
    const nextBtn = page.locator('button:has-text("Next")');
    await expect(nextBtn).toBeEnabled();
  });

  test('Step 1 → Step 2: Click Next advances to Devices step', async () => {
    const nextBtn = page.locator('button:has-text("Next")');
    await nextBtn.click();
    await page.waitForTimeout(500);

    // Step 2 should show device-related content
    // The second chip should now be primary
    const chips = page.locator('.v-chip');
    const secondChip = chips.nth(1);
    await expect(secondChip).toHaveClass(/bg-primary/);
  });

  test('Step 2 → Step 3: Click Next advances to Software step', async () => {
    const nextBtn = page.locator('button:has-text("Next")');
    await nextBtn.click();
    await page.waitForTimeout(500);

    const chips = page.locator('.v-chip');
    const thirdChip = chips.nth(2);
    await expect(thirdChip).toHaveClass(/bg-primary/);
  });

  test('Step 3 → Step 4: Click Next advances to Displays step', async () => {
    const nextBtn = page.locator('button:has-text("Next")');
    await nextBtn.click();
    await page.waitForTimeout(500);

    // Step 4 should show Display Configuration heading (use h3 to avoid matching dropdown label)
    await expect(page.locator('h3:has-text("Display Configuration")')).toBeVisible();
  });

  test('Step 4: Save Current Display Config button works and auto-selects', async () => {
    // The inline text field and save button should be visible
    const configNameField = page.locator('input[placeholder*="Triple Monitor"]');
    await expect(configNameField).toBeVisible();
    await configNameField.fill('Wizard Test Config');
    await page.waitForTimeout(200);

    const saveBtn = page.locator('button:has-text("Save Current")');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await page.waitForTimeout(1000);

    // After saving, the text field should be cleared
    await expect(configNameField).toHaveValue('');

    // The saved config should be auto-selected in the dropdown
    await expect(page.locator('.v-select').filter({ hasText: 'Wizard Test Config' })).toBeVisible();
  });

  test('Step 4 → Step 5: Click Next advances to Tracked Configurations step', async () => {
    const nextBtn = page.locator('button:has-text("Next")');
    await nextBtn.click();
    await page.waitForTimeout(500);

    // Step 5 should show Tracked Configurations heading
    await expect(page.locator('h3:has-text("Tracked Configurations")')).toBeVisible();
  });

  test('Step 5: Add a tracked configuration', async () => {
    // Fill in name and path
    const nameInput = page.locator('input[placeholder*="DCS Input"]');
    const pathInput = page.locator('input[placeholder*="C:\\\\Users"]');

    if (await nameInput.isVisible()) {
      await nameInput.fill('Test Config');
      await pathInput.fill('C:\\test\\config.ini');
      await page.waitForTimeout(200);

      // Click the add button
      const addBtn = page.locator('.v-btn--icon').filter({ has: page.locator('.mdi-plus') });
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.waitForTimeout(300);

        // Verify the item appears in the list
        await expect(page.locator('text=Test Config')).toBeVisible();
      }
    }
  });

  test('Step 5: Create Profile button is visible and completes wizard', async () => {
    const createBtn = page.locator('button:has-text("Create Profile")');
    await expect(createBtn).toBeVisible();
    await createBtn.click();
    await page.waitForTimeout(2000);

    // Wizard should navigate to Home after creating the profile
    await expect(page.locator('h1:has-text("Home")')).toBeVisible();
  });

  test('Created profile should be visible on Home view', async () => {
    // The Home view should show the profile name somewhere (dropdown or title)
    const profileRef = page.locator('text=E2E Test Profile');
    await expect(profileRef.first()).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// Profile CRUD — Create via dialog, verify, delete
// ============================================================================

test.describe('Profile CRUD via dialog', () => {
  test('should create a profile via New Profile dialog', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(500);

    const newProfileBtn = page.locator('button:has-text("New Profile")');
    await newProfileBtn.click();
    await page.waitForTimeout(500);

    // Dialog should be visible
    await expect(page.locator('text=Create Profile').first()).toBeVisible();

    // Fill in the form
    const nameField = page.locator('.v-dialog input').first();
    await nameField.fill('Dialog Test Profile');
    await page.waitForTimeout(200);

    // Click Create
    const createBtn = page.locator('.v-dialog button:has-text("Create")');
    await createBtn.click();
    await page.waitForTimeout(1000);

    // Profile should appear in the list
    await expect(page.locator('text=Dialog Test Profile').first()).toBeVisible();
  });

  test('should select the created profile and show its detail panel', async () => {
    const profileCard = page.locator('text=Dialog Test Profile').first();
    await profileCard.click();
    await page.waitForTimeout(500);

    // Detail panel should show the profile name and checklist area
    await expect(page.locator('text=Checklist').first()).toBeVisible();
    await expect(page.locator('text=No checklist items yet').first()).toBeVisible();
  });

  test('should add a checklist item to the profile', async () => {
    // Click "Add Check"
    const addCheckBtn = page.locator('button:has-text("Add Check")');
    await addCheckBtn.click();
    await page.waitForTimeout(500);

    // Fill in check details
    const checkNameField = page.locator('.v-dialog input').first();
    await checkNameField.fill('Check Notepad');
    await page.waitForTimeout(200);

    // Fill process name (default type is "Process Running")
    const processNameField = page.locator('.v-dialog input[placeholder*="TrackIR5"]');
    if (await processNameField.isVisible()) {
      await processNameField.fill('notepad.exe');
    }

    // Click Save
    const saveBtn = page.locator('.v-dialog button:has-text("Save")');
    await saveBtn.click();
    await page.waitForTimeout(1000);

    // Check item should appear in the detail panel
    await expect(page.locator('text=Check Notepad').first()).toBeVisible();
  });

  test('should set the profile as active', async () => {
    // Look for the "Set Active" action on the profile card
    // ProfileCard has a menu with actions. Look for the active button.
    const profileCards = page.locator('.v-card').filter({ hasText: 'Dialog Test Profile' });
    const menuBtn = profileCards.first().locator('.v-btn--icon').first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(300);
      const setActiveOption = page.locator('text=Set Active');
      if (await setActiveOption.isVisible()) {
        await setActiveOption.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('should delete a checklist item', async () => {
    // Find the delete button (error-colored) next to "Check Notepad"
    const checkItem = page.locator('.v-list-item').filter({ hasText: 'Check Notepad' });
    await expect(checkItem).toBeVisible();

    // Click the delete button (last of 3 buttons: wrench, pencil, delete)
    const deleteBtn = checkItem.locator('button').last();
    await deleteBtn.click();

    // In-app ConfirmDialog should appear — find the overlay with the confirm card
    const confirmCard = page
      .locator('.v-overlay--active .v-card')
      .filter({ hasText: 'Delete Check' });
    await expect(confirmCard).toBeVisible({ timeout: 5000 });

    // Click the confirm button (last button in actions = "Delete")
    const confirmBtn = confirmCard.locator('.v-card-actions .v-btn').last();
    await confirmBtn.click();
    await page.waitForTimeout(3000);

    // Check item should be gone
    await expect(page.locator('text=No checklist items yet').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('should delete the profile', async () => {
    // Find the profile card and click its menu to delete
    const profileCards = page.locator('.v-card').filter({ hasText: 'Dialog Test Profile' });
    const menuBtn = profileCards.first().locator('.v-btn--icon').first();

    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(300);
      const deleteOption = page.locator('.v-list-item:has-text("Delete")');
      if (await deleteOption.isVisible()) {
        await deleteOption.click();
        await page.waitForTimeout(500);

        // In-app ConfirmDialog should appear
        const confirmDialog = page.locator('.v-card').filter({ hasText: 'Delete Profile' });
        await expect(confirmDialog).toBeVisible({ timeout: 3000 });
        const confirmBtn = confirmDialog.locator('button:has-text("Delete")');
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

// ============================================================================
// Home View — Preflight checks with the wizard-created profile
// ============================================================================

test.describe('Home View: Preflight checks', () => {
  test('should show Home with the active profile selected', async () => {
    await page.click('.v-list-item-title:has-text("Home")');
    await page.waitForTimeout(1500);
    await expect(page.locator('h1:has-text("Home")')).toBeVisible();

    // Should show either check results, no-checks state, or welcome state
    const hasResults = await page.locator('text=Check Results').isVisible();
    const hasNoChecks = await page.locator('text=No Checks Configured').isVisible();
    const hasWelcome = await page.locator('text=Welcome to RigReady').isVisible();
    expect(hasResults || hasNoChecks || hasWelcome).toBe(true);
  });

  test('should have a profile selector dropdown', async () => {
    const dropdown = page.locator('.v-select').filter({ hasText: 'Profile' });
    await expect(dropdown.first()).toBeVisible();
  });

  test('should have Edit Profile button that navigates to Profiles', async () => {
    const editBtn = page.locator('button:has-text("Edit Profile")');
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('h1:has-text("Profiles")')).toBeVisible();
    }
  });
});

// ============================================================================
// Displays View — Save and manage display configurations
// ============================================================================

test.describe('Displays View: Save display configuration', () => {
  test('should show Displays view with current monitors', async () => {
    await page.click('.v-list-item-title:has-text("Displays")');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Display Configuration")')).toBeVisible();
  });

  test('should save a display configuration', async () => {
    const saveBtn = page.locator('button:has-text("Save Current")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await page.waitForTimeout(500);

    // In-app PromptDialog should appear
    const dialog = page.locator('.v-dialog:visible');
    await expect(dialog).toBeVisible();

    // Fill in the configuration name
    const nameField = dialog.locator('input');
    await nameField.fill('E2E Display Config');
    await page.waitForTimeout(200);

    // Click OK
    const okBtn = dialog.locator('button:has-text("OK")');
    await okBtn.click();
    await page.waitForTimeout(2000);

    // Configuration should appear in saved list
    await expect(page.locator('text=E2E Display Config').first()).toBeVisible({ timeout: 5000 });
  });

  test('should delete the saved display configuration', async () => {
    const configRow = page.locator('text=E2E Display Config').first();
    if (await configRow.isVisible()) {
      // Find the delete button near this config entry
      const parent = configRow.locator('..').locator('..');
      const deleteBtn = parent.locator('button').filter({ has: page.locator('.mdi-delete') });
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.waitForTimeout(500);

        // In-app ConfirmDialog should appear
        const confirmDialog = page.locator('.v-card').filter({ hasText: 'Delete Configuration' });
        await expect(confirmDialog).toBeVisible({ timeout: 3000 });
        const confirmBtn = confirmDialog.locator('button:has-text("Delete")');
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

// ============================================================================
// Settings View — Toggle settings, auto-detect simulators
// ============================================================================

test.describe('Settings View: Functional interactions', () => {
  test('should navigate to Settings and show simulator table', async () => {
    await page.click('.v-list-item-title:has-text("Settings")');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    // Should show at least one simulator name in the table
    await expect(page.locator('text=DCS World').first()).toBeVisible();
  });

  test('should click Auto-Detect All and get results', async () => {
    const autoDetectBtn = page.locator('button:has-text("Auto-Detect All")');
    if (await autoDetectBtn.isVisible()) {
      await autoDetectBtn.click();
      await page.waitForTimeout(3000);
      // After auto-detect, simulator rows should still be visible
      await expect(page.locator('text=DCS World').first()).toBeVisible();
    }
  });

  test('should toggle "Check for updates on startup" setting', async () => {
    const toggle = page.locator('.v-switch').filter({ hasText: 'Check for updates' });
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(500);
      // Click again to restore
      await toggle.click();
      await page.waitForTimeout(500);
    }
  });
});

// ============================================================================
// Keybindings View — Create and manage keybinding profiles
// ============================================================================

test.describe('Keybindings View: Profile management', () => {
  test('should navigate to Keybindings view', async () => {
    await page.click('.v-list-item-title:has-text("Keybindings")');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Keybinding Manager")')).toBeVisible();
  });

  test('should create a keybinding profile', async () => {
    const newBtn = page.locator('button:has-text("New Profile")');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(500);

      // Fill the dialog
      const nameField = page.locator('.v-dialog input').first();
      await nameField.fill('E2E Keybinding Profile');
      await page.waitForTimeout(200);

      const createBtn = page.locator('.v-dialog button:has-text("Create")');
      await createBtn.click();
      await page.waitForTimeout(1000);

      // Profile should appear in the list
      await expect(page.locator('text=E2E Keybinding Profile').first()).toBeVisible();
    }
  });

  test('should switch between all keybinding tabs', async () => {
    const tabs = [
      'Sim Backups',
      'DCS Bindings',
      'Duplicates',
      'Per Device',
      'Snapshots',
      'UUID Migration',
    ];
    for (const tabName of tabs) {
      const tab = page.locator(`.v-tab:has-text("${tabName}")`);
      if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(300);
      }
    }
    // Switch back to profiles tab
    const profilesTab = page.locator('.v-tab:has-text("Keybinding Profiles")');
    if (await profilesTab.isVisible()) {
      await profilesTab.click();
      await page.waitForTimeout(300);
    }
  });

  test('should delete the keybinding profile', async () => {
    const profileItem = page.locator('.v-list-item').filter({ hasText: 'E2E Keybinding Profile' });
    if (await profileItem.isVisible()) {
      // Open the menu for this profile
      const menuBtn = profileItem.locator('.v-btn--icon').first();
      if (await menuBtn.isVisible()) {
        await menuBtn.click();
        await page.waitForTimeout(300);
        const deleteOption = page.locator('.v-list-item:has-text("Delete")');
        if (await deleteOption.isVisible()) {
          await deleteOption.click();
          await page.waitForTimeout(500);

          // In-app ConfirmDialog should appear
          const confirmDialog = page.locator('.v-card').filter({ hasText: 'Delete Profile' });
          await expect(confirmDialog).toBeVisible({ timeout: 3000 });
          const confirmBtn = confirmDialog.locator('button:has-text("Delete")');
          await confirmBtn.click();
          await page.waitForTimeout(1000);
        }
      }
    }
  });
});

// ============================================================================
// Debug View — Export logs
// ============================================================================

test.describe('Debug View: Functional checks', () => {
  test('should display system info with actual values', async () => {
    await page.click('.v-list-item-title:has-text("Debug")');
    await page.waitForTimeout(500);
    await expect(page.locator('text=System Information')).toBeVisible();
    await expect(page.locator('text=Platform:')).toBeVisible();
    // Should show "win32" as platform on Windows
    await expect(page.locator('text=win32')).toBeVisible();
  });

  test('should show device status section', async () => {
    await expect(page.locator('text=Device Status')).toBeVisible();
  });

  test('should click Export Logs button', async () => {
    const exportBtn = page.locator('button:has-text("Export Logs")');
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await page.waitForTimeout(1000);
      // Export should complete (may show success toast or handle silently)
    }
  });

  test('should click Refresh button', async () => {
    const refreshBtn = page.locator('button').filter({ has: page.locator('.mdi-refresh') });
    if (await refreshBtn.first().isVisible()) {
      await refreshBtn.first().click();
      await page.waitForTimeout(1000);
      // System info should still be visible after refresh
      await expect(page.locator('text=System Information')).toBeVisible();
    }
  });
});

// ============================================================================
// Keyboard shortcuts
// ============================================================================

test.describe('Keyboard shortcuts', () => {
  test('Ctrl+1 navigates to Home', async () => {
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Home")')).toBeVisible();
  });

  test('Ctrl+2 navigates to Profiles', async () => {
    await page.keyboard.press('Control+2');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Profiles")')).toBeVisible();
  });

  test('Ctrl+3 navigates to Devices', async () => {
    await page.keyboard.press('Control+3');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Connected Devices")')).toBeVisible();
  });

  test('Ctrl+5 navigates to Displays', async () => {
    await page.keyboard.press('Control+5');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Display Configuration")')).toBeVisible();
  });

  test('Ctrl+8 navigates to Settings', async () => {
    await page.keyboard.press('Control+8');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('Ctrl+9 navigates to Debug', async () => {
    await page.keyboard.press('Control+9');
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("Debug")')).toBeVisible();
  });
});

// ============================================================================
// Cleanup — Remove wizard-created profile
// ============================================================================

test.describe('Cleanup: Remove test data', () => {
  test('should delete all test profiles', async () => {
    await page.click('.v-list-item-title:has-text("Profiles")');
    await page.waitForTimeout(500);

    // Delete profiles in a loop since there may be duplicates from previous runs
    const maxDeletions = 10;
    for (let i = 0; i < maxDeletions; i++) {
      // Look for any test profile card
      const profileCard = page
        .locator('.v-card')
        .filter({ hasText: /E2E Test Profile|Dialog Test Profile/ })
        .first();
      const isVisible = await profileCard.isVisible().catch(() => false);
      if (!isVisible) break;

      const menuBtn = profileCard.locator('.v-btn--icon').first();
      if (!(await menuBtn.isVisible().catch(() => false))) break;

      await menuBtn.click();
      await page.waitForTimeout(300);

      const deleteOption = page.locator('.v-list-item:has-text("Delete")');
      if (!(await deleteOption.isVisible().catch(() => false))) {
        await page.keyboard.press('Escape');
        break;
      }

      await deleteOption.click();
      await page.waitForTimeout(500);

      // In-app ConfirmDialog should appear
      const confirmDialog = page.locator('.v-card').filter({ hasText: 'Delete Profile' });
      if (await confirmDialog.isVisible().catch(() => false)) {
        const confirmBtn = confirmDialog.locator('button:has-text("Delete")');
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('should delete wizard-created display configurations', async () => {
    await page.click('.v-list-item-title:has-text("Displays")');
    await page.waitForTimeout(500);

    // Delete any "Wizard Test Config" or "E2E Display Config" entries
    const maxDeletions = 5;
    for (let i = 0; i < maxDeletions; i++) {
      const configEntry = page
        .locator('.v-card')
        .filter({ hasText: /Wizard Test Config|E2E Display Config/ })
        .first();
      const isVisible = await configEntry.isVisible().catch(() => false);
      if (!isVisible) break;

      const deleteBtn = configEntry.locator('button').filter({ has: page.locator('.mdi-delete') });
      if (!(await deleteBtn.isVisible().catch(() => false))) break;

      await deleteBtn.click();
      await page.waitForTimeout(500);

      // In-app ConfirmDialog should appear
      const confirmDialog = page
        .locator('.v-overlay--active .v-card')
        .filter({ hasText: 'Delete Configuration' });
      if (await confirmDialog.isVisible().catch(() => false)) {
        const confirmBtn = confirmDialog.locator('.v-card-actions .v-btn').last();
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});
