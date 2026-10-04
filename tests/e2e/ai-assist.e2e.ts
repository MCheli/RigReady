import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type RunningApp } from './harness';

/** Binding guide and AI binding help: no-key mode, walkthrough, key entry, suggestions, approval. */

const STICK = 'WINWING Orion Joystick Base 2 + JGRIP-F16';
const KEY = 'sk-ant-api03-e2e-NOT-A-REAL-KEY-0000-wxyz';

async function openGuide(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-ai-assist').click();
  await expect(page.getByTestId('ai-guide-page')).toBeVisible();
  await expect(page.getByTestId('ai-aircraft')).toContainText('F/A-18C');
}

async function storeKey(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('ai-key-input').locator('input').fill(KEY);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-key-state')).toHaveText('An Anthropic API key is stored');
  await expect(page.getByTestId('ai-settings-key')).toHaveText('Key ending in …wxyz');
}

/** The stick as DirectInput reports it: 6 axes, 42 buttons, one hat. */
function stick(buttons: number[] = []) {
  return {
    index: 9,
    name: STICK,
    axes: [0, 0, 0, 0, 0, 0],
    buttons: Array.from({ length: 42 }, (_, i) => buttons.includes(i + 1)),
    hats: [[0, 0]] as [number, number][],
    timestamp: Date.now(),
  };
}

const stickFile = async (run: RunningApp): Promise<string> => {
  const dir = path.join(
    run.home,
    'Saved Games',
    'DCS',
    'Config',
    'Input',
    'FA-18C_hornet',
    'joystick'
  );
  const name = (await fs.readdir(dir)).find((f) => f.startsWith('WINWING Orion Joystick'))!;
  return path.join(dir, name);
};

/** Every file under a folder, as text, to prove the key was never written. */
async function allText(dir: string): Promise<string> {
  const parts: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile())
      parts.push(await fs.readFile(path.join(entry.parentPath, entry.name), 'latin1'));
  }
  return parts.join('\n');
}

test('ai-assist: without a key the guide, priorities and walkthrough work, with only a link to set up AI', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-hornet', 'ai-assist-no-key');
  const { page, shot } = run;
  await openGuide(page);

  await expect(page.getByTestId('ai-walkthrough')).toBeVisible();
  await expect(page.getByTestId('ai-current-item')).toHaveAttribute('data-item', 'pitch-roll');
  await expect(page.getByTestId('ai-current-item')).toContainText('Moves the nose up and down');
  await expect(page.getByTestId('ai-action').first()).toContainText(
    'Pitch (stick forward and back)'
  );
  await expect(page.getByTestId('ai-action').first()).toContainText(`${STICK} · Y axis`);
  // No AI controls without a key, only the link to set it up.
  await expect(page.getByTestId('ai-setup-link')).toBeVisible();
  await expect(page.getByTestId('ai-tab-ai')).toHaveCount(0);
  await expect(page.getByTestId('ai-explain')).toHaveCount(0);
  await shot('walkthrough');

  // The sensor control switch: plain labels with DCS's own names beside them.
  await page.getByTestId('ai-item-sensor-control').click();
  const fwd = page.locator('[data-testid="ai-action"][data-action="Sensor Control Switch - Fwd"]');
  await expect(fwd).toContainText('Sensor select: HUD');
  await expect(fwd).toContainText(`${STICK} · Button 37`);
  await shot('plain-labels');

  await page.getByTestId('ai-tab-priorities').click();
  await expect(page.getByTestId('ai-priorities')).toBeVisible();
  await expect(page.getByTestId('ai-tier-must')).toContainText('Must have to fly and fight');
  await expect(
    page.locator('[data-testid="ai-priority-item"][data-item="trigger"]')
  ).toHaveAttribute('data-status', 'bound');
  await expect(page.locator('[data-testid="ai-role-plan"][data-role="stick"]')).toContainText(
    'Gun trigger'
  );
  await expect(page.getByTestId('ai-sources')).toContainText("DCS's own");
  await shot('priorities');

  await page.getByTestId('ai-setup-link').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('ai-settings-key')).toContainText('No key yet');
});

