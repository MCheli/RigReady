import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { checkRow, expect, test } from './harness';

/**
 * The rig at a glance: the strip under the top of the Play screen that draws the monitors
 * to scale and lists the setup's devices, so that a problem is a place and not only a row.
 */

interface Box {
  label: string | null;
  issue: string | null;
  width: number;
  height: number;
  left: number;
  top: number;
}

/** Every monitor in the drawing, with where it is and how large. */
const monitors = (page: Page): Promise<Box[]> =>
  page.getByTestId('rig-monitor').evaluateAll((all) =>
    all.map((el) => {
      const box = el.getBoundingClientRect();
      return {
        label: el.getAttribute('data-label'),
        issue: el.getAttribute('data-issue'),
        width: box.width,
        height: box.height,
        left: box.left,
        top: box.top,
      };
    })
  );

const focusedItem = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: { activeElement: { getAttribute(name: string): string | null } | null };
    };
    return scope.document.activeElement?.getAttribute('data-title') ?? null;
  });

const chip = (page: Page, title: string) =>
  page.getByTestId('fly-rig').locator(`[data-testid="rig-device"][title*="${title}"]`);

test('rig: the monitors are drawn to scale and the devices are chips; a problem is a place, and choosing it leads to its row', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-mfd-rotated', 'fly-rig');
  await mutate([{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('fly-status-count')).toHaveText('(2)');
  const strip = page.getByTestId('fly-rig');
  await expect(strip).toBeVisible();

  // ---- Monitors: the four that are on, each in proportion and in its place.
  await expect(page.getByTestId('rig-monitor')).toHaveCount(4);
  const drawn = await monitors(page);
  expect(drawn.map((m) => m.label)).toEqual([
    'LC49G95T',
    'USB_Monitor (1 of 3)',
    'USB_Monitor (2 of 3)',
    'USB_Monitor (3 of 3)',
  ]);
  const [wide, first, second, third] = drawn as [Box, Box, Box, Box];
  // 5120x1440 beside 768x1024 screens standing on end: the same scale for all of them.
  expect(wide.width / wide.height).toBeCloseTo(5120 / 1440, 1);
  expect(first.width / wide.width).toBeCloseTo(768 / 5120, 2);
  expect(first.height).toBeGreaterThan(first.width);
  expect(third.height).toBeGreaterThan(third.width);
  expect(first.left).toBeGreaterThanOrEqual(wide.left + wide.width - 1);
  // The middle one lies flat: that is what is wrong, and it shows as such.
  expect(second.width).toBeGreaterThan(second.height);
  expect(second.issue).toBe('rotated 0°, expected 90°');
  expect([wide.issue, first.issue, third.issue]).toEqual(['', '', '']);
  const wrong = page.locator('[data-testid="rig-monitor"][data-label="USB_Monitor (2 of 3)"]');
  // Marked by a dashed outline and a sign with a name, not by colour alone.
  await expect(wrong).toHaveCSS('border-top-style', 'dashed');
  await expect(wrong.locator('.v-icon')).toHaveAttribute(
    'aria-label',
    'USB_Monitor (2 of 3): rotated 0°, expected 90°'
  );
  await expect(page.getByTestId('rig-notes').locator('li')).toHaveText([
    'USB_Monitor (2 of 3): rotated 0°, expected 90°',
    'DELL G3223D is off',
  ]);
  await expect(page.getByTestId('rig-monitors')).toHaveAttribute('data-state', 'fail');
  await expect(page.getByTestId('rig-desk')).toHaveAttribute(
    'aria-label',
    '4 monitors on, 1 off; 1 not as this setup expects. Show the monitor check'
  );

  // ---- Devices: a chip each, with what kind of thing it is and how it stands.
  const chips = page.getByTestId('rig-device');
  await expect(chips).toHaveCount(12);
  // The maker most of them share is left out of the chip; the tooltip has the whole name.
  await expect(chips.nth(0)).toHaveText('Orion Joystick Base 2 + JGRIP-F16');
  await expect(chips.nth(0)).toHaveAttribute(
    'title',
    'Stick: WINWING Orion Joystick Base 2 + JGRIP-F16 · Connected · On USB2.1 Hub'
  );
  expect(
    await chips.evaluateAll((all) =>
      all.map((el) => `${el.getAttribute('data-kind')}:${el.getAttribute('data-state')}`)
    )
  ).toEqual([
    'stick:pass',
    'throttle:pass',
    'pedals:fail',
    'display:pass',
    'display:pass',
    'display:pass',
    'display:pass',
    'panel:pass',
    'panel:pass',
    'panel:pass',
    'tracker:pass',
    'deck:pass',
  ]);
  const pedals = chip(page, 'T-Pendular-Rudder');
  // What the check found is in the tooltip, in the check's own words.
  await expect(pedals).toHaveAttribute('title', /^Pedals: T-Pendular-Rudder · Not connected/);
  await expect(pedals.locator('.v-icon').last()).toHaveAttribute('aria-label', 'Not met');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('problems-as-places');

  // ---- Choosing a device leads to its row: in view, pointed at, and where the keyboard goes on.
  await pedals.click();
  const row = checkRow(page, 'T-Pendular-Rudder');
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/check-flash/);
  expect(await focusedItem(page)).toBe('T-Pendular-Rudder');
  await expect(row).not.toHaveClass(/check-flash/);
  // A device that is fine sits in a folded group: choosing it opens the group. It is
  // already open here; the stick's row is there to go to.
  await chip(page, 'Orion Joystick').click();
  await expect(checkRow(page, 'WINWING Orion Joystick Base 2 + JGRIP-F16')).toBeInViewport();

  // ---- Choosing the monitors leads to the monitor check.
  await page.getByTestId('rig-desk').click();
  const layout = checkRow(page, 'Monitor layout');
  await expect(layout).toBeInViewport();
  expect(await focusedItem(page)).toBe('Monitor layout');
  await shot('led-to-the-row');

  // ---- Fixed: the drawing follows. The screen stands on end again and nothing is marked.
  await layout.getByTestId('check-fix').click();
  await page.getByTestId('keep-layout-keep').click();
  await expect(layout).toHaveAttribute('data-status', 'pass');
  await expect(wrong).toHaveAttribute('data-issue', '');
  await expect
    .poll(async () => {
      const now = (await monitors(page))[2]!;
      return now.height > now.width;
    })
    .toBe(true);
  await expect(page.getByTestId('rig-notes').locator('li')).toHaveText(['DELL G3223D is off']);
  await expect(page.getByTestId('rig-monitors')).toHaveAttribute('data-state', 'pass');
  // The pedals come back: their chip turns by itself.
  await mutate([{ op: 'plugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(pedals).toHaveAttribute('data-state', 'pass');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await page.evaluate(() =>
    (globalThis as unknown as { scrollTo(x: number, y: number): void }).scrollTo(0, 0)
  );
  await shot('all-in-place');
});

test('rig: a device in a folded group is one click away, and a setup without a monitor check still shows the monitors', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('fly-two-setups', 'fly-rig-plain');
  await expect(page.getByTestId('profile-switcher')).toContainText('DCS UH-1H');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // Everything is fine: the groups are folded, no row is on screen.
  await expect(page.getByTestId('check-row')).toHaveCount(0);
  await expect(page.getByTestId('rig-device')).toHaveCount(4);
  await chip(page, 'TrackIR 5').click();
  await expect(page.getByTestId('group-toggle-devices')).toHaveAttribute('aria-expanded', 'true');
  await expect(checkRow(page, 'TrackIR 5')).toBeInViewport();
  expect(await focusedItem(page)).toBe('TrackIR 5');

  // This setup expects nothing of the monitors: they are a picture, not a way to a row.
  await expect(page.getByTestId('rig-monitors')).toHaveAttribute('data-state', 'none');
  const desk = page.getByTestId('rig-desk');
  await expect(desk).toHaveAttribute('role', 'img');
  await expect(desk).toHaveAttribute('aria-label', '4 monitors on, 1 off');
  expect(await desk.evaluate((el) => el.tagName)).toBe('DIV');
  await expect(page.getByTestId('rig-monitor')).toHaveCount(4);
  // Whatever state they are in, nothing is marked, because nothing is expected.
  await mutate([
    {
      op: 'setDisplay',
      match: { name: 'USB_Monitor', index: 1 },
      set: { rotation: 0, width: 1024, height: 768 },
    },
  ]);
  await expect
    .poll(async () => {
      const second = (await monitors(page))[2]!;
      return second.width > second.height;
    })
    .toBe(true);
  expect((await monitors(page)).map((m) => m.issue)).toEqual(['', '', '', '']);
  // (The app's own notice about the broken setup file is closed first: it is not this screen's.)
  await page.getByTestId('app-notice').getByRole('button').click();
  await expect(page.getByTestId('app-notice')).toHaveCount(0);
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('no-monitor-check');
});

test('rig: a monitor that is unplugged, and monitors that cannot be read, are said in words', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-all-good', 'fly-rig-trouble');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('rig-notes').locator('li')).toHaveText(['DELL G3223D is off']);

  await mutate([{ op: 'unplugDisplay', match: { name: 'USB_Monitor', index: 2 } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await expect(page.getByTestId('rig-monitor')).toHaveCount(3);
  await expect(page.getByTestId('rig-notes').locator('li')).toHaveText([
    'USB_Monitor (3 of 3): not connected',
    'DELL G3223D is off',
  ]);
  await expect(page.getByTestId('rig-notes').locator('li').first()).toHaveAttribute(
    'data-wrong',
    'true'
  );
  await shot('unplugged');

  await mutate([
    { op: 'failProvider', port: 'displays', message: 'The display driver did not answer.' },
  ]);
  await expect(page.getByTestId('rig-monitors-error')).toHaveText(
    'The monitors cannot be read: The display driver did not answer.'
  );
  await expect(page.getByTestId('rig-monitor')).toHaveCount(0);
  // The devices are still there.
  await expect(page.getByTestId('rig-device')).toHaveCount(12);
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
});
