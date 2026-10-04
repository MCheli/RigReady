import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus, type Dom } from './a11y';
import { expect, test } from './harness';

/**
 * First impressions (WOW-UI-008 to 010): the welcome a new user sees before any setup
 * exists, the About panel, and the quiet accent that follows the kind of game the setup in
 * use is for.
 */

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

const hash = (page: Page): Promise<string> =>
  page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash);

/** The colour an element is drawn in. */
const colourOf = (page: Page, selector: string, pseudo?: string): Promise<string> =>
  page.evaluate(
    ([sel, ps]) => {
      const { document, getComputedStyle } = globalThis as unknown as Dom;
      const el = document.querySelector(sel as string);
      if (!el) return `no element matches ${sel}`;
      const computed = getComputedStyle(el, (ps as string | null) ?? undefined);
      return ps ? computed.backgroundColor : computed.color;
    },
    [selector, pseudo ?? null] as const
  );

/** What the shell says the setup in use is for: "flight", "racing", or nothing. */
const kindOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as Dom;
    return document.documentElement.getAttribute('data-rig-kind');
  });

const BLUE = 'rgb(90, 169, 230)';
const VIOLET = 'rgb(177, 151, 252)';

test('welcome: a first run says what RigReady does, what it found on this PC, and leads to the first setup', async ({
  rig,
}) => {
  const run = await rig.launch('flying-fresh', 'welcome');
  const { page, shot } = run;
  const welcome = page.getByTestId('fly-empty');
  await expect(welcome).toBeVisible();

  // What it is for, in three lines, each with its icon.
  await expect(welcome.locator('h1')).toHaveText('Welcome to RigReady');
  await expect(welcome).toContainText('No setups yet. The first one takes a minute.');
  const what = page.getByTestId('welcome-what').locator('li');
  await expect(what).toHaveText([
    /^Checks the rig before you fly or race: devices plugged in/,
    /^Fixes what is off and launches the game: Make ready starts the apps/,
    /^Protects your bindings and settings: backups you can restore/,
  ]);

  // What it found: three readings, each a number with its unit and what is behind it.
  await expect(page.getByTestId('welcome-games').locator('.welcome-count')).toHaveText('8');
  await expect(page.getByTestId('welcome-games')).toContainText('8 games');
  await expect(page.getByTestId('welcome-games')).toContainText('DCS World');
  await expect(page.getByTestId('welcome-controllers')).toContainText('12 game controllers');
  await expect(page.getByTestId('welcome-monitors')).toContainText('5 monitors');
  await expect(page.getByTestId('welcome-monitors')).toContainText('4 on, 1 off right now');
  expect(
    await page
      .getByTestId('welcome-games')
      .locator('.welcome-count')
      .evaluate((el) => {
        const { getComputedStyle } = globalThis as unknown as Dom;
        return getComputedStyle(el as never).getPropertyValue('font-variant-numeric');
      })
  ).toBe('tabular-nums');

  // The instrument detail: a horizon and the mark, drawn and not read out. A PC with a
  // flight sim gets the flight path marker.
  const hud = welcome.locator('.welcome-hud');
  await expect(hud).toHaveAttribute('aria-hidden', 'true');
  await expect(hud.locator('svg.rr-mark')).toHaveClass(/rr-mark-flight/);

  // One clear first step, two other ways in, and where the keyboard leads.
  await expect(page.getByTestId('fly-create')).toHaveText('Create a setup from this rig');
  await expect(page.getByTestId('welcome-restore')).toHaveAttribute('href', '#/configure/backups');
  await expect(page.getByTestId('welcome-import')).toHaveAttribute('href', '#/configure/share');
  await expect(page.getByTestId('welcome-keys').locator('kbd')).toHaveText(['Ctrl', 'K', '?']);
  // No setup, so no kind of game to follow: the plain accent.
  expect(await kindOf(page)).toBeNull();
  const problems = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  expect(problems).toEqual([]);
  await shot('welcome');

  // While the PC is still being looked at, the readings show their outline, not nothing.
  await run.mutate([{ op: 'hangProvider', port: 'devices' }]);
  await go(page, '/configure/settings');
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await go(page, '/fly');
  await expect(page.getByTestId('fly-empty')).toBeVisible();
  const outline = page.getByTestId('welcome-found').getByTestId('page-skeleton');
  await expect(outline).toBeVisible();
  await expect(outline.locator('.rr-sr-only')).toHaveText('Looking at this PC…');
  await expect(page.getByTestId('fly-create')).toBeVisible();
  await expect
    .poll(() =>
      outline.evaluate((el) => {
        const { getComputedStyle } = globalThis as unknown as Dom;
        return getComputedStyle(el as never).opacity;
      })
    )
    .toBe('1');
  await shot('looking');
  await run.mutate([{ op: 'hangProvider', port: 'devices', hang: false }]);
  await go(page, '/configure/settings');
  await go(page, '/fly');
  await expect(page.getByTestId('welcome-controllers')).toContainText('12 game controllers');
  await expect(outline).toHaveCount(0);

  // The first step leads into capture.
  await page.getByTestId('fly-create').click();
  await expect.poll(() => hash(page)).toBe('#/configure/profiles/capture');
});

