import type { Locator, Page } from '@playwright/test';
import { expect } from './harness';

interface View {
  scrollTo(x: number, y: number): void;
  scrollY: number;
  innerHeight: number;
  document: { documentElement: { scrollHeight: number } };
}

/** Where the window is scrolled to, how high it is, and how long the page in it is. */
const measure = (page: Page): Promise<{ at: number; window: number; page: number }> =>
  page.evaluate(() => {
    const view = globalThis as unknown as View;
    return {
      at: view.scrollY,
      window: view.innerHeight,
      page: view.document.documentElement.scrollHeight,
    };
  });

const scrollTo = (page: Page, where: 'top' | 'end'): Promise<void> =>
  page.evaluate((end) => {
    const view = globalThis as unknown as View;
    view.scrollTo(0, end ? view.document.documentElement.scrollHeight : 0);
  }, where === 'end');

/**
 * The shared Save bar (src/renderer/components/SaveBar.vue) on a page longer than the
 * window: the button the page keeps in it is wholly inside the window with the page
 * scrolled to its very top and to its very end, and at the end the bar lies on the bottom
 * edge of the window. `shot` takes a picture at each of the two places.
 */
export async function expectSaveBarPinned(
  page: Page,
  button: Locator,
  shot?: (name: string) => Promise<string>
): Promise<void> {
  const bar = page.getByTestId('save-bar');

  await scrollTo(page, 'top');
  const top = await measure(page);
  expect(top.at).toBe(0);
  expect(top.page, 'the page is longer than the window').toBeGreaterThan(top.window);
  await expect(button).toBeInViewport({ ratio: 1 });
  await expect(bar).toBeInViewport({ ratio: 1 });
  if (shot) await shot('top-of-the-page');

  await scrollTo(page, 'end');
  await expect
    .poll(async () => {
      const now = await measure(page);
      return Math.round(now.page - now.window - now.at);
    })
    .toBe(0);
  await expect(button).toBeInViewport({ ratio: 1 });
  const end = await measure(page);
  const box = (await bar.boundingBox())!;
  expect(
    Math.abs(box.y + box.height - end.window),
    "the bar's bottom edge is the window's"
  ).toBeLessThanOrEqual(1);
  if (shot) await shot('end-of-the-page');
}
