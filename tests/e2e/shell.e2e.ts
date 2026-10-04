import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus, type Dom } from './a11y';
import { expect, test } from './harness';

/**
 * The app shell (WOW-UI): the command palette with the commands the features contribute,
 * the keyboard shortcuts, the toasts that report what a command did, and About.
 */

const hash = (page: Page): Promise<string> =>
  page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash);

/** Every route a link can open as it is, read from the running app's router. */
const routesOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: {
        querySelector(selector: string): {
          __vue_app__: {
            config: { globalProperties: { $router: { getRoutes(): { path: string }[] } } };
          };
        };
      };
    };
    const app = scope.document.querySelector('#app').__vue_app__;
    return app.config.globalProperties.$router.getRoutes().map((route) => route.path);
  });

/** The links among these that the app has no page for. */
const strays = (page: Page, links: string[]): Promise<string[]> =>
  page.evaluate((all) => {
    const scope = globalThis as unknown as {
      document: {
        querySelector(selector: string): {
          __vue_app__: {
            config: {
              globalProperties: {
                $router: { resolve(to: string): { matched: { path: string }[] } };
              };
            };
          };
        };
      };
    };
    const router = scope.document.querySelector('#app').__vue_app__.config.globalProperties.$router;
    return all.filter((to) => {
      const matched = router.resolve(to).matched;
      const last = matched[matched.length - 1]?.path ?? '';
      return matched.length === 0 || last.includes('*');
    });
  }, links);

/** What has the keyboard focus: its test id, or the test id of the nearest element that has one. */
const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as Dom;
    const el = document.activeElement ?? document.body;
    return el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName.toLowerCase();
  });

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect(page.getByTestId('palette-input')).toBeFocused();
}

const rows = (page: Page) => page.getByTestId('palette-row');
const marked = (page: Page) => page.locator('[data-testid="palette-row"][aria-selected="true"]');
const toasts = (page: Page) => page.getByTestId('toast');
const toast = (page: Page, tone: string) =>
  page.locator(`[data-testid="toast"][data-tone="${tone}"]`);

/** Types into the open palette, checks the row that is marked, and runs it. */
async function choose(page: Page, typed: string, title: string | RegExp): Promise<void> {
  await page.keyboard.type(typed);
  await expect(marked(page).locator('.rr-palette-title')).toHaveText(title);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toBeHidden();
}

