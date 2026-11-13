import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
  // The page is for DCS aircraft only, and says so at the top: its menu entry does not.
  await expect(page.getByTestId('ai-guide-page').locator('.rr-page-sub')).toContainText(
    'For DCS World: what matters in each aircraft'
  );

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
  // What AI is for, said for every game first, and the DCS-only part named as such.
  await expect(page.getByTestId('ai-who-answers')).toContainText(
    'With it, the assistant answers questions about your rig, proposes setups and drafts scripts, whatever you play. For DCS aircraft, the Binding guide page can also suggest bindings on your devices and explain actions.'
  );
  await page.getByTestId('ai-settings').scrollIntoViewIfNeeded();
  expect(await page.content()).not.toContain(KEY);
  await shot('settings');
  expect(await allText(run.dataRoot)).not.toContain(KEY);

  await page.getByTestId('ai-key-remove').click();
  await expect(page.getByTestId('ai-settings-key')).toContainText('No key yet');
  await shot('removed');

  // "Exactly what is sent", use by use, readable for someone who only plays iRacing: the
  // assistant first, which is for any game, then AI help in the binding guide, which is for
  // DCS aircraft only. No key is stored at this point, so the picture holds no key hint.
  const sent = page.getByTestId('ai-what-is-sent');
  const parts = sent.getByTestId('ai-what-is-sent-part');
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(0)).toContainText('The assistant (any game)');
  await expect(parts.nth(0)).toContainText(
    'It works the same whatever you play: a racing sim such as iRacing, a flight sim such as DCS, or anything else.'
  );
  await expect(parts.nth(1)).toContainText('AI help in the binding guide (DCS aircraft only)');
  await expect(parts.nth(1)).toContainText(
    'If you do not fly DCS, nothing in this list is ever sent.'
  );
  await expect(parts.nth(2)).toContainText('Where it goes');
  // The whole list in one picture: its last line at the foot of the window, its heading above.
  await sent.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await expect(page.getByText('Exactly what is sent', { exact: true })).toBeInViewport();
  await expect(page.getByTestId('ai-settings-key')).not.toBeInViewport();
  await shot('what-is-sent');
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
  // The dollar figure is an estimate that names its prices, and is not a bill.
  await expect(page.getByTestId('ai-payload-lead')).toContainText(
    /estimated \$\d+\.\d\d to read at built-in prices of November 2026, before any answer\./
  );
  await expect(page.getByTestId('ai-payload-estimate')).toHaveText(
    "Estimates, not a bill: your provider's console shows what you are charged."
  );
  await page.getByTestId('ai-payload-toggle').click();
  await expect(page.getByTestId('ai-payload-body')).toContainText('"cache_control"');
  await expect(page.getByTestId('ai-payload-body')).not.toContainText(KEY);
  await expect(page.getByTestId('ai-payload-body')).not.toContainText('480FAD44');
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
  await expect(page.getByTestId('ai-usage').first()).toContainText(
    /· estimated \$\d+\.\d\d at built-in prices of November 2026/
  );
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