test('ai-assist: the walkthrough binds what you press, shows the exact change, writes it with a backup and undoes it', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-hornet', 'ai-assist-walkthrough');
  const { page, shot } = run;
  await openGuide(page);
  const file = await stickFile(run);
  const before = await fs.readFile(file, 'utf8');

  await page.getByTestId('ai-item-cage').click();
  await expect(page.getByTestId('ai-current-item')).toHaveAttribute('data-item', 'cage');
  await page.getByTestId('ai-bind').first().click();
  await expect(page.getByTestId('ai-listening')).toBeVisible();
  await shot('press-the-control');
  await run.sendInput([stick()]);
  await run.sendInput([stick([21])]);
  await expect(page.getByTestId('ai-action-staged')).toContainText(`${STICK} · Button 21`);
  await expect(page.getByTestId('ai-staged-item')).toHaveCount(1);
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  await shot('staged');

  await page.getByTestId('ai-review').click();
  await expect(page.getByTestId('ai-review-dialog')).toBeVisible();
  await expect(page.getByTestId('ai-review-file')).toContainText(
    'Cage/Uncage Button: bind Button 21'
  );
  await page.getByTestId('ai-review-toggle-diff').click();
  await expect(page.getByTestId('ai-review-diff')).toContainText('JOY_BTN21');
  await shot('review');
  await page.getByTestId('ai-review-apply').click();
  await expect(page.getByTestId('ai-saved')).toContainText(
    'Bind 1 action from the binding guide (F/A-18C)'
  );
  expect(await fs.readFile(file, 'utf8')).toContain('JOY_BTN21');
  await expect(
    page.locator('[data-testid="ai-action"][data-action="Cage/Uncage Button"]')
  ).toContainText(`${STICK} · Button 21`);
  await shot('written');

  await page.getByTestId('ai-undo').click();
  await expect(page.getByTestId('ai-saved')).toContainText('Undone');
  expect(await fs.readFile(file, 'utf8')).toBe(before);

  // Progress is kept across a restart.
  await page.getByTestId('ai-done').click();
  await expect(page.getByTestId('ai-progress')).toContainText('1 of');
  const again = await run.restart();
  await openGuide(again.page);
  await expect(again.page.getByTestId('ai-progress')).toContainText('1 of');
  await expect(again.page.getByTestId('ai-current-item')).not.toHaveAttribute('data-item', 'cage');
  await again.shot('progress-after-restart');
});

test('ai-assist: the key is entered in Settings, tested, never shown again, and what is sent is stated', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-hornet', 'ai-assist-key');
  const { page, shot } = run;
  await storeKey(page);
  await expect(page.getByTestId('ai-key-input').locator('input')).toHaveValue('');
  await page.getByTestId('ai-key-test').click();
  await expect(page.getByTestId('ai-key-test-result')).toHaveText(
    /The key works with Claude Opus 5.5/
  );
  await expect(page.getByTestId('ai-what-is-sent')).toContainText(
    'Never sent: file paths, device ids'
  );
  await page.getByTestId('ai-settings').scrollIntoViewIfNeeded();
  expect(await page.content()).not.toContain(KEY);
  await shot('settings');
  expect(await allText(run.dataRoot)).not.toContain(KEY);

  await page.getByTestId('ai-key-remove').click();
  await expect(page.getByTestId('ai-settings-key')).toContainText('No key yet');
  await shot('removed');
});