test('palette: Ctrl+K finds every page and the commands of the features, by keyboard alone', async ({
  rig,
}) => {
  const run = await rig.launch('flying-trackir-not-running', 'shell-palette');
  const { page, shot } = run;
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');

  // ---- It opens on Ctrl+K from wherever the focus is, and Escape puts the focus back there.
  await page.getByTestId('recheck').focus();
  await openPalette(page);
  const input = page.getByTestId('palette-input');
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toHaveAttribute('aria-controls', 'rr-palette-list');
  await expect(page.getByTestId('palette-list')).toHaveAttribute('role', 'listbox');
  // The commands that depend on the setup arrive: the Fly actions lead the list.
  await expect(rows(page).first()).toHaveAttribute('data-command', 'fly.makeReady');
  await expect(page.getByTestId('palette-heading').first()).toHaveText('Fly');
  await expect(rows(page).first()).toContainText('DCS F/A-18C');
  // The marked row is the one the field points a screen reader at.
  await expect(input).toHaveAttribute('aria-activedescendant', 'rr-palette-option-0');
  await expect(marked(page)).toHaveAttribute('id', 'rr-palette-option-0');
  await shot('open');

  // ---- Every page is in it: each route a link can open, sub-pages included.
  const all = (await routesOf(page))
    .map((r) => r.replace(/\/:[^/]+\?/g, ''))
    .filter((r) => !r.includes(':') && !r.includes('*') && r !== '/' && r !== '/configure');
  const offered = new Set(
    await rows(page).evaluateAll((list) =>
      list.map((row) => (row.getAttribute('data-to') ?? '').split('?')[0])
    )
  );
  expect(all.length).toBeGreaterThan(25);
  expect(all.filter((route) => !offered.has(route))).toEqual([]);
  // And nothing it offers leads nowhere: every link is a route of the app.
  const targets = await rows(page).evaluateAll((list) =>
    list.map((row) => row.getAttribute('data-to') ?? '').filter(Boolean)
  );
  expect(targets.length).toBeGreaterThan(all.length);
  expect(await strays(page, targets)).toEqual([]);

  // ---- Arrow keys move the mark, round at the ends; the field keeps the focus.
  await page.keyboard.press('ArrowDown');
  await expect(marked(page)).toHaveAttribute('data-command', 'fly.launch');
  await expect(input).toHaveAttribute('aria-activedescendant', 'rr-palette-option-1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const count = await rows(page).count();
  await expect(marked(page)).toHaveAttribute('id', `rr-palette-option-${count - 1}`);
  await expect(marked(page)).toBeInViewport();
  await page.keyboard.press('ArrowDown');
  await expect(marked(page)).toHaveAttribute('data-command', 'fly.makeReady');
  await expect(input).toBeFocused();

  // ---- Typing finds by loose spelling; the letters found are marked.
  await page.keyboard.type('mon');
  await expect(marked(page).locator('.rr-palette-title')).toHaveText('Monitors');
  await expect(marked(page).locator('mark')).toHaveText('Mon');
  await expect(rows(page).nth(1)).toContainText('monitor');
  await expect(page.getByTestId('palette-count')).toHaveText(/^\d+ matches$/);
  await shot('typed');
  await input.fill('zzzz');
  await expect(page.getByTestId('palette-none')).toContainText('Nothing matches “zzzz”');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  // "?" typed here is a question mark, not the shortcut list.
  await input.fill('');
  await page.keyboard.type('?');
  await expect(input).toHaveValue('?');
  await expect(page.getByTestId('shortcuts')).toHaveCount(0);

  // ---- Escape closes it, and the focus is back on the button it came from.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toBeHidden();
  await expect.poll(() => focused(page)).toBe('recheck');

  // ---- A command: Make ready, from the keyboard. The toast says what the Fly channel answered.
  await openPalette(page);
  await choose(page, 'mr', 'Make ready');
  await expect(toast(page, 'ok')).toBeVisible();
  await expect(toast(page, 'ok').getByTestId('toast-text')).toHaveText('DCS F/A-18C is ready');
  await expect(toast(page, 'ok').getByTestId('toast-detail')).toHaveText('1 of 1 fix worked.');
  // The Fly screen behind it has looked again by itself.
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // The focus went back to where it was: the page did not change.
  await expect.poll(() => focused(page)).toBe('recheck');
  await shot('made-ready');

  // ---- The command used last leads the list the next time.
  await openPalette(page);
  await expect(page.getByTestId('palette-heading').first()).toHaveText('Recent');
  await expect(rows(page).first()).toHaveAttribute('data-command', 'fly.makeReady');
  await shot('recent');

  // ---- A page: found by a word it is also known by, opened, and the focus moves into it.
  await choose(page, 'undo', 'Safety');
  await expect.poll(() => hash(page)).toBe('#/configure/safety');
  await expect(page.getByTestId('safety-page')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { document } = globalThis as unknown as Dom;
        return document.activeElement?.closest('.rr-page') !== null;
      })
    )
    .toBe(true);
  // A sub-page under the name its tab carries.
  await openPalette(page);
  await choose(page, 'usb', 'USB map');
  await expect.poll(() => hash(page)).toBe('#/configure/devices/usb');
  await shot('opened-usb-map');

  // ---- What was used last is remembered when RigReady is started again.
  const again = await run.restart();
  await expect(again.page.getByTestId('fly-page')).toBeVisible();
  await openPalette(again.page);
  await expect(again.page.getByTestId('palette-heading').first()).toHaveText('Recent');
  await expect(again.page.locator('[role="group"]').first().getByTestId('palette-row')).toHaveText([
    /^USB map/,
    /^Safety/,
    /^Make ready/,
  ]);
});

