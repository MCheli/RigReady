import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus, type Dom } from './a11y';
import { expect, test } from './harness';

/**
 * The visual system of the final pass (WOW-UI-004 to 007), in the running app: depth,
 * motion and its off switch, the outline a page shows while it reads, the empty states,
 * and the instrument detail of the header.
 */

const go = (page: Page, route: string): Promise<void> =>
  page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `#${route}`);

/** Something still loading, as the whole-app specs (tour, a11y, crawl) look for it. */
const BUSY =
  '.v-progress-circular--indeterminate:visible, .v-progress-linear--active:visible, .v-skeleton-loader:visible';

/** One computed style value of the first element that matches. */
const style = (page: Page, selector: string, property: string, pseudo?: string): Promise<string> =>
  page.evaluate(
    ([sel, prop, ps]) => {
      const { document, getComputedStyle } = globalThis as unknown as Dom;
      const el = document.querySelector(sel as string);
      if (!el) return `no element matches ${sel}`;
      return getComputedStyle(el, (ps as string | null) ?? undefined).getPropertyValue(
        prop as string
      );
    },
    [selector, property, pseudo ?? null] as const
  );

const tokenOf = (page: Page, name: string): Promise<string> =>
  page.evaluate((token) => {
    const { document, getComputedStyle } = globalThis as unknown as Dom;
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  }, name);