test('ai-assist: a suggestion round trip shows what is sent, checks the answer, and applies only what is ticked after review', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-hornet', 'ai-assist-suggest');
  const { page, shot } = run;
  await storeKey(page);
  await openGuide(page);
  await page.getByTestId('ai-tab-ai').click();

  await page.getByTestId('ai-suggest').click();
  const payload = page.getByTestId('ai-payload-dialog');
  await expect(payload).toBeVisible();
  await expect(page.getByTestId('ai-payload-contents')).toContainText(
    '1072 actions of the F/A-18C'
  );
  await expect(page.getByTestId('ai-payload-contents')).toContainText(STICK);
  await page.getByTestId('ai-payload-toggle').click();
  await expect(page.getByTestId('ai-payload-body')).toContainText('"cache_control"');
  await expect(page.getByTestId('ai-payload-body')).not.toContainText(KEY);
  await expect(page.getByTestId('ai-payload-body')).not.toContainText('806DDF00');
  await shot('payload');
  await page.getByTestId('ai-payload-send').click();

  await expect(page.getByTestId('ai-round')).toBeVisible();
  await expect(page.getByTestId('ai-suggestion')).toHaveCount(4);
  await expect(page.getByTestId('ai-dropped')).toContainText('2 lines of the answer were left out');
  const gear = page.locator(
    '[data-testid="ai-suggestion"][data-action="Landing Gear Control Handle - UP/DOWN"]'
  );
  await expect(gear.getByTestId('ai-flag-replaces')).toContainText('Pilot Salute');
  const pickle = page.locator('[data-testid="ai-suggestion"][data-action="Weapon Release Button"]');
  await expect(pickle.getByTestId('ai-flag-already')).toBeVisible();
  await expect(pickle.getByTestId('ai-suggestion-tick').locator('input')).not.toBeChecked();
  await expect(page.getByTestId('ai-usage').first()).toContainText('tokens in');
  await page.getByTestId('ai-dropped').locator('summary').click();
  await shot('suggestions');

  // Untick the cage suggestion; review the other two with the exact text.
  const cage = page.locator('[data-testid="ai-suggestion"][data-action="Cage/Uncage Button"]');
  await cage.getByTestId('ai-suggestion-tick').locator('input').uncheck();
  await expect(page.getByTestId('ai-review-suggestions')).toHaveText(/Review 2 changes/);
  await page.getByTestId('ai-review-suggestions').click();
  await expect(page.getByTestId('ai-review-dialog')).toBeVisible();
  await expect(page.getByTestId('ai-review-file')).toHaveCount(2);
  await expect(page.getByTestId('ai-review-dialog')).toContainText(
    'Pilot Salute: remove Button 21'
  );
  await page.getByTestId('ai-review-toggle-diff').first().click();
  await shot('review');
  await page.getByTestId('ai-review-apply').click();
  await expect(page.getByTestId('ai-saved')).toContainText('Bind 2 actions suggested by AI');
  const file = await fs.readFile(await stickFile(run), 'utf8');
  expect(file).toContain('ATC Engage/Disengage Switch');
  expect(file).not.toContain('Cage/Uncage Button');
  await shot('written');

  // Questions and explanations come back as plain text.
  await page
    .getByTestId('ai-question')
    .locator('input')
    .fill('What am I missing for carrier landings?');
  await page.getByTestId('ai-ask').click();
  await expect(page.getByTestId('ai-payload-dialog')).toBeVisible();
  await page.getByTestId('ai-payload-send').click();
  await expect(page.getByTestId('ai-answer')).toContainText('For carrier landings');
  await page.getByTestId('ai-answer').scrollIntoViewIfNeeded();
  await shot('answer');

  await page.getByTestId('ai-tab-walkthrough').click();
  await page.getByTestId('ai-item-trigger').click();
  await page.getByTestId('ai-explain').first().click();
  await page.getByTestId('ai-payload-send').click();
  await expect(page.getByTestId('ai-explanation')).toContainText(
    "The trigger's second detent fires the gun"
  );
  await shot('explained');
  expect(await allText(run.dataRoot)).not.toContain(KEY);
});

test('ai-assist: for an aircraft without a guide, AI drafts one in the guide format, marked as drafted', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-hornet', 'ai-assist-draft');
  const { page, shot } = run;
  await storeKey(page);
  await openGuide(page);
  await page.getByTestId('ai-aircraft').click();
  await page.getByRole('option', { name: /UH-1H Gunner w No Head Tracking/ }).click();
  await expect(page.getByTestId('ai-no-guide')).toContainText(
    'There is no guide for the UH-1H Gunner'
  );
  await shot('no-guide');
  await page.getByTestId('ai-open-draft').click();
  await page.getByTestId('ai-draft').click();
  await expect(page.getByTestId('ai-payload-dialog')).toBeVisible();
  await page.getByTestId('ai-payload-send').click();
  await expect(page.getByTestId('ai-drafted')).toContainText(
    'Drafted a guide with 2 items (1 more did not name real actions'
  );
  await page.getByTestId('ai-tab-walkthrough').click();
  await expect(page.getByTestId('ai-drafted-note')).toContainText('drafted by AI');
  await expect(page.getByTestId('ai-current-item')).toContainText('Aim the door gun');
  await expect(page.getByTestId('ai-action')).toHaveCount(2);
  await shot('drafted-guide');
  const saved = await fs.readFile(
    path.join(run.dataRoot, 'ai-assist', 'guides', 'UH-1H_Gunner.yaml'),
    'utf8'
  );
  expect(saved).toContain('drafted:');
});