test('shortcuts: "?" lists them, Ctrl+1 and Ctrl+2 change mode, and a waiting dialog keeps the keyboard', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-trackir-not-running', 'shell-shortcuts');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');

  await page.keyboard.press('Control+2');
  await expect.poll(() => hash(page)).toMatch(/^#\/configure\//);
  await expect(page.getByTestId('configure-nav')).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect.poll(() => hash(page)).toBe('#/fly');
  await expect(page.getByTestId('fly-page')).toBeVisible();

  // "?" shows the list: one row per shortcut, each key as printed on the keyboard.
  await page.keyboard.press('?');
  const overlay = page.getByTestId('shortcuts');
  await expect(overlay).toBeVisible();
  const listed = page.getByTestId('shortcut-row');
  await expect(listed).toHaveCount(4);
  await expect(
    listed.filter({ hasText: 'Find a page or run a command' }).locator('kbd')
  ).toHaveText(['Ctrl', 'K']);
  await expect(listed.filter({ hasText: 'Go to Fly' }).locator('kbd')).toHaveText(['Ctrl', '1']);
  await expect(listed.filter({ hasText: 'Go to Configure' }).locator('kbd')).toHaveText([
    'Ctrl',
    '2',
  ]);
  await shot('shortcuts');
  // From the list straight into the palette.
  await page.getByTestId('shortcuts-palette').click();
  await expect(overlay).toBeHidden();
  await expect(page.getByTestId('palette-input')).toBeFocused();
  // The palette offers the list too.
  await choose(page, 'keyboard', 'Keyboard shortcuts');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  // The header button is the same door as Ctrl+K.
  await page.getByTestId('palette-open').click();
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeHidden();
  await expect.poll(() => focused(page)).toBe('palette-open');

  // A dialog of a feature that waits for an answer keeps the keyboard: no palette over it.
  await page.getByTestId('launch').click();
  await expect(page.getByTestId('launch-warning')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+2');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByTestId('launch-warning')).toBeVisible();
  expect(await hash(page)).toBe('#/fly');
  await page.getByTestId('launch-cancel').click();
  await expect(page.getByTestId('launch-warning')).toBeHidden();
});

test('palette commands: each calls its feature and the toast reports what really happened', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  const run = await rig.launch('displays-layouts', 'shell-commands');
  const { page, shot } = run;
  await expect(page.getByTestId('fly-page')).toBeVisible();

  // ---- Monitors: apply a saved layout. The outcome is the answer to "Keep this layout?".
  await openPalette(page);
  await expect(rows(page).filter({ hasText: 'Apply layout: Flying' })).toContainText('differences');
  await choose(page, 'apply flying', 'Apply layout: Flying');
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await expect(toast(page, 'busy').getByTestId('toast-text')).toHaveText(
    'Applied "Flying". Keep it, or it goes back by itself…'
  );
  await shot('layout-applied-waiting');
  await page.getByTestId('keep-layout-keep').click();
  await expect(toast(page, 'ok').getByTestId('toast-text')).toHaveText(
    'Applied "Flying", and kept'
  );
  await expect(toast(page, 'busy')).toHaveCount(0);
  await toast(page, 'ok').getByTestId('toast-close').click();
  await expect(toasts(page)).toHaveCount(0);

  // The same layout again: nothing to do, said as it is.
  await openPalette(page);
  await expect(rows(page).filter({ hasText: 'Apply layout: Flying' }).last()).toContainText(
    'arranged like this now'
  );
  await choose(page, 'apply flying', 'Apply layout: Flying');
  await expect(toast(page, 'info').getByTestId('toast-text')).toHaveText(
    'The monitors already match "Flying". Nothing was changed.'
  );
  await toast(page, 'info').getByTestId('toast-close').click();

  // One that needs a monitor that is not connected: refused, with the way to the page.
  await openPalette(page);
  await choose(page, 'racing layout', 'Apply layout: Racing');
  await expect(toast(page, 'bad').getByTestId('toast-text')).toContainText(
    'not connected. Nothing was changed.'
  );
  await shot('layout-refused');
  await toast(page, 'bad').getByTestId('toast-action').click();
  await expect.poll(() => hash(page)).toBe('#/configure/displays');
  await expect(toasts(page)).toHaveCount(0);

  // ---- Identify, from the Monitors page.
  await openPalette(page);
  await choose(page, 'identify', 'Identify monitors');
  await expect(toast(page, 'ok').getByTestId('toast-text')).toHaveText(
    /^Each monitor that is on shows its number \(\d\)$/
  );
  await toast(page, 'ok').getByTestId('toast-close').click();

  // ---- Backups: a full backup, with the backup that was written named in the toast.
  await openPalette(page);
  await choose(page, 'back up', 'Back up now');
  const backedUp = toast(page, 'ok').getByTestId('toast-text');
  await expect(backedUp).toHaveText(/^Backed up \d+ files? \(.+\) as ".+"$/);
  const name = /as "(.+)"$/.exec((await backedUp.textContent()) ?? '')![1]!;
  await shot('backed-up');
  await toast(page, 'ok').getByTestId('toast-action').click();
  await expect.poll(() => hash(page)).toBe('#/configure/backups');
  await expect(page.getByTestId('backup-row')).toHaveCount(1);
  await expect(page.getByTestId('backup-row')).toContainText(name);

  // ---- Diagnostics: the report on the clipboard.
  await openPalette(page);
  await choose(page, 'copy diag', 'Copy the diagnostics report');
  await expect(toast(page, 'ok').getByTestId('toast-text')).toHaveText(
    'The diagnostics report is on the clipboard'
  );
  await expect(toast(page, 'ok').getByTestId('toast-detail')).toHaveText(/^[\d,]+ characters/);
  await toast(page, 'ok').getByTestId('toast-close').click();

  // ---- Devices: "Find a device" listens from any page; a press names the device and opens it.
  await openPalette(page);
  await choose(page, 'find', 'Find a device');
  await expect(toast(page, 'busy').getByTestId('toast-text')).toHaveText(
    'Press a button on the device you are looking for…'
  );
  await shot('find-listening');
  const mfd = (pressed: number[]) => ({
    index: 8,
    name: 'WINWING MFD1-R',
    axes: [0],
    buttons: Array.from({ length: 50 }, (_, i) => pressed.includes(i + 1)),
    hats: [],
    timestamp: Date.now(),
  });
  await run.sendInput([mfd([])]);
  await run.sendInput([mfd([5])]);
  await expect(toast(page, 'ok').getByTestId('toast-text')).toHaveText('That is WINWING MFD1-R');
  await expect(toast(page, 'ok').getByTestId('toast-detail')).toHaveText(
    'Button 5 was pressed. It is open on the Devices page.'
  );
  await expect.poll(() => hash(page)).toMatch(/^#\/configure\/devices\?select=/);
  const found = page.locator('[data-testid="device-row"][data-name="WINWING MFD1-R"]');
  await expect(found).toHaveClass(/highlighted/);
  await expect(found.getByTestId('device-detail')).toBeVisible();
  await shot('found-device');
});

