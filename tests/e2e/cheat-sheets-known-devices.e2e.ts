import { promises as fs } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './harness';

/**
 * The popular controllers RigReady ships a drawing of besides the owner's WinWing set:
 * the Thrustmaster HOTAS Warthog stick and throttle, the T.16000M and the Saitek X52 Pro,
 * plugged into the recorded rig. Each sheet is the drawing with a label block per
 * physical control, named the way the maker names them, with DCS's own Hornet defaults
 * for the device on them; each has a kneeboard page by day and by night.
 */

async function openSheets(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('cheat-sheets-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('sheet-view')).toBeVisible();
}

/** The page itself at full size (768 × 1024), next to the screenshot of the dialog. */
async function savePage(preview: Locator, shotFile: string): Promise<void> {
  const src = (await preview.getAttribute('src')) ?? '';
  const data = /^data:image\/png;base64,(.+)$/.exec(src)?.[1];
  expect(data, 'the preview is a PNG').toBeDefined();
  await fs.writeFile(shotFile.replace(/\.png$/, '-page.png'), Buffer.from(data!, 'base64'));
}

const DEVICES = [
  {
    slug: 'warthog-stick',
    title: 'Joystick - HOTAS Warthog',
    heads: [
      'TG trigger · 1, 6',
      'S2 weapon release · 2',
      'H1 trim hat · H1',
      'H2 TMS hat · 7–10',
      'H4 CMS hat · 15–19',
      'Stick · X, Y',
    ],
  },
  {
    slug: 'warthog-throttle',
    title: 'Throttle - HOTAS Warthog',
    heads: ['Coolie switch · H1', 'MS mic switch · 2–6', 'Throttles · RZ, Z'],
  },
  {
    slug: 't16000m',
    title: 'T.16000M',
    heads: ['Hat · H1', 'Trigger · 1', 'Base, right bank · 11–16'],
  },
  {
    slug: 'x52-pro',
    title: 'X52',
    heads: ['Fire button · 2', 'Stick POV hat · H1', 'T1–T6 toggles · 9–14'],
  },
] as const;

test('cheat sheets: the popular Thrustmaster and Saitek controllers have a drawing', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-known-devices', 'cheat-sheets-known-devices');
  const { page, shot } = run;
  await page.setViewportSize({ width: 1500, height: 1250 });
  await openSheets(page);
  for (const entry of DEVICES) {
    const item = page.locator(`[data-testid="sheet-device"][data-title*="${entry.title}"]`);
    await item.click();
    await expect(page.getByTestId('sheet-title')).toContainText(entry.title);
    const source = page.getByTestId('sheet-layout-source');
    await expect(source).toHaveAttribute('data-picture', 'drawing');
    await expect(source).toHaveText('RigReady drawing');
    const picture = page.locator('[data-testid="sheet-view"] svg');
    // A schematic outline, never a photo.
    await expect(picture.locator('path').first()).toBeVisible();
    await expect(picture.locator('image')).toHaveCount(0);
    const heads = picture.locator('.cs-bhead');
    for (const head of entry.heads) await expect(heads.filter({ hasText: head })).toHaveCount(1);
    // Every button has its own name: no made-up runs of eight.
    await expect(heads.filter({ hasText: /^Buttons? \d/ })).toHaveCount(0);
    if (entry.slug === 'warthog-stick') {
      // DCS's default for the Warthog in the Hornet, on the button it belongs to.
      const release = page.locator('[data-testid="sheet-view"] [data-control="button:2"]');
      await expect(release.first()).toContainText(/Weapon Release|release/i);
      await release.first().click();
      await expect(page.getByTestId('sheet-detail')).toContainText('S2 weapon release');
    }
    await shot(entry.slug);

    // Its kneeboard page, by day and by night.
    await page.getByTestId('sheet-kneeboard').click();
    const preview = page.getByTestId('kneeboard-preview');
    await expect(preview).toHaveAttribute('data-busy', 'false');
    await expect(preview).toHaveAttribute('data-style', 'light');
    await savePage(preview, await shot(`${entry.slug}-kneeboard-day`));
    await page.getByTestId('kneeboard-preview-night').click();
    await expect(preview).toHaveAttribute('data-style', 'night');
    await expect(preview).toHaveAttribute('data-busy', 'false');
    await savePage(preview, await shot(`${entry.slug}-kneeboard-night`));
    await page.getByTestId('kneeboard-preview-light').click();
    await expect(preview).toHaveAttribute('data-style', 'light');
    await page.getByTestId('kneeboard-close').click();
    await expect(page.getByTestId('kneeboard-dialog')).toHaveCount(0);
  }
});
