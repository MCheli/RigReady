import { promises as fs } from 'node:fs';
import type { ElectronApplication, Locator } from '@playwright/test';

/**
 * Helpers for looking at the app at another size of text (what Ctrl and + does to the
 * window): the page inside the window gets narrower as its text gets larger.
 */

/** Sets the size of the text of the app's own window: 1 is normal, 2 is twice as large. */
export const textSize = (app: ElectronApplication, factor: number): Promise<void> =>
  app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(size);
  }, factor);

/**
 * The whole window as it is on screen, written over `file`. A page screenshot is cut to
 * the page's own, smaller, measure once the text is enlarged; this one is not.
 */
export async function captureWindow(app: ElectronApplication, file: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
  );
  await fs.writeFile(file, Buffer.from(png, 'base64'));
}

/** How many columns the direct children of an element stand in. */
export const columnsOf = (list: Locator): Promise<number> =>
  list.evaluate((el) => {
    const lefts = [...el.children].map((child) => Math.round(child.getBoundingClientRect().left));
    return new Set(lefts).size;
  });