test('welcome: a PC whose only game is a racing one is greeted with the wheel, and one without a sim says so', async ({
  rig,
}) => {
  const racing = await rig.launch('shell-racing-pc', 'welcome-racing');
  const welcome = racing.page.getByTestId('fly-empty');
  await expect(racing.page.getByTestId('welcome-games')).toContainText('1 game');
  await expect(racing.page.getByTestId('welcome-games')).toContainText('iRacing');
  await expect(welcome.locator('.welcome-hud svg.rr-mark')).toHaveClass(/rr-mark-racing/);
  await expect(racing.page.getByTestId('welcome-controllers')).toContainText('1 game controller');
  await expect(racing.page.getByTestId('welcome-monitors')).toContainText('All on right now');
  await racing.shot('welcome');
  await racing.app.close();

  const none = await rig.launch('generic-fresh', 'welcome-generic');
  await expect(none.page.getByTestId('welcome-games')).toContainText('0 games');
  await expect(none.page.getByTestId('welcome-games')).toContainText(
    'Any other game still works: you say what to launch.'
  );
  await expect(none.page.getByTestId('fly-empty').locator('.welcome-hud svg.rr-mark')).toHaveClass(
    /rr-mark-flight/
  );
  const problems = [...(await axeViolations(none.page)), ...(await colourOnlyStatus(none.page))];
  expect(problems).toEqual([]);
  await none.shot('welcome');
});

test('about: the version, what RigReady does, the licence and where to find it', async ({
  rig,
}) => {
  const { page, shot, dataRoot } = await rig.launch('flying-all-good', 'about');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  const info = (await page.evaluate(() =>
    (
      globalThis as unknown as { rigready: { invoke(c: string, i: unknown): Promise<unknown> } }
    ).rigready.invoke('app:info', undefined)
  )) as { ok: true; value: { version: string } };

  // The version in the header is the door.
  const door = page.getByTestId('about-open');
  await expect(door).toHaveText(info.value.version);
  await expect(door).toHaveAttribute('aria-label', `About RigReady, version ${info.value.version}`);
  await door.click();
  const about = page.getByTestId('about');
  await expect(about).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'About RigReady' })).toBeVisible();

  await expect(page.getByTestId('about-dialog-version')).toHaveText(info.value.version);
  await expect(page.getByTestId('about-lead')).toHaveText(
    'Checks that a flight or racing sim rig is ready, fixes what is not, and launches the game.'
  );
  await expect(page.getByTestId('about-jobs').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('about-jobs')).toContainText('Ready, then launch');
  await expect(page.getByTestId('about-jobs')).toContainText('Set up and protect');
  await expect(page.getByTestId('about-jobs')).toContainText('Troubleshoot hardware');

  // The licence and the addresses are the package's own.
  await expect(page.getByTestId('about-licence')).toContainText(
    'MIT: open source, free to use, change and share'
  );
  await expect(page.getByTestId('about-licence')).toContainText(/Copyright \(c\) \d{4} /);
  for (const [id, shown] of [
    ['website', 'rigready.io'],
    ['source', /^github\.com\/.+\/rigready$/],
    ['issues', /^github\.com\/.+\/rigready\/issues$/],
  ] as const) {
    const link = page.getByTestId(`about-${id}`).locator('a');
    await expect(link).toHaveText(shown);
    // Opened by Windows' browser, never inside the app (the test does not follow them).
    await expect(link).toHaveAttribute('href', /^https:\/\//);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(page.getByTestId('about-data')).toContainText(dataRoot);
  const problems = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  expect(problems).toEqual([]);
  await shot('about');

  // Escape closes it and the focus is back on the version.
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  await expect(door).toBeFocused();

  // The palette opens it too; from it, the shortcut list and Diagnostics are one step away.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('about');
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText('About RigReady');
  await page.keyboard.press('Enter');
  await expect(about).toBeVisible();
  await page.getByTestId('about-shortcuts').click();
  await expect(about).toBeHidden();
  await expect(page.getByTestId('shortcuts')).toBeVisible();
  await page.getByTestId('shortcuts-close').click();
  await expect(page.getByTestId('shortcuts')).toBeHidden();
  await door.click();
  await expect(about).toBeVisible();
  await page.getByTestId('about-diagnostics').click();
  await expect.poll(() => hash(page)).toBe('#/configure/diagnostics');
  await expect(about).toBeHidden();
  await expect(page.getByTestId('diagnostics-page')).toBeVisible();
});

