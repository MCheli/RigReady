import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * The built-in assistant, app-wide: off until a key is stored, then a button in the app bar.
 * With scripted Anthropic answers (tool use), it finds the helper programs of a DCS session,
 * proposes a setup that the user saves, and drafts a script that is shown in full, saved,
 * asked about before it runs, and held back once the file changes until it is approved again.
 * A request the provider refuses stays ready: the message is back in the box, one press sends
 * it again, and the refusal is in the log without the key or the message.
 */

const KEY = 'sk-ant-api03-e2e-NOT-A-REAL-KEY-0000-wxyz';

async function storeKey(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('ai-key-input').locator('input').fill(KEY);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-key-state')).toHaveText('An Anthropic API key is stored');
  // The panel is pictured over the Setups page: no picture shows the line about the key.
  await page.getByTestId('nav-profiles').click();
  await expect(page.getByTestId('ai-key-state')).toHaveCount(0);
}

const box = (page: Page) => page.getByTestId('assistant-input').locator('textarea').first();

/** Writes a message and presses the button under the box. */
async function write(page: Page, text: string): Promise<void> {
  await box(page).fill(text);
  await page.getByTestId('assistant-prepare').click();
}

/** Writes a message; the request for it is then shown, and nothing is sent yet. */
async function ask(page: Page, text: string): Promise<void> {
  await write(page, text);
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
  await expect(page.getByTestId('assistant-promise')).toContainText(
    'Every request is shown before it is sent.'
  );
  // The examples fit whatever the user plays: none of them takes them for a DCS pilot.
  await expect(page.getByTestId('assistant-examples')).toContainText(
    '"Make my setup start Stream Deck and TrackIR", "Why is my rig not ready?", "Write a check that SimHub answers on its port".'
  );
  await expect(page.getByTestId('assistant-examples')).not.toContainText('DCS');
  await shot('panel-open');

  // Every request is shown first; nothing goes until Send.
  await ask(page, 'Set up a DCS session with SimAppPro, TrackIR and SRS');
  await expect(page.getByTestId('assistant-preview-contents')).toContainText(
    'Your message: "Set up a DCS session with SimAppPro, TrackIR and SRS"'
  );
  // What reading it is estimated at and from which prices, said as the first request of
  // several, and where RigReady stops. No dollar figure stands without the word estimate.
  await expect(page.getByTestId('assistant-preview-size')).toContainText(
    'Request 1 of this question'
  );
  await expect(page.getByTestId('assistant-preview-size')).toHaveText(
    / · estimated \$\d+\.\d\d to read at built-in prices of November 2026, plus the answer$/
  );
  await expect(page.getByTestId('assistant-budget')).toHaveText(
    'RigReady asks before the estimate for a question passes $0.25.'
  );
  await expect(page.getByTestId('assistant-estimate-note')).toHaveText(
    "Estimates, not a bill: your provider's console shows what you are charged."
  );
  // The exact text is one click away.
  await expect(page.getByTestId('assistant-preview-body')).toHaveCount(0);
  await page.getByTestId('assistant-preview-toggle').click();
  await expect(page.getByTestId('assistant-preview-body')).toContainText('"programs_find"');
  await expect(page.getByTestId('assistant-preview-body')).not.toContainText(KEY);
  await shot('first-request');
  await page.getByTestId('assistant-send').click();

  // The tool answered: the next request carries what it found, and is shown again.
  const found = page.getByTestId('assistant-tool').first();
  await expect(found).toContainText('Find installed programs');
  // The row says what was really called: this tool only reads.
  await expect(found.getByTestId('assistant-tool-tier')).toHaveText('read');
  // Its raw answer is shown only when the row is opened.
  await expect(page.getByTestId('assistant-tool-answer')).toHaveCount(0);
  await found.getByRole('button').click();
  await expect(page.getByTestId('assistant-tool-answer')).toContainText('SimAppPro.exe');
  await found.getByRole('button').click();
  await expect(page.getByTestId('assistant-tool-answer')).toHaveCount(0);
  await expect(page.getByTestId('assistant-preview-contents')).toContainText(
    'What one tool answered: Find installed programs'
  );
  await expect(page.getByTestId('assistant-preview-size')).toContainText(
    'Request 2 of this question'
  );
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

  await expect(page.getByTestId('assistant-usage')).toContainText('This conversation: 3 requests');
  await expect(page.getByTestId('assistant-usage')).toHaveText(
    /, estimated \$\d+\.\d\d at built-in prices of November 2026$/
  );

  // A script: the whole text and the explanation, saved only on Save. The tick is set for
  // this conversation, so the message goes without the preview.
  await write(page, 'Write a script to start SRS minimized as the fix of the SRS radio check');
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

test('assistant: a request the provider refuses can be sent again with one press', async ({
  rig,
}) => {
  const run = await rig.launch('assistant-refused', 'assistant-refused');
  const { page, shot } = run;
  await storeKey(page);
  await page.getByTestId('assistant-open').click();
  const message = 'Is TrackIR a required step for launching the F/A-18C setup?';
  await ask(page, message);
  await page.getByTestId('assistant-send').click();

  // Refused: said in the panel, the message is back in the box, and the button sends it again.
  await expect(page.getByTestId('assistant-error')).toContainText(
    'Anthropic did not accept the API key'
  );
  await expect(box(page)).toHaveValue(message);
  await expect(page.getByTestId('assistant-preview')).toBeVisible();
  await expect(page.getByTestId('assistant-send')).toHaveText('Try again');
  await shot('refused');

  // Closing the panel and coming back changes nothing: the same request is still ready.
  await page.getByTestId('assistant-close').click();
  await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-send')).toHaveText('Try again');
  await page.getByTestId('assistant-send').click();

  // Answered: the reply is formatted, and markup in it is text, never elements.
  const reply = page.getByTestId('assistant-reply').last();
  await expect(reply).toContainText('TrackIR is a check of that setup, not a launch step');
  await expect(reply.locator('strong')).toHaveText('TrackIR');
  await expect(reply.locator('li')).toHaveCount(2);
  await expect(reply.locator('code').first()).toHaveText('process.running');
  await expect(reply).toContainText('<b onclick="x()">This is shown as text.</b>');
  await expect(reply.locator('b')).toHaveCount(0);
  await expect(reply.getByRole('link', { name: 'how the assistant works' })).toHaveAttribute(
    'href',
    'https://rigready.io/docs/ai/built-in-assistant/'
  );
  await expect(page.getByTestId('assistant-error')).toHaveCount(0);
  await expect(page.getByTestId('assistant-user')).toHaveText(message);
  await expect(box(page)).toHaveValue('');
  await expect(page.getByTestId('assistant-usage')).toContainText('This conversation: 1 request,');
  await shot('answered-after-retry');

  // A new conversation starts with the preview on: the tick belongs to a conversation.
  await page.getByTestId('assistant-new').click();
  await ask(page, 'And SRS?');
  await expect(page.getByTestId('assistant-skip-preview').locator('input')).not.toBeChecked();
  await page.getByTestId('assistant-discard').click();
  await expect(page.getByTestId('assistant-preview')).toHaveCount(0);
  await expect(box(page)).toHaveValue('And SRS?');

  // The refusal left one line in the log: who, which model, the status, what the provider
  // said and its request id. Not the key, and not what was asked.
  const logFile = path.join(run.dataRoot, 'logs', 'rigready.log');
  await expect
    .poll(() => fs.readFile(logFile, 'utf8'))
    .toContain('the assistant finished a question');
  const log = await fs.readFile(logFile, 'utf8');
  const line = log.split(/\r?\n/).find((l) => l.includes('a request to the AI provider failed'));
  expect(line).toBeDefined();
  expect(line).toContain('api.anthropic.com');
  expect(line).toContain('claude-opus-5-5');
  expect(line).toContain('401');
  expect(line).toContain('authentication_error');
  expect(line).toContain('req_e2e_refused_1');
  expect(log).not.toContain(KEY);
  expect(log).not.toContain('Is TrackIR a required step');
  expect(log).toContain('the assistant finished a question');
});