test('look: a page that is still reading shows its outline, says so to a screen reader, and counts as loading', async ({
  rig,
}) => {
  const run = await rig.launch('flying-all-good', 'look-loading');
  const { page, shot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // The display driver stops answering: the Monitors page cannot finish reading.
  await run.mutate([{ op: 'hangProvider', port: 'displays' }]);
  await go(page, '/configure/displays');
  const outline = page.getByTestId('page-skeleton');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveAttribute('role', 'status');
  await expect(outline).toHaveAttribute('aria-busy', 'true');
  // The words are there for a screen reader and for the page tour, which reads an
  // ellipsis line as "still loading"; the bars themselves are hidden from both.
  await expect(outline.locator('.rr-sr-only')).toHaveText('Reading the monitors…');
  expect(await page.locator('.rr-page').first().innerText()).toMatch(/^Reading the monitors…$/m);
  await expect(outline.locator('[aria-hidden="true"]')).toHaveCount(1);
  await expect(page.locator(BUSY)).toHaveCount(1);
  // The page frame is already there: its title and what it is for.
  await expect(page.locator('.rr-page-title')).toHaveText('Monitors');
  // It waits a moment before it fades in, so a page that answers at once never flashes it.
  expect(await style(page, '.rr-skeleton', 'animation-delay')).toBe('0.12s');
  await expect.poll(() => style(page, '.rr-skeleton', 'opacity')).toBe('1');
  const problems = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  expect(problems).toEqual([]);
  await shot('reading');

  // The driver answers again: the outline is replaced by the page, and nothing is loading.
  await run.mutate([{ op: 'hangProvider', port: 'displays', hang: false }]);
  await go(page, '/configure/audio');
  await go(page, '/configure/displays');
  await expect(page.getByTestId('displays-page')).toBeVisible();
  await expect(page.getByTestId('display-row').first()).toBeVisible();
  await expect(outline).toHaveCount(0);
  await expect(page.locator(BUSY)).toHaveCount(0);
  await shot('read');
});

test('look: depth, type and motion come from the tokens, and "reduce motion" switches motion off', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-all-good', 'look-system');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');

  // ---- Motion: two durations and one easing, used by pages and dialogs.
  expect(await tokenOf(page, '--rr-motion-fast')).toBe('120ms');
  expect(await tokenOf(page, '--rr-motion-base')).toBe('180ms');
  expect(await tokenOf(page, '--rr-ease')).toBe('cubic-bezier(0.2, 0, 0, 1)');
  await go(page, '/configure/displays');
  await expect(page.getByTestId('displays-page')).toBeVisible();
  expect(await style(page, '.rr-page', 'animation-name')).toBe('rr-page-in');
  expect(await style(page, '.rr-page', 'animation-duration')).toBe('0.18s');
  expect(await style(page, '.rr-page', 'animation-timing-function')).toBe(
    'cubic-bezier(0.2, 0, 0, 1)'
  );

  // ---- Depth: a panel lies on the page, a dialog floats above it with an edge.
  expect(await style(page, '.rr-panel', 'box-shadow')).toContain('inset');
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toBeVisible();
  const floating = await style(page, '[data-testid="shortcuts"]', 'box-shadow');
  expect(floating.split('rgb').length - 1).toBeGreaterThanOrEqual(3);
  expect(await style(page, '.v-dialog .v-overlay__content', 'transition-duration')).toMatch(
    /0\.1[28]s/
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts')).toBeHidden();

  // ---- Type: Windows' own font, and digits of one width for every value.
  expect(await style(page, 'body', 'font-family')).toContain('Segoe UI');
  expect(await style(page, 'body', 'font-variant-numeric')).toBe('tabular-nums');
  expect(await style(page, '.rr-mono', 'font-family')).toContain('Cascadia Mono');

  // ---- The header's instrument detail is drawn, not content: nothing reads or clicks it.
  expect(await style(page, '.shell-bar', 'content', '::after')).toBe('""');
  expect(await style(page, '.shell-bar', 'pointer-events', '::after')).toBe('none');
  expect(await style(page, '.shell-bar', 'background-image', '::after')).toContain(
    'linear-gradient'
  );
  expect(await style(page, '.shell-bar', 'pointer-events', '::before')).toBe('none');
  await expect(page.locator('.shell-brand svg')).toHaveAttribute('aria-hidden', 'true');
  // Where you are in the navigation is a thin line as well as a tint.
  await expect(page.locator('.configure-link.active')).toHaveText('Monitors');
  expect(await style(page, '.configure-link.active', 'width', '::before')).toBe('2px');
  expect(await style(page, '.configure-link.active', 'background-color', '::before')).toBe(
    'rgb(90, 169, 230)'
  );
  await shot('monitors');

  // ---- One focus ring, the same on a link of the shell, a navigation entry and a button.
  const rings = new Set<string>();
  for (const id of ['mode-fly', 'palette-open', 'about-open', 'nav-displays', 'displays-refresh']) {
    const target = page.getByTestId(id);
    await target.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    rings.add(
      await target.evaluate((el) => {
        const { getComputedStyle } = globalThis as unknown as Dom;
        const computed = getComputedStyle(el as never);
        return `${computed.outlineStyle} ${computed.outlineWidth} ${computed.outlineColor}`;
      })
    );
  }
  expect([...rings]).toEqual(['solid 2px rgb(168, 209, 245)']);

  // ---- A loading bar that is not needed yet, as a dialog of a feature keeps one in hand:
  // an animation that never ends, held still. (Put here by the test: no page of the shell
  // has one of its own.)
  await page.evaluate(`(() => {
    const bar = document.createElement('div');
    bar.className = 'v-progress-linear';
    bar.setAttribute('data-testid', 'held-bar');
    bar.style.cssText = 'position:fixed;left:8px;bottom:8px;width:40px;height:2px;opacity:0';
    bar.innerHTML = '<div class="v-progress-linear__indeterminate"></div>';
    document.body.append(bar);
  })()`);
  /** What is animating in the window, or held ready to: its state, whether it ever ends, how long a round takes. */
  const animations = (): Promise<string[]> =>
    page.evaluate(`document.getAnimations().map((a) => {
      const timing = a.effect.getComputedTiming();
      return a.playState + (timing.iterations === Infinity ? ', never ends, ' : ', ends, ') + timing.duration + ' ms';
    })`);
  await expect.poll(animations).toEqual(['paused, never ends, 2200 ms']);

  // ---- Asked for less motion: the tokens are zero, a page does not move, a dialog does not fade.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await tokenOf(page, '--rr-motion-fast')).toBe('0ms');
  expect(await tokenOf(page, '--rr-motion-base')).toBe('0ms');
  await go(page, '/configure/audio');
  await expect(page.getByTestId('audio-page')).toBeVisible();
  // No time at all, exactly: a component that switches its own motion off finds it off.
  expect(await style(page, '.rr-page', 'animation-duration')).toBe('0s');
  await expect.poll(() => style(page, '.rr-page', 'opacity')).toBe('1');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  expect(await style(page, '.v-dialog .v-overlay__content', 'transition-duration')).toBe('0s');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toBeHidden();
  // Only the time is taken away: the bar held in hand is not turned into an animation that
  // runs once, which, held, could never finish. Nothing is left that ends and has not, so
  // whatever waits for the window to stand still (the screenshot) does not wait for ever.
  expect(await style(page, '[data-testid="held-bar"] > div', 'animation-iteration-count')).toBe(
    'infinite'
  );
  expect(await style(page, '[data-testid="held-bar"] > div', 'animation-play-state')).toBe(
    'paused'
  );
  expect((await animations()).filter((a) => a.includes(', ends, '))).toEqual([]);
  await shot('less-motion');
  // Needed, and not allowed to travel: it is drawn whole and dimmed instead of not at all.
  await page.evaluate(
    `document.querySelector('[data-testid="held-bar"]').classList.add('v-progress-linear--active')`
  );
  await expect
    .poll(() => style(page, '[data-testid="held-bar"] > div', 'animation-name'))
    .toBe('none');
  expect(await style(page, '[data-testid="held-bar"] > div', 'opacity')).toBe('0.6');
  expect(await animations()).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await tokenOf(page, '--rr-motion-base')).toBe('180ms');
  // With motion allowed it is what it was: travelling, without end.
  await expect.poll(animations).toEqual(['running, never ends, 2200 ms']);
});