/** Opens the AI tab with a key stored and sends "Suggest a setup". */
async function sendSuggest(page: Page): Promise<void> {
  await page.getByTestId('ai-suggest').click();
  await expect(page.getByTestId('ai-payload-dialog')).toBeVisible();
  await page.getByTestId('ai-payload-send').click();
}

test('ai-assist: a suggested setup streams in, the progress says what has arrived, and the answer is used only when complete', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-stream', 'ai-assist-stream');
  const { page, shot } = run;
  await storeKey(page);
  await openGuide(page);
  await page.getByTestId('ai-tab-ai').click();

  await page.getByTestId('ai-suggest').click();
  await expect(page.getByTestId('ai-payload-dialog')).toBeVisible();
  // The request that is shown says it will be streamed.
  await page.getByTestId('ai-payload-toggle').click();
  await expect(page.getByTestId('ai-payload-body')).toContainText('"stream": true');
  await page.getByTestId('ai-payload-send').click();

  // While it arrives: what was received so far, and a way to stop it. No suggestion is shown yet.
  const progress = page.getByTestId('ai-progress');
  await expect(progress).toBeVisible();
  await expect(page.getByTestId('ai-progress-text')).toContainText(
    /Receiving the answer: \d+ suggestions? so far \([\d,]+ characters\)/
  );
  await expect(progress).toHaveAttribute('data-phase', 'receiving');
  await expect(page.getByTestId('ai-progress-elapsed')).toContainText(/^\d+ s since it was sent/);
  await expect(page.getByTestId('ai-cancel-request')).toBeEnabled();
  await expect(page.getByTestId('ai-suggestion')).toHaveCount(0);

  // Complete: the dialog closes and the checked answer is listed, exactly as without streaming.
  await expect(page.getByTestId('ai-round')).toBeVisible();
  await expect(page.getByTestId('ai-payload-dialog')).toHaveCount(0);
  await expect(page.getByTestId('ai-suggestion')).toHaveCount(4);
  await expect(page.getByTestId('ai-dropped')).toContainText('2 lines of the answer were left out');
  await expect(page.getByTestId('ai-usage').first()).toContainText('tokens in');
  await shot('answered');
});

test('ai-assist: Cancel stops a streamed request, and a stream that stalls or fails part-way says so and changes nothing', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-stream-trouble', 'ai-assist-stream-trouble');
  const { page, shot } = run;
  await storeKey(page);
  await openGuide(page);
  await page.getByTestId('ai-tab-ai').click();
  const before = await fs.readFile(await stickFile(run), 'utf8');

  // Three suggestions arrive and then nothing more: the progress stands still.
  await sendSuggest(page);
  await expect(page.getByTestId('ai-progress-text')).toHaveText(
    /^Receiving the answer: 3 suggestions so far \([\d,]+ characters\)\.$/
  );
  await shot('three-so-far');
  await page.getByTestId('ai-cancel-request').click();
  await expect(page.getByTestId('ai-request-note')).toContainText(
    'Cancelled. Nothing from the answer was used.'
  );
  await expect(page.getByTestId('ai-payload-dialog')).toHaveCount(0);
  await expect(page.getByTestId('ai-round')).toHaveCount(0);
  await expect(page.getByTestId('ai-request-error')).toHaveCount(0);
  await shot('cancelled');

  // The next answer stalls: a plain message, and still no suggestions.
  await sendSuggest(page);
  await expect(page.getByTestId('ai-request-error')).toContainText(
    'The answer stopped arriving: nothing came for 90 seconds, so nothing from it was used. Try again.'
  );
  await expect(page.getByTestId('ai-request-note')).toHaveCount(0);
  await expect(page.getByTestId('ai-payload-dialog')).toHaveCount(0);
  await expect(page.getByTestId('ai-round')).toHaveCount(0);
  await shot('stalled');

  // The one after that fails in the middle of the answer.
  await sendSuggest(page);
  await expect(page.getByTestId('ai-request-error')).toContainText(
    'The Anthropic API is busy or down right now. Try again in a few minutes.'
  );
  await expect(page.getByTestId('ai-round')).toHaveCount(0);
  expect(await fs.readFile(await stickFile(run), 'utf8')).toBe(before);

  // And then one arrives whole.
  await sendSuggest(page);
  await expect(page.getByTestId('ai-round')).toBeVisible();
  await expect(page.getByTestId('ai-suggestion')).toHaveCount(4);
  await expect(page.getByTestId('ai-request-error')).toHaveCount(0);
  await shot('answered-after-retry');
});