test('accent: the mark and the lines that say where you are follow the kind of game the setup in use is for', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('shell-flight-and-racing', 'kind-accent');
  await expect(page.getByTestId('fly-status-title')).not.toHaveText('Checking…');
  const switcher = page.getByTestId('profile-switcher');
  const pick = async (name: string): Promise<void> => {
    await switcher.click();
    await page.getByTestId('switcher-item').filter({ hasText: name }).click();
    await expect(switcher).toContainText(name);
  };

  // ---- A flight setup: the accent is the plain blue and the mark is the flight path marker.
  if (!(await switcher.innerText()).includes('DCS F/A-18C')) await pick('DCS F/A-18C');
  await expect.poll(() => kindOf(page)).toBe('flight');
  const brand = page.getByTestId('shell-brand');
  await expect(brand).toHaveAttribute('data-kind', 'flight');
  await expect(brand.locator('svg')).toHaveClass(/rr-mark-flight/);
  expect(await colourOf(page, '.shell-brand svg')).toBe(BLUE);
  expect(await colourOf(page, '.shell-bar', '::before')).toBe(BLUE);
  await shot('flight');

  // ---- Switched to the racing setup on the Fly screen: the shell follows by itself.
  await pick('iRacing');
  await expect.poll(() => kindOf(page)).toBe('racing');
  await expect(brand).toHaveAttribute('data-kind', 'racing');
  await expect(brand.locator('svg')).toHaveClass(/rr-mark-racing/);
  expect(await colourOf(page, '.shell-brand svg')).toBe(VIOLET);
  expect(await colourOf(page, '.shell-bar', '::before')).toBe(VIOLET);
  // What can be clicked stays blue, and status keeps its own colours: the accent is decoration.
  expect(await colourOf(page, '.shell-find')).not.toBe(VIOLET);
  await shot('racing');

  // In Configure, the line that says where you are carries it; links and buttons do not.
  await page.getByTestId('mode-configure').click();
  await expect(page.locator('.configure-link.active')).toBeVisible();
  expect(await colourOf(page, '.configure-link.active', '::before')).toBe(VIOLET);
  await go(page, '/configure/backups');
  const add = page.getByTestId('backup-all');
  await expect(add).toBeVisible();
  expect(
    await add.evaluate((el) => {
      const { getComputedStyle } = globalThis as unknown as Dom;
      return getComputedStyle(el as never).backgroundColor;
    })
  ).toBe(BLUE);
  // The small mark inside an empty state's drawing takes it too.
  await expect(page.getByTestId('backups-empty')).toBeVisible();
  expect(
    await page.locator('[data-testid="backups-empty"] .rr-art-mark').evaluate((el) => {
      const { getComputedStyle } = globalThis as unknown as Dom;
      return getComputedStyle(el as never).getPropertyValue('stroke');
    })
  ).toBe(VIOLET);
  const problems = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  expect(problems).toEqual([]);
  await shot('racing-configure');

  // ---- And back, from the palette this time.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('switch');
  await expect(
    page.locator('[data-testid="palette-row"][aria-selected="true"] .rr-palette-title')
  ).toHaveText('Switch to DCS F/A-18C');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fly-page')).toBeVisible();
  await expect.poll(() => kindOf(page)).toBe('flight');
  expect(await colourOf(page, '.shell-brand svg')).toBe(BLUE);
});