test('palette commands: bindings and cheat sheets open on the aircraft, setups switch, and a failing feature is named', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  const run = await rig.launch('fly-two-setups', 'shell-commands-setups');
  const { page, shot } = run;
  await expect(page.getByTestId('fly-status-title')).not.toHaveText('Checking…');
  const before = (await page.getByTestId('profile-switcher').innerText()).trim();

  // ---- Switch to the other setup: it becomes the one on the Fly screen.
  await openPalette(page);
  const switches = rows(page).filter({ hasText: 'Switch to ' });
  await expect(switches).toHaveCount(1);
  const target = ((await switches.locator('.rr-palette-title').textContent()) ?? '').replace(
    'Switch to ',
    ''
  );
  expect(before).not.toContain(target);
  await choose(page, 'switch', `Switch to ${target}`);
  await expect(toasts(page).getByTestId('toast-text')).toHaveText(
    new RegExp(`^Now on the Fly screen: ${target.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')} is `)
  );
  await expect(page.getByTestId('profile-switcher')).toContainText(target);
  await shot('switched');
  await toasts(page).getByTestId('toast-close').click();

  // ---- DCS bindings: straight to an aircraft.
  await openPalette(page);
  await choose(page, 'bindings f18', /^Bindings: F\/A-18C/);
  await expect.poll(() => hash(page)).toBe('#/configure/dcs-bindings?aircraft=FA-18C_hornet');
  await expect(page.getByTestId('bindings-aircraft')).toContainText('F/A-18C');

  // ---- Cheat sheets: the sheet of an aircraft, and the quick look.
  await openPalette(page);
  await choose(page, 'sheet f18', /^Cheat sheet: F\/A-18C/);
  await expect
    .poll(() => hash(page))
    .toBe('#/configure/cheat-sheets?game=dcs&aircraft=FA-18C_hornet');
  await expect(page.getByTestId('cheat-sheets-page')).toBeVisible();
  await openPalette(page);
  await choose(page, 'quick', 'Quick look');
  await expect.poll(() => hash(page)).toBe('#/configure/cheat-sheets/quick');
  await expect(page.getByTestId('quick-look')).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('fly-page')).toBeVisible();

  // ---- A feature that cannot list its commands is named, with the reason; the rest still works.
  await run.mutate([
    { op: 'failProvider', port: 'displays', message: 'The display driver did not answer.' },
  ]);
  await openPalette(page);
  await expect(page.getByTestId('palette-problem')).toContainText('Monitors');
  await expect(page.getByTestId('palette-problem')).toContainText('did not answer');
  await expect(rows(page).filter({ hasText: 'Apply layout' })).toHaveCount(0);
  await shot('feature-not-listed');
  await choose(page, 'identify', 'Identify monitors');
  await expect(toast(page, 'bad')).toBeVisible();
  await expect(toast(page, 'bad').getByTestId('toast-action')).toHaveText('Open Monitors');
});

