import type { Locator, Page } from '@playwright/test';
import { expect } from './harness';

/**
 * Pointing the mouse at a page that has stopped moving. A place read while the page still
 * moves (a dialog or a list opening or closing, a notice going away above, the page
 * scrolling) is no longer where the element is when the button goes down, and the press
 * lands beside it. On GitHub's slow runners that happens often enough to fail a run.
 */

// (The specs are compiled without the browser's own types.)
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Frames {
  requestAnimationFrame(callback: () => void): void;
}

export type Box = Rect;

/** The middle of a box, as page.mouse takes it. */
export const middle = (box: Box): [number, number] => [
  box.x + box.width / 2,
  box.y + box.height / 2,
];

/** Where an element is drawn, read once it is in the same place on two animation frames in a row. */
export async function steadyBox(target: Locator): Promise<Box> {
  let box: Box | undefined;
  await expect
    .poll(async () => {
      const [first, second] = await target.evaluate(
        (el) =>
          new Promise<[string, string]>((resolve) => {
            const { requestAnimationFrame } = globalThis as unknown as Frames;
            const read = (): string => {
              const r = (
                el as unknown as { getBoundingClientRect(): Rect }
              ).getBoundingClientRect();
              return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
            };
            requestAnimationFrame(() => {
              const before = read();
              requestAnimationFrame(() => resolve([before, read()]));
            });
          })
      );
      box = JSON.parse(second) as Box;
      return first === second;
    })
    .toBe(true);
  return box!;
}

/** Waits until nothing on the page is animating and it has not scrolled for two animation frames. */
export async function stillPage(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const view = globalThis as unknown as Frames & {
              scrollX: number;
              scrollY: number;
              document: {
                getAnimations(): {
                  playState: string;
                  effect: { getComputedTiming(): { iterations: number } } | null;
                }[];
              };
            };
            // What a spinner runs for ever is not movement that ends.
            const moving = (): boolean =>
              view.document
                .getAnimations()
                .some(
                  (a) =>
                    a.effect !== null &&
                    a.effect.getComputedTiming().iterations !== Infinity &&
                    a.playState !== 'finished' &&
                    a.playState !== 'idle'
                );
            const at = (): string => `${view.scrollX},${view.scrollY}`;
            const before = at();
            view.requestAnimationFrame(() =>
              view.requestAnimationFrame(() => resolve(!moving() && at() === before))
            );
          })
      )
    )
    .toBe(true);
}

/** Checks that a press at this point lands on the target: the element there is the target or inside it. */
export async function expectUnderPointer(target: Locator, [x, y]: [number, number]): Promise<void> {
  await expect
    .poll(() =>
      target.evaluate(
        (el, point) => {
          const { document } = globalThis as unknown as {
            document: { elementFromPoint(x: number, y: number): unknown };
          };
          const hit = document.elementFromPoint(point.x, point.y);
          return !!hit && (el as unknown as { contains(other: unknown): boolean }).contains(hit);
        },
        { x, y }
      )
    )
    .toBe(true);
}
