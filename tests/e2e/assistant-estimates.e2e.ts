import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus, type AxeFinding, type Dom } from './a11y';
import { expect, test } from './harness';

/**
 * What RigReady says about money for AI requests, from Settings to the assistant panel. The
 * provider's token counts are exact; the dollars are worked out from prices kept in the app.
 * So: the prices are on show in Settings with where they come from (built-in, with the month
 * they were recorded, or the user's own) and can be typed; a model without prices shows no
 * dollar figure and takes no limit; a limit is turned on only after the user acknowledged
 * that it works on estimates; every figure in the panel is worded as an estimate that names
 * its prices; and the monthly budget warns, then holds a message back in words that say it
 * stopped on the estimate. The answers are scripted; nothing leaves the fake Http port.
 *
 * The panel lies over the right half of the page, so it is closed to look at Settings.
 */

const KEY = 'sk-ant-api03-e2e-NOT-A-REAL-KEY-0000-wxyz';
const NOT_A_BILL = "Estimates, not a bill: your provider's console shows what you are charged.";
const AI_SETTINGS = '[data-testid="ai-settings"]';

async function storeKey(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('ai-key-input').locator('input').fill(KEY);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-key-state')).toHaveText('An Anthropic API key is stored');
}

const field = (page: Page, id: string) => page.getByTestId(id).locator('input');
const box = (page: Page) => page.getByTestId('assistant-input').locator('textarea').first();

/** Settings scrolled so that the rows from the key down to the monthly budget are on screen. */
const showMoney = (page: Page): Promise<void> =>
  page.getByTestId('ai-key-state').evaluate((el) => el.scrollIntoView({ block: 'start' }));

/** Types an amount into a field of Settings and presses Enter. */
async function type(page: Page, id: string, value: string): Promise<void> {
  await field(page, id).fill(value);
  await field(page, id).press('Enter');
}

async function chooseModel(page: Page, model: string): Promise<void> {
  const combo = page.getByRole('combobox', { name: 'Model' });
  await combo.fill(model);
  await combo.press('Enter');
  await expect(page.getByTestId('ai-settings-saved')).toHaveText('Saved the model');
}

/** Writes a message; the request for it is then shown, and nothing is sent yet. */
async function ask(page: Page, text: string): Promise<void> {
  await box(page).fill(text);
  await page.getByTestId('assistant-prepare').click();
  await expect(page.getByTestId('assistant-preview')).toBeVisible();
}

/** The findings of the accessibility check that lie inside one part of the page. */
async function within(page: Page, part: string, findings: AxeFinding[]): Promise<AxeFinding[]> {
  const inside = await page.evaluate(
    ([targets, selector]) => {
      const { document } = globalThis as unknown as Dom;
      return targets.map((target) => !!document.querySelector(target)?.closest(selector));
    },
    [findings.map((finding) => finding.target), part] as const
  );
  return findings.filter((_, i) => inside[i]);
}

/**
 * Everything in one part of the page that has the role of a button and no name, whether or
 * not it is hidden from assistive technology (which is why the rules of axe pass it by).
 * Vuetify draws the arrow of a combobox as such an element; the model field draws a plain
 * icon in its place, and this is what holds it there.
 */
function namelessButtons(page: Page, part: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const { document } = globalThis as unknown as Dom;
    const found: string[] = [];
    const buttons = document.querySelector(selector)?.querySelectorAll('button, [role="button"]');
    for (const el of buttons ?? []) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const name =
        (el.textContent ?? '') +
        (el.getAttribute('aria-label') ?? '') +
        (el.getAttribute('title') ?? '');
      if (name.trim() === '') found.push(el.outerHTML.slice(0, 200));
    }
    return found;
  }, part);
}