test('palette: a first run and a PC without any sim still get a palette that works', async ({
  rig,
}) => {
  const first = await rig.launch('flying-fresh', 'shell-first-run');
  await expect(first.page.getByTestId('fly-empty')).toBeVisible();
  await openPalette(first.page);
  await expect(rows(first.page).first()).toHaveAttribute('data-command', 'fly.create');
  await expect(first.page.getByTestId('palette-problem')).toHaveCount(0);
  await first.shot('palette');
  await first.page.keyboard.press('Enter');
  await expect.poll(() => hash(first.page)).toBe('#/configure/profiles/capture');
  await first.app.close();

  const generic = await rig.launch('generic-fresh', 'shell-generic');
  await expect(generic.page.getByTestId('fly-empty')).toBeVisible();
  await openPalette(generic.page);
  // No DCS, no layouts: nothing to list for them, and nothing reported as failing.
  await expect(generic.page.getByTestId('palette-problem')).toHaveCount(0);
  await expect(generic.page.locator('[data-command^="dcs-bindings.aircraft."]')).toHaveCount(0);
  await expect(generic.page.locator('[data-command^="cheat-sheets.sheet."]')).toHaveCount(0);
  await expect(rows(generic.page).filter({ hasText: 'Apply layout' })).toHaveCount(0);
  await expect(rows(generic.page).filter({ hasText: 'Back up now' })).toHaveCount(1);
  await generic.shot('palette');
});

test('a11y: the palette, the shortcut list, About and the toasts pass axe and never say it by colour alone', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('displays-layouts', 'shell-a11y');
  await expect(page.getByTestId('fly-page')).toBeVisible();
  const problems: Record<string, unknown[]> = {};
  const scan = async (where: string): Promise<void> => {
    const found = [...(await axeViolations(page)), ...(await colourOnlyStatus(page))];
    if (found.length > 0) problems[where] = found;
  };

  await openPalette(page);
  await expect(rows(page).filter({ hasText: 'Apply layout' }).first()).toBeVisible();
  await scan('palette, nothing typed');
  await page.keyboard.type('mon');
  await scan('palette, typed');
  await page.getByTestId('palette-input').fill('zzzz');
  await expect(page.getByTestId('palette-none')).toBeVisible();
  await scan('palette, nothing found');
  await page.keyboard.press('Escape');

  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toBeVisible();
  await scan('shortcut list');
  await page.keyboard.press('Escape');

  await page.getByTestId('about-open').click();
  await expect(page.getByTestId('about')).toBeVisible();
  await scan('About');
  await shot('about');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('about')).toBeHidden();

  // Toasts of every tone at once: done, a note, refused, and one still running.
  await openPalette(page);
  await choose(page, 'copy diag', 'Copy the diagnostics report');
  await expect(toast(page, 'ok')).toBeVisible();
  await openPalette(page);
  await choose(page, 'desk layout', 'Apply layout: Desk');
  await expect(page.getByTestId('keep-layout')).toBeVisible();
  await page.getByTestId('keep-layout-revert').click();
  await expect(toast(page, 'warn')).toBeVisible();
  await openPalette(page);
  await choose(page, 'racing layout', 'Apply layout: Racing');
  await expect(toast(page, 'bad')).toBeVisible();
  await openPalette(page);
  await choose(page, 'find', 'Find a device');
  await expect(toast(page, 'busy')).toBeVisible();
  await expect(toasts(page)).toHaveCount(4);
  await scan('toasts');
  await shot('toasts');
  // Each toast is a polite live region with its tone in words for a screen reader.
  for (const [tone, word] of [
    ['ok', 'Done:'],
    ['warn', 'Attention:'],
    ['bad', 'Not done:'],
    ['busy', 'Working:'],
  ] as const) {
    await expect(toast(page, tone)).toHaveAttribute('role', 'status');
    await expect(toast(page, tone)).toHaveAttribute('aria-live', 'polite');
    await expect(toast(page, tone).locator('.rr-sr-only')).toHaveText(word);
  }

  expect(problems).toEqual({});
});