test('ai-assist: an aircraft beyond the Hornet and the Huey has its own shipped guide, walkthrough and plain names', async ({
  rig,
}) => {
  const run = await rig.launch('ai-assist-viper', 'ai-assist-viper');
  const { page, shot } = run;
  await openGuide(page);
  await page.getByTestId('ai-aircraft').click();
  await page.getByRole('option', { name: /^F-16C/ }).click();
  await expect(page.getByTestId('ai-aircraft')).toContainText('F-16C');

  await expect(page.getByTestId('ai-current-item')).toHaveAttribute('data-item', 'pitch-roll');
  await page.getByTestId('ai-item-tms').click();
  const tmsUp = page.locator(
    '[data-testid="ai-action"][data-action="Target Management Switch - Up"]'
  );
  await expect(tmsUp).toContainText('TMS up: lock / designate');
  await shot('walkthrough');

  await page.getByTestId('ai-tab-priorities').click();
  await expect(page.getByTestId('ai-tier-must')).toContainText('Target management switch (TMS)');
  // Nothing is bound for the F-16C on this rig yet, and every item is in this DCS version.
  await expect(page.locator('[data-testid="ai-priority-item"][data-item="tms"]')).toHaveAttribute(
    'data-status',
    'unbound'
  );
  await expect(page.locator('[data-testid="ai-priority-item"][data-status="missing"]')).toHaveCount(
    0
  );
  await expect(page.getByTestId('ai-sources')).toContainText('Not affiliated with or reviewed');
  await shot('priorities');
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

// ---------------------------------------------------------------------------
// Other providers: a fake OpenAI-compatible server that the test starts on this PC
// ---------------------------------------------------------------------------

const LOCAL_KEY = 'local-e2e-NOT-A-REAL-KEY-0000-lmno';
const LOCAL_MODEL = 'fake-local-model';

/** A suggestion plan for the Hornet: four that check out, one action that does not exist. */
const LOCAL_PLAN = JSON.stringify({
  summary: 'Carrier switches on the HOTAS, from a model on this PC.',
  items: [
    {
      actionId: 'key:d3037pnilu3037cd13vd1vpnilvu0',
      device: 'dev9',
      input: 'JOY_BTN7',
      priority: 'should',
      reason: 'Auto-throttle under the thumb.',
    },
    {
      actionId: 'key:d68pnilunilcdnilvdnilvpnilvunil',
      device: 'dev10',
      input: 'JOY_BTN21',
      priority: 'must',
      reason: 'Gear on the throttle.',
    },
    {
      actionId: 'key:d3031pnilu3031cd13vd1vpnilvu0',
      device: 'dev9',
      input: 'JOY_BTN21',
      priority: 'should',
      reason: 'Cage next to the trigger.',
    },
    {
      actionId: 'key:d3003pnilu3003cd13vd1vpnilvu0',
      device: 'dev9',
      input: 'JOY_BTN20',
      priority: 'must',
      reason: 'The pickle is already right.',
    },
    {
      actionId: 'key:not-a-real-action',
      device: 'dev9',
      input: 'JOY_BTN1',
      priority: 'must',
      reason: 'Made up.',
    },
  ],
  notes: ['Views can stay on the keyboard.'],
});

interface FakeServer {
  url: string;
  host: string;
  requests: { path: string; authorization: string | undefined; body: string }[];
  close(): Promise<void>;
}

/**
 * An OpenAI-compatible server on 127.0.0.1, as Ollama or LM Studio would be: it wants
 * `Bearer LOCAL_KEY`, answers the smallest request whole, and streams a suggestion plan
 * as Chat Completions chunks ending in a usage chunk and [DONE].
 */
async function fakeServer(): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      requests.push({ path: req.url ?? '', authorization: req.headers.authorization, body });
      if (req.headers.authorization !== `Bearer ${LOCAL_KEY}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
      const parsed = JSON.parse(body || '{}') as { stream?: boolean; model?: string };
      if (!parsed.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            model: parsed.model,
            choices: [
              { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 1 },
          })
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: object, finish: string | null = null): string =>
        `data: ${JSON.stringify({ model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '' }));
      for (let at = 0; at < LOCAL_PLAN.length; at += 60) {
        res.write(chunk({ content: LOCAL_PLAN.slice(at, at + 60) }));
      }
      res.write(chunk({}, 'stop'));
      res.write(
        `data: ${JSON.stringify({ model: parsed.model, choices: [], usage: { prompt_tokens: 31000, completion_tokens: 640 } })}\n\n`
      );
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    host: `127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Settings > AI assistance: OpenAI-compatible, "Other", the fake server's address and model, the key. */
async function useLocalServer(page: Page, server: FakeServer): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('ai-provider').click();
  await page.getByRole('option', { name: /OpenAI-compatible/ }).click();
  const address = page.getByTestId('ai-base-url').locator('input');
  await address.fill(server.url);
  await address.press('Enter');
  await expect(page.getByTestId('ai-settings-saved')).toHaveText('Saved the address');
  const model = page.getByRole('combobox', { name: 'Model' });
  await model.fill(LOCAL_MODEL);
  await model.press('Enter');
  await expect(page.getByTestId('ai-settings-saved')).toHaveText('Saved the model');
  await page.getByTestId('ai-key-input').locator('input').fill(LOCAL_KEY);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-key-state')).toHaveText(`A key for ${server.host} is stored`);
  await expect(page.getByTestId('ai-settings-key')).toHaveText('Key ending in …lmno');
}

test('ai-assist: another provider is chosen in Settings, its key stored and tested against the server on this PC, and only that host is named', async ({
  rig,
}) => {
  const server = await fakeServer();
  try {
    const run = await rig.launch('ai-assist-hornet', 'ai-assist-providers', {
      env: { RIGREADY_SCENARIO_LOOPBACK: '1' },
    });
    const { page, shot } = run;
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-settings').click();
    // Anthropic is the default and first.
    await expect(page.getByTestId('ai-provider')).toContainText('Anthropic (Claude)');
    await page.getByTestId('ai-provider').click();
    await expect(page.getByRole('option').first()).toHaveText('Anthropic (Claude)');
    await page.keyboard.press('Escape');

    // A preset fills the address and suggests a model; plain http is refused unless it is this PC.
    await page.getByTestId('ai-provider').click();
    await page.getByRole('option', { name: /OpenAI-compatible/ }).click();
    await page.getByTestId('ai-preset').click();
    await page.getByRole('option', { name: 'Google Gemini' }).click();
    await expect(page.getByTestId('ai-base-url').locator('input')).toHaveValue(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    );
    await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('gemini-3.6-flash');
    await expect(page.getByTestId('ai-what-is-sent')).toContainText(
      'Requests go only to generativelanguage.googleapis.com'
    );
    await shot('gemini-preset');
    const address = page.getByTestId('ai-base-url').locator('input');
    await address.fill('http://ai.example.com/v1');
    await address.press('Enter');
    await expect(page.getByTestId('ai-settings-error')).toContainText('Only https addresses');

    await useLocalServer(page, server);
    await expect(page.getByTestId('ai-key-input').locator('input')).toHaveValue('');
    await page.getByTestId('ai-key-test').click();
    await expect(page.getByTestId('ai-key-test-result')).toHaveText(
      `Works. ${server.host} answered, using ${LOCAL_MODEL}.`
    );
    await expect(page.getByTestId('ai-what-is-sent')).toContainText(
      `Requests go only to ${server.host}, a server on this PC.`
    );
    await page.getByTestId('ai-settings').scrollIntoViewIfNeeded();
    expect(await page.content()).not.toContain(LOCAL_KEY);
    await shot('local-server');
    expect(server.requests.map((r) => r.path)).toEqual(['/v1/chat/completions']);
    expect(server.requests[0]!.authorization).toBe(`Bearer ${LOCAL_KEY}`);
    expect(await allText(run.dataRoot)).not.toContain(LOCAL_KEY);

    // A wrong key is reported plainly.
    await page.getByTestId('ai-key-input').locator('input').fill('wrong-key-0000000000');
    await page.getByTestId('ai-key-save').click();
    await page.getByTestId('ai-key-test').click();
    await expect(page.getByTestId('ai-key-test-result')).toContainText('did not accept this key');
    await shot('wrong-key');
  } finally {
    await server.close();
  }
});

test('ai-assist: a suggestion round trip through an OpenAI-compatible server on this PC streams, is checked, and applies after review', async ({
  rig,
}) => {
  const server = await fakeServer();
  try {
    const run = await rig.launch('ai-assist-hornet', 'ai-assist-compatible-suggest', {
      env: { RIGREADY_SCENARIO_LOOPBACK: '1' },
    });
    const { page, shot } = run;
    await useLocalServer(page, server);
    await openGuide(page);
    await page.getByTestId('ai-tab-ai').click();
    await page.getByTestId('ai-suggest').click();
    await expect(page.getByTestId('ai-payload-dialog')).toBeVisible();
    await expect(page.getByTestId('ai-payload-lead')).toContainText(
      `To ${server.host} (a server on this PC), using ${LOCAL_MODEL}`
    );
    await page.getByTestId('ai-payload-toggle').click();
    await expect(page.getByTestId('ai-payload-body')).toContainText('"response_format"');
    await expect(page.getByTestId('ai-payload-body')).not.toContainText(LOCAL_KEY);
    await shot('payload');
    await page.getByTestId('ai-payload-send').click();

    await expect(page.getByTestId('ai-round')).toBeVisible();
    await expect(page.getByTestId('ai-suggestion')).toHaveCount(4);
    await expect(page.getByTestId('ai-dropped')).toContainText('1 line of the answer was left out');
    await expect(page.getByTestId('ai-usage').first()).toContainText(
      `${LOCAL_MODEL} · 31,000 tokens in · 640 out`
    );
    await expect(page.getByTestId('ai-usage').first()).not.toContainText('$');
    await shot('suggestions');
    const sent = server.requests.find((r) => r.body.includes('"stream":true'))!;
    expect(sent.body).toContain('"json_schema"');
    expect(sent.body).not.toContain('480FAD44');

    const cage = page.locator('[data-testid="ai-suggestion"][data-action="Cage/Uncage Button"]');
    await cage.getByTestId('ai-suggestion-tick').locator('input').uncheck();
    await page.getByTestId('ai-review-suggestions').click();
    await expect(page.getByTestId('ai-review-dialog')).toBeVisible();
    await page.getByTestId('ai-review-apply').click();
    await expect(page.getByTestId('ai-saved')).toContainText('Bind 2 actions suggested by AI');
    const file = await fs.readFile(await stickFile(run), 'utf8');
    expect(file).toContain('ATC Engage/Disengage Switch');
    await shot('written');
  } finally {
    await server.close();
  }
});

/** A guide somebody shared for the Huey's door gunner seat, on that seat's own action names. */
const SHARED_GUIDE = `# A guide a friend shared.
format: 1
aircraft:
  id: UH-1H_Gunner
  name: UH-1H door gunner
summary: "The door gun first: aim it from the stick and fire with the trigger."
sources:
  - A friend who flies the Huey.
roles:
  stick:
    summary: Aim and fire from the stick.
    items: [aim, fire]
items:
  - id: aim
    title: Aim the door gun
    tier: must
    place: hotas
    role: stick
    what: Swings the machine gun left and right and up and down.
    when: Whenever you are shooting.
    actions:
      - { name: Gun Left/Right, label: Aim left and right }
      - { name: Gun Up/Down, label: Aim up and down }
  - id: fire
    title: Fire the door gun
    tier: must
    place: hotas
    role: stick
    what: Fires the machine gun.
    when: On target.
    actions:
      - { name: Machinegun fire, label: Fire }
`;

test('ai-assist: with no AI key, a binding guide is imported from a file or written by hand, opened, read again and deleted', async ({
  rig,
}) => {
  const picked = 'Documents/Guides from friends/huey-gunner.yaml';
  const run = await rig.launch('ai-assist-hornet', 'ai-assist-own-guide', {
    dialogs: { open: [[picked]] },
  });
  const { page, shot } = run;
  const shared = path.join(run.home, ...picked.split('/'));
  await fs.mkdir(path.dirname(shared), { recursive: true });
  await fs.writeFile(shared, SHARED_GUIDE, 'utf8');
  const kept = path.join(run.dataRoot, 'ai-assist', 'guides', 'UH-1H_Gunner.yaml');
  const gunner = /UH-1H Gunner w No Head Tracking/;

  await openGuide(page);
  await page.getByTestId('ai-aircraft').click();
  await page.getByRole('option', { name: gunner }).click();
  // No key is stored: both ways in are offered, and a draft by AI is not.
  await expect(page.getByTestId('ai-no-guide')).toContainText('Neither needs an AI key.');
  await expect(page.getByTestId('ai-guide-import')).toBeVisible();
  await expect(page.getByTestId('ai-guide-start')).toBeVisible();
  await expect(page.getByTestId('ai-open-draft')).toHaveCount(0);
  await shot('two-ways-in');

  // Import: the file picked in the Windows dialog is checked and copied into the data folder.
  await page.getByTestId('ai-guide-import').click();
  await expect(page.getByTestId('ai-guide-note')).toContainText('Imported a guide with 2 items.');
  await expect(page.getByTestId('ai-guide-own')).toContainText('This is a guide of your own');
  await expect(page.getByTestId('ai-current-item')).toContainText('Aim the door gun');
  await expect(page.getByTestId('ai-action')).toHaveCount(2);
  expect(await fs.readFile(kept, 'utf8')).toBe(SHARED_GUIDE);
  expect(await fs.readFile(shared, 'utf8')).toBe(SHARED_GUIDE);
  await shot('imported');
  await page.getByTestId('ai-aircraft').click();
  await expect(page.getByRole('option', { name: gunner })).toContainText('Your own guide');
  await page.keyboard.press('Escape');

  // Open the file: Notepad is started with the kept file. (A scenario starts no real program.)
  await page.getByTestId('ai-guide-open').click();
  await expect(page.getByTestId('ai-guide-note')).toContainText('The file is open in Notepad.');

  // Deleting asks first. "Keep it" keeps it.
  await page.getByTestId('ai-guide-delete').click();
  await expect(page.getByTestId('ai-guide-delete-dialog')).toContainText('This cannot be undone.');
  await shot('delete-asks-first');
  await page.getByTestId('ai-guide-delete-no').click();
  await expect(page.getByTestId('ai-guide-delete-dialog')).toHaveCount(0);
  expect(await fs.readFile(kept, 'utf8')).toBe(SHARED_GUIDE);
  await page.getByTestId('ai-guide-delete').click();
  await page.getByTestId('ai-guide-delete-yes').click();
  await expect(page.getByTestId('ai-no-guide')).toContainText(
    'There is no guide for the UH-1H Gunner'
  );
  await expect(fs.stat(kept)).rejects.toThrow();
  // The file it was imported from is where it was.
  expect(await fs.readFile(shared, 'utf8')).toBe(SHARED_GUIDE);

  // Write your own: a short starter on real actions of the aircraft, usable as it stands.
  await page.getByTestId('ai-guide-start').click();
  await expect(page.getByTestId('ai-guide-note')).toContainText(
    'A short starter guide was written'
  );
  await expect(page.getByTestId('ai-current-item')).toBeVisible();
  const starter = await fs.readFile(kept, 'utf8');
  expect(starter).toContain('# Your own binding guide for the');
  await shot('started');

  // An edit that does not fit the format: the page says what is wrong, and the file can
  // still be opened, read again or deleted.
  await fs.writeFile(kept, starter.replace('format: 1', 'format: 7'), 'utf8');
  await page.getByTestId('ai-guide-reload').click();
  await expect(page.getByTestId('ai-guide-problem')).toContainText('cannot be used as it is');
  await expect(page.getByTestId('ai-no-guide')).toContainText('needs a fix');
  await expect(page.getByTestId('ai-guide-open')).toBeVisible();
  await expect(page.getByTestId('ai-guide-import')).toHaveCount(0);
  await shot('needs-a-fix');

  // Put right and read again: the guide is back.
  await fs.writeFile(kept, starter, 'utf8');
  await page.getByTestId('ai-guide-reload').click();
  await expect(page.getByTestId('ai-guide-own')).toBeVisible();
  await expect(page.getByTestId('ai-current-item')).toBeVisible();
});
