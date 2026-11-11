import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * The built-in assistant, app-wide: off until a key is stored, then a button in the app bar.
 * With scripted Anthropic answers (tool use), it finds the helper programs of a DCS session,
 * proposes a setup that the user saves, and drafts a script that is shown in full, saved,
 * asked about before it runs, and held back once the file changes until it is approved again.
 */

const KEY = 'sk-ant-api03-e2e-NOT-A-REAL-KEY-0000-wxyz';

async function storeKey(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('ai-key-input').locator('input').fill(KEY);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-key-state')).toHaveText('An Anthropic API key is stored');
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').locator('textarea').first().fill(text);
  await page.getByTestId('assistant-prepare').click();
  await expect(page.getByTestId('assistant-preview')).toBeVisible();
}

test('assistant: sets up a DCS session and writes a script that asks before it runs', async ({
  rig,
}) => {
  const run = await rig.launch('assistant-dcs', 'assistant');
  const { page, shot } = run;
  // Off until a key is stored: the bar has no assistant button.
  await expect(page.getByTestId('palette-open')).toBeVisible();
  await expect(page.getByTestId('assistant-open')).toHaveCount(0);
  await storeKey(page);
  await expect(page.getByTestId('assistant-open')).toBeVisible();
  await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await shot('panel-open');

  // Every request is shown first; nothing goes until Send.
  await ask(page, 'Set up a DCS session with SimAppPro, TrackIR and SRS');
  await expect(page.getByTestId('assistant-preview-contents')).toContainText(
    'Your message: "Set up a DCS session with SimAppPro, TrackIR and SRS"'
  );
  await page.getByTestId('assistant-preview-toggle').click();
  await expect(page.getByTestId('assistant-preview-body')).toContainText('"programs_find"');
  await expect(page.getByTestId('assistant-preview-body')).not.toContainText(KEY);
  await shot('first-request');
  await page.getByTestId('assistant-send').click();

  // The tool answered: the next request carries what it found, and is shown again.
  await expect(page.getByTestId('assistant-tool').first()).toContainText('Find installed programs');
  await expect(page.getByTestId('assistant-preview-contents')).toContainText('programs_find');
  await page.getByTestId('assistant-preview-toggle').click();
  const body = page.getByTestId('assistant-preview-body');
  await expect(body).toContainText('{LOCALAPPDATA}/Programs/SimAppPro/SimAppPro.exe');
  await expect(body).toContainText('{PROGRAM_FILES_X86}/TrackIR5/TrackIR5.exe');
  await expect(body).toContainText('{PROGRAM_FILES}/DCS-SimpleRadio-Standalone/SR-ClientRadio.exe');
  await expect(body).not.toContainText(run.home);
  await shot('found-programs');
  // The rest of this conversation goes without the preview.
  await page.getByTestId('assistant-skip-preview').locator('input').check();
  await page.getByTestId('assistant-send').click();

  const draft = page.getByTestId('assistant-setup-draft');
  await expect(draft).toContainText('New setup: DCS session');
  await expect(page.getByTestId('assistant-draft-check')).toHaveCount(3);
  await expect(page.getByTestId('assistant-reply').last()).toContainText('press Save');
  await draft.scrollIntoViewIfNeeded();
  await shot('setup-proposal');
  await page.getByTestId('assistant-setup-save').click();
  await expect(page.getByTestId('assistant-saved')).toContainText('Saved DCS session');
  await expect(page.getByTestId('assistant-setup-draft')).toHaveCount(0);

  // A script: the whole text and the explanation, saved only on Save.
  await ask(page, 'Write a script to start SRS minimized as the fix of the SRS radio check');
  await expect(page.getByTestId('assistant-script-draft')).toBeVisible();
  const text = page.getByTestId('assistant-script-text');
  await expect(text).toContainText('Written by an assistant (Built-in assistant)');
  await expect(text).toContainText('Start-Process -FilePath $exe -WindowStyle Minimized');
  await expect(page.getByTestId('assistant-script-explanation')).toContainText(
    'Starts the SRS radio client minimized'
  );
  await page.getByTestId('assistant-script-draft').scrollIntoViewIfNeeded();
  await shot('script-draft');
  const file = path.join(run.dataRoot, 'scripts', 'assistant', 'srs-start.ps1');
  await expect(fs.access(file)).rejects.toThrow();
  await page.getByTestId('assistant-script-save').click();
  await expect(page.getByTestId('assistant-saved').last()).toContainText(
    'Saved srs-start.ps1 and added it to DCS session, asking before every run'
  );
  expect(await fs.readFile(file, 'utf8')).toContain('Get-Process SR-ClientRadio');
  await page.getByTestId('assistant-close').click();

  // On the Play screen the fix asks first, with the script's path.
  await page.getByTestId('mode-fly').click();
  const srs = checkRow(page, 'SRS radio');
  await expect(srs).toBeVisible();
  await srs.getByTestId('check-fix').click();
  await expect(page.getByTestId('confirm-run-exe')).toHaveText(
    '{RIGREADY_HOME}/scripts/assistant/srs-start.ps1'
  );
  await shot('run-asks-first');
  await page.getByTestId('confirm-run-skip').click();

  // Changed behind RigReady's back: asked again, and not run until it is approved again.
  await fs.appendFile(file, '\r\nRemove-Item "$env:USERPROFILE\\Documents\\*" -Recurse\r\n');
  await srs.getByTestId('check-fix').click();
  await page.getByTestId('confirm-run-ok').click();
  await expect(srs.getByTestId('fix-result')).toContainText('changed since you approved it');
  await shot('changed-not-run');
  await page.getByTestId('assistant-open').click();
  const changed = page.getByTestId('assistant-script-changed');
  await expect(changed).toContainText('srs-start.ps1 changed since you approved it');
  await expect(page.getByTestId('assistant-script-current')).toContainText('Remove-Item');
  await changed.scrollIntoViewIfNeeded();
  await shot('changed-shown-again');
  await page.getByTestId('assistant-script-approve').click();
  await expect(page.getByTestId('assistant-script-changed')).toHaveCount(0);
  await expect(page.getByTestId('assistant-saved').last()).toContainText(
    'Approved srs-start.ps1 as it is now.'
  );
});