test('look: an empty state has a drawing, says what is missing, and leads somewhere', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('generic-fresh', 'look-empty');
  await expect(page.getByTestId('fly-empty')).toBeVisible();

  // Nothing backed up yet: the drawing, the title, and the two buttons right above it.
  await go(page, '/configure/backups');
  const backups = page.getByTestId('backups-empty');
  await expect(backups).toBeVisible();
  await expect(backups.locator('svg[data-art="backup"]')).toHaveAttribute('aria-hidden', 'true');
  await expect(backups.locator('.rr-empty-title')).toHaveText('No backups yet');
  await expect(backups).toContainText('"Back up now" saves one here');
  await shot('backups');

  // "What changed" needs a setup: the one action leads to making one.
  await page.getByTestId('backups-tab-changes').click();
  const changes = page.getByTestId('changes-no-setups');
  await expect(changes.locator('.rr-empty-title')).toHaveText('Create a setup first');
  await expect(changes.locator('svg[data-art="setup"]')).toBeVisible();
  await shot('changes');
  await changes.getByRole('link', { name: 'New setup from this rig' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)
    )
    .toBe('#/configure/profiles/capture');

  // Nothing changed yet: said as a fact, not as a status.
  await go(page, '/configure/safety');
  const safety = page.getByTestId('safety-empty');
  await expect(safety.locator('.rr-empty-title')).toHaveText(
    'RigReady has not changed any of your files'
  );
  await expect(safety.locator('svg[data-art="shield"]')).toBeVisible();

  // A game that is not on this PC: the same look, with where RigReady looked and what to do.
  await go(page, '/configure/dcs');
  await expect(page.getByTestId('not-here-title')).toHaveText('DCS World was not found on this PC');
  await expect(page.locator('.rr-page svg[data-art="search"]')).toBeVisible();
  await expect(page.getByTestId('not-here-looked')).toContainText('every Steam library');
  // The link in the sentence is the accent, underlined: not told by colour alone.
  const link = page.getByTestId('not-here-game-page');
  await expect(link).toBeVisible();
  expect(
    await link.evaluate((el) => {
      const { getComputedStyle } = globalThis as unknown as Dom;
      const computed = getComputedStyle(el as never);
      return `${computed.color} ${computed.getPropertyValue('text-decoration-line')}`;
    })
  ).toBe('rgb(90, 169, 230) underline');
  await shot('not-on-this-pc');

  // A panel that only says it in words gets the plain drawing, so no empty panel is bare.
  await go(page, '/configure/share');
  const plain = page.locator('.rr-panel.rr-empty:not(.rr-empty-state)').first();
  await expect(plain).toBeVisible();
  expect(
    await plain.evaluate((el) => {
      const { getComputedStyle } = globalThis as unknown as Dom;
      const drawn = getComputedStyle(el as never, '::before');
      return `${drawn.content} ${drawn.display}`;
    })
  ).toBe('"" block');

  // An address that is not a page says so, and offers the way back and the palette.
  await go(page, '/configure/no-such-page');
  const nowhere = page.getByTestId('not-found');
  await expect(nowhere).toContainText('There is nothing at this address.');
  await shot('nothing-at-this-address');
  await nowhere.getByRole('button', { name: 'Find a page' }).click();
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await nowhere.getByRole('link', { name: 'Back to Play' }).click();
  await expect(page.getByTestId('fly-empty')).toBeVisible();

  const problems = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  expect(problems).toEqual([]);
});