test('assistant estimates: prices are named and can be typed, a limit needs an acknowledgement, and the monthly budget stops on the estimate', async ({
  rig,
}) => {
  const run = await rig.launch('assistant-estimates', 'assistant-estimates');
  const { page, shot } = run;
  await storeKey(page);

  // The built-in prices of the chosen model, with the month they were recorded.
  const hint = page.getByTestId('ai-prices-hint');
  await expect(hint).toContainText(
    "RigReady's built-in prices for this model, recorded in November 2026."
  );
  await expect(field(page, 'ai-price-input')).toHaveValue('4');
  await expect(field(page, 'ai-price-output')).toHaveValue('20');
  await expect(field(page, 'ai-price-cacheRead')).toHaveValue('0.2');
  await expect(field(page, 'ai-price-cacheWrite')).toHaveValue('5');
  await expect(page.getByTestId('ai-prices-save')).toBeDisabled();
  await expect(page.getByTestId('ai-prices-reset')).toHaveCount(0);
  await expect(page.getByTestId('ai-estimate-note')).toContainText(
    'Every dollar figure RigReady shows is an estimate'
  );
  await expect(page.getByTestId('ai-estimate-note')).toContainText(
    "It is not a bill. Your provider's console shows what you are charged, and a spending limit set there is the one that holds"
  );
  // The ceiling of one question is on as it ships; the monthly budget is off.
  await expect(field(page, 'ai-question-ceiling')).toHaveValue('0.25');
  await expect(field(page, 'ai-monthly-budget')).toHaveValue('0.00');
  await expect(page.getByTestId('ai-budget-hint')).toContainText('Off.');
  await expect(page.getByTestId('ai-budget-month')).toHaveText(
    'This month so far: nothing is estimated yet.'
  );
  await showMoney(page);
  // Every field and button of the section has a name, and the arrow of the model list is
  // an icon, not a button without one.
  expect(await within(page, AI_SETTINGS, await axeViolations(page))).toEqual([]);
  expect(await namelessButtons(page, AI_SETTINGS)).toEqual([]);
  await shot('built-in-prices');

  // A model RigReady has no prices for: no figure, and neither limit can be set.
  await chooseModel(page, 'claude-next-1');
  await expect(hint).toContainText(
    'RigReady has no prices for this model, so it shows no dollar figure for it and neither limit below applies.'
  );
  await expect(field(page, 'ai-price-input')).toHaveValue('');
  await expect(field(page, 'ai-question-ceiling')).toBeDisabled();
  await expect(field(page, 'ai-monthly-budget')).toBeDisabled();
  await expect(page.getByTestId('ai-budget-hint')).toContainText(
    'No prices are set for this model, so nothing is estimated and this amount is not used.'
  );
  await showMoney(page);
  await shot('no-prices');
  // Three prices are not prices: all four, or nothing.
  await field(page, 'ai-price-input').fill('3');
  await field(page, 'ai-price-output').fill('15');
  await field(page, 'ai-price-cacheRead').fill('0.3');
  await page.getByTestId('ai-prices-save').click();
  await expect(page.getByTestId('ai-settings-error')).toContainText(
    'Type all four prices in dollars per million tokens'
  );
  await expect(field(page, 'ai-monthly-budget')).toBeDisabled();
  await chooseModel(page, 'claude-opus-5-5');
  await expect(field(page, 'ai-price-input')).toHaveValue('4');

  // The user's own prices: saved, named as theirs, with the built-in ones still in sight.
  await field(page, 'ai-price-input').fill('8');
  await field(page, 'ai-price-output').fill('40');
  await field(page, 'ai-price-cacheRead').fill('0.4');
  await field(page, 'ai-price-cacheWrite').fill('10');
  await page.getByTestId('ai-prices-save').click();
  await expect(page.getByTestId('ai-settings-saved')).toContainText('Saved your prices');
  await expect(hint).toHaveText(
    "Your own prices. RigReady's built-in prices for this model, recorded in November 2026, are $4 in, $20 out, $0.2 cache read, $5 cache write."
  );
  await expect(page.getByTestId('ai-prices-reset')).toHaveText('Reset to built-in');
  await showMoney(page);
  await shot('own-prices');

  // An amount of the user's own for the ceiling asks first; Cancel changes nothing.
  await type(page, 'ai-question-ceiling', '0.5');
  const dialog = page.getByTestId('ai-acknowledge');
  await expect(page.getByTestId('ai-acknowledge-title')).toHaveText(
    'Ask before the estimate for one question passes $0.50'
  );
  await page.getByTestId('ai-acknowledge-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(field(page, 'ai-question-ceiling')).toHaveValue('0.25');
  await expect(page.getByTestId('ai-ceiling-acknowledged')).toHaveCount(0);

  // The monthly budget is turned on only with the tick: counted from estimates at these
  // prices, not the provider's bill, and the hard limit belongs at the provider.
  await type(page, 'ai-monthly-budget', '0.3');
  await expect(page.getByTestId('ai-acknowledge-title')).toHaveText(
    'Turn on a monthly budget of $0.30'
  );
  const lines = page.getByTestId('ai-acknowledge-lines');
  await expect(lines).toContainText(
    'RigReady counts this limit from its own estimates: the token counts your provider reports, at the prices shown in Settings. Right now those are your own prices.'
  );
  await expect(lines).toContainText("It is not your provider's bill.");
  await expect(lines).toContainText(
    "The limit that holds is the one at your provider. Set a spending limit in your provider's console as well."
  );
  await expect(page.getByTestId('ai-acknowledge-confirm')).toBeDisabled();
  await page.getByTestId('ai-acknowledge-check').locator('input').check();
  await expect(page.getByTestId('ai-acknowledge-confirm')).toBeEnabled();
  expect(await within(page, '[data-testid="ai-acknowledge"]', await axeViolations(page))).toEqual(
    []
  );
  await shot('acknowledge');
  await page.getByTestId('ai-acknowledge-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('ai-settings-saved')).toContainText('Saved the monthly budget');
  await expect(field(page, 'ai-monthly-budget')).toHaveValue('0.30');
  await expect(page.getByTestId('ai-budget-acknowledged')).toHaveText(
    /^You acknowledged on \d{1,2} \w+ \d{4} that this limit works on estimates\.$/
  );
  await expect(page.getByTestId('ai-budget-hint')).toContainText(
    "It works on RigReady's estimates, not on your provider's bill."
  );
  await showMoney(page);
  await shot('budget-on');

  // In the panel every figure is an estimate that names its prices.
  await page.getByTestId('assistant-open').click();
  await ask(page, 'Is TrackIR a required step for launching the F/A-18C setup?');
  await expect(page.getByTestId('assistant-preview-size')).toHaveText(
    /^Request 1 of this question · about [\d,]+ tokens · estimated \$0\.\d\d to read at your own prices, plus the answer$/
  );
  await expect(page.getByTestId('assistant-budget')).toHaveText(
    'RigReady asks before the estimate for a question passes $0.25.'
  );
  await expect(page.getByTestId('assistant-month')).toHaveCount(0);
  await expect(page.getByTestId('assistant-estimate-note')).toHaveText(NOT_A_BILL);
  await shot('request-estimate');
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-reply').last()).toContainText('TrackIR is a check');
  await expect(page.getByTestId('assistant-usage')).toHaveText(
    'This conversation: 1 request, 23,000 tokens, estimated $0.25 at your own prices'
  );
  await expect(page.getByTestId('assistant-estimate-note')).toHaveText(NOT_A_BILL);
  // Settings, open behind the panel all along, has heard of it: the month is close to its budget.
  await page.getByTestId('assistant-close').click();
  const month = page.getByTestId('ai-budget-month');
  await expect(month).toHaveText(
    'This month so far: estimated $0.25 over 1 request, at the prices in force when each was sent. That is 80 percent or more of your monthly budget of $0.30.'
  );
  await showMoney(page);
  expect(await colourOnlyStatus(page)).toEqual([]);
  await shot('month-close-to-budget');

  // The next request says so before it is sent.
  await page.getByTestId('assistant-open').click();
  await ask(page, 'And SRS?');
  await expect(page.getByTestId('assistant-month')).toHaveText(
    'Close to your monthly budget: this month is estimated at $0.25 of $0.30 so far, at the prices in force when each request was sent, and this request comes on top. RigReady sends nothing more once the estimate reaches the budget.'
  );
  expect(await colourOnlyStatus(page)).toEqual([]);
  await shot('request-close-to-budget');
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-reply').last()).toContainText('SRS is not part');
  await expect(page.getByTestId('assistant-usage')).toHaveText(
    'This conversation: 2 requests, 46,000 tokens, estimated $0.50 at your own prices'
  );

  // At the budget nothing is made ready or sent, and the reason says it stopped on the estimate.
  const held = 'Add a check for SRS to that setup';
  await box(page).fill(held);
  await page.getByTestId('assistant-prepare').click();
  await expect(page.getByTestId('assistant-error')).toHaveText(
    "Stopped on RigReady's estimate, not on a bill: this month's requests are estimated at $0.50, which reaches your monthly budget of $0.30. Nothing was sent. You can raise the budget or turn it off in Settings under AI. What you are charged is in your provider's console."
  );
  await expect(page.getByTestId('assistant-preview')).toHaveCount(0);
  await expect(box(page)).toHaveValue(held);
  expect(await colourOnlyStatus(page)).toEqual([]);
  await shot('stopped-on-the-estimate');
  await page.getByTestId('assistant-close').click();
  await expect(month).toHaveText(
    'This month so far: estimated $0.50 over 2 requests, at the prices in force when each was sent. That reaches your monthly budget of $0.30: RigReady sends nothing more this month. It stopped on its estimate, not on a bill.'
  );
  await showMoney(page);
  expect(await colourOnlyStatus(page)).toEqual([]);
  await shot('month-stopped');

  // Turned off again in Settings, the reason goes and the message can be made ready.
  await type(page, 'ai-monthly-budget', '0');
  await expect(page.getByTestId('ai-settings-saved')).toContainText('Saved: no monthly budget');
  await expect(month).toHaveText(
    'This month so far: estimated $0.50 over 2 requests, at the prices in force when each was sent.'
  );
  await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-error')).toHaveCount(0);
  await expect(box(page)).toHaveValue(held);
  await page.getByTestId('assistant-prepare').click();
  await expect(page.getByTestId('assistant-preview')).toBeVisible();
  await expect(page.getByTestId('assistant-month')).toHaveCount(0);
  await page.getByTestId('assistant-close').click();

  // Back to the built-in prices with one press.
  await page.getByTestId('ai-prices-reset').click();
  await expect(page.getByTestId('ai-settings-saved')).toContainText(
    'Back to the built-in prices for this model'
  );
  await expect(field(page, 'ai-price-input')).toHaveValue('4');
  await expect(hint).toContainText(
    "RigReady's built-in prices for this model, recorded in November 2026."
  );
  await expect(page.getByTestId('ai-prices-reset')).toHaveCount(0);
});