test('look: a snackbar of a feature looks like the shell’s toasts, with its tone as an icon', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-optional-missing', 'look-toast');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready with warnings');
  // The window stays where it is after Launch, so there is something to look at.
  const stays = await page.evaluate(() =>
    (
      globalThis as unknown as { rigready: { invoke(c: string, i: unknown): Promise<unknown> } }
    ).rigready.invoke('fly:setPreferences', { minimizeOnLaunch: false })
  );
  expect(stays).toMatchObject({ ok: true, value: { minimizeOnLaunch: false } });
  // Launching with an optional item missing: the Play screen's own snackbar says so.
  await page.getByTestId('launch').click();
  const snackbar = page.locator('.v-snackbar__wrapper');
  await expect(snackbar).toBeVisible();
  await expect(snackbar).toContainText('Launching with 1 optional item not met');
  // It goes away by itself after a few seconds; the pointer on it keeps it for the look.
  await snackbar.hover();
  // A dark raised panel with neutral words, and the warning triangle in front.
  expect(await style(page, '.v-snackbar__wrapper', 'background-color')).toBe('rgb(30, 37, 45)');
  expect(await style(page, '.v-snackbar__wrapper', 'color')).toBe('rgb(230, 233, 237)');
  expect(await style(page, '.v-snackbar__content', 'content', '::before')).not.toBe('none');
  expect(await style(page, '.v-snackbar__content', 'color', '::before')).toBe('rgb(226, 178, 60)');
  const problems = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
  expect(problems).toEqual([]);
  await shot('snackbar');
});

test('look: the navigation shows where you are, also on a page below an entry, and one entry at a time', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-all-good', 'look-navigation');
  const active = page.locator('.configure-link.active');
  // A page with an entry of its own.
  await go(page, '/configure/cheat-sheets');
  await expect(active).toHaveText('Cheat sheets');
  await expect(active).toHaveAttribute('aria-current', 'page');
  // One below it: the trainer has no entry, and is under Cheat sheets.
  await go(page, '/configure/cheat-sheets/learn');
  await expect(page.getByRole('heading', { name: 'Learn your controls' })).toBeVisible();
  await expect(active).toHaveText('Cheat sheets');
  await expect(active).toHaveAttribute('aria-current', 'location');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('trainer-under-cheat-sheets');
  // A setup's editor is under Setups.
  await go(page, '/configure/profiles/dcs-f-a-18c');
  await expect(active).toHaveText('Setups');
  await expect(active).toHaveAttribute('aria-current', 'location');
  // The wheel has an entry of its own below Racing: that one, not both.
  await go(page, '/configure/racing/wheel');
  await expect(active).toHaveText('Wheel');
  await expect(active).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.configure-link[aria-current]')).toHaveCount(1);
  await go(page, '/configure/racing');
  await expect(active).toHaveText('Racing');
  await shot('racing');
});
