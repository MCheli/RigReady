import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/**
 * The top of the Play screen: the readiness dial, the setup's identity and the state in
 * words, and how the checklist arrives.
 */

interface Scope {
  document: { querySelectorAll(selector: string): Iterable<unknown> };
  getComputedStyle(el: unknown): { getPropertyValue(name: string): string };
}

/** Computed style properties of every element a selector finds (custom properties included). */
const styles = (page: Page, selector: string, properties: string[]): Promise<string[][]> =>
  page.evaluate(
    ([query, names]) => {
      const { document, getComputedStyle } = globalThis as unknown as Scope;
      return [...document.querySelectorAll(query)].map((el) => {
        const style = getComputedStyle(el);
        return names.map((name) => style.getPropertyValue(name).trim());
      });
    },
    [selector, properties] as const
  );

const DIAL = '[data-testid="fly-dial"]';

test('hero: the dial counts the checks met, a failing item stands out of the ring, and getting ready is one change of state', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch('flying-pedals-unplugged', 'fly-hero');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');

  // The setup is the title of the screen: its name large, the game under it.
  const hero = page.getByTestId('fly-hero');
  await expect(hero.getByTestId('profile-switcher')).toContainText('DCS F/A-18C');
  await expect(hero.getByTestId('fly-context')).toContainText('DCS World');
  const [name] = await styles(page, '[data-testid="profile-switcher"] .v-select__selection-text', [
    'font-size',
  ]);
  expect(parseFloat(name![0]!)).toBeGreaterThanOrEqual(24);

  // Fifteen of sixteen, said as a number, as a picture and as words for a screen reader.
  const dial = page.getByTestId('fly-dial');
  await expect(dial).toHaveAttribute('data-met', '15');
  await expect(dial).toHaveAttribute('data-total', '16');
  await expect(dial).toHaveAttribute('data-tone', 'bad');
  await expect(dial).toHaveAttribute('role', 'img');
  await expect(dial).toHaveAttribute('aria-label', '15 of 16 checks met');
  await expect(dial.getByTestId('dial-count')).toHaveText('15');
  await expect(dial.locator('.dial-seg')).toHaveCount(16);
  await expect(dial.locator('.dial-seg-pass')).toHaveCount(15);
  // The one that is not met is drawn further out than the ring: shape, not colour alone.
  await expect(dial.locator('.dial-seg-fail')).toHaveCount(1);
  const [failing] = await styles(page, `${DIAL} .dial-seg-fail`, ['--s']);
  expect(Number(failing![0])).toBeGreaterThan(1.05);
  const [passing] = await styles(page, `${DIAL} .dial-seg-pass`, ['--s']);
  expect(Number(passing![0])).toBe(1);
  // The numbers do not shift as they change.
  const [centre] = await styles(page, `${DIAL} .dial-centre`, ['font-variant-numeric']);
  expect(centre![0]).toContain('tabular-nums');
  await shot('not-ready');

  // The pedals are plugged in: the same screen becomes Ready, with nothing reloading.
  await mutate([{ op: 'plugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(dial).toHaveAttribute('data-met', '16');
  await expect(dial).toHaveAttribute('data-tone', 'ok');
  await expect(dial).toHaveAttribute('aria-label', '16 of 16 checks met');
  await expect(dial.locator('.dial-seg-fail')).toHaveCount(0);
  await expect(dial.locator('.dial-seg-pass')).toHaveCount(16);
  // One short transition, eased out: nothing bounces, nothing loops.
  const [segment] = await styles(page, `${DIAL} .dial-seg`, [
    'transition-duration',
    'transition-timing-function',
    'animation-name',
  ]);
  expect(segment![0]!.split(', ').every((d) => parseFloat(d) <= 0.2)).toBe(true);
  expect(segment![1]).toContain('ease-out');
  expect(segment![2]).toBe('none');
  await shot('ready');
});

test('hero: the dial moves while checks run, rows arrive one after another, and none of it moves under reduced motion', async ({
  rig,
}) => {
  const { page, shot, mutate } = await rig.launch(
    'flying-trackir-not-running',
    'fly-hero-checking'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');

  // The rows of the open group arrive staggered: each a little after the one above.
  const rows = await styles(page, '[data-testid="group-apps"] [data-testid="check-row"]', [
    'animation-name',
    'animation-delay',
  ]);
  expect(rows).toHaveLength(3);
  expect(rows.every(([animation]) => animation!.startsWith('check-arrive'))).toBe(true);
  const delays = rows.map(([, delay]) => parseFloat(delay!));
  expect(delays[0]).toBe(0);
  expect(delays[1]).toBeGreaterThan(delays[0]!);
  expect(delays[2]).toBeGreaterThan(delays[1]!);
  // Short: the last row starts well within a sixth of a second.
  expect(delays[2]!).toBeLessThan(0.15);

  // The list of running programs stops answering: those three checks stay open.
  await mutate([{ op: 'hangProvider', port: 'processes' }]);
  await page.getByTestId('recheck').click();
  const dial = page.getByTestId('fly-dial');
  await expect(dial).toHaveClass(/dial-checking/);
  await expect(dial.locator('.dial-seg-pending')).toHaveCount(3);
  await expect(dial).toHaveAttribute('aria-label', /still checking$/);
  // The segments still waiting are the ones that move, one after another round the ring.
  const waiting = await styles(page, `${DIAL} .dial-seg-pending`, [
    'animation-name',
    'animation-iteration-count',
    'animation-delay',
  ]);
  expect(waiting.every(([animation]) => animation!.startsWith('dial-wait'))).toBe(true);
  expect(waiting.every(([, count]) => count === 'infinite')).toBe(true);
  expect(new Set(waiting.map(([, , delay]) => delay)).size).toBe(3);
  const lit = await styles(page, `${DIAL} .dial-seg-pass`, ['animation-name']);
  expect(lit.length).toBeGreaterThan(10);
  expect(lit.every(([animation]) => animation === 'none')).toBe(true);
  // The screen stays useful meanwhile: what is known is shown.
  await expect(checkRow(page, 'TrackIR5')).toBeVisible();
  await shot('checking');

  // Reduced motion: the same information, nothing moving.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await styles(page, `${DIAL} .dial-seg-pending, [data-testid="check-row"]`, [
    'animation-name',
  ]);
  expect(still.length).toBeGreaterThan(3);
  expect(still.every(([animation]) => animation === 'none')).toBe(true);
  const [calm] = await styles(page, `${DIAL} .dial-seg`, ['transition-duration']);
  expect(calm![0]).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // The programs answer again. The checks that were waiting give up on their own, and
  // the next run ends as it began: one item not met, nothing stuck.
  await mutate([{ op: 'hangProvider', port: 'processes', hang: false }]);
  await expect(dial).not.toHaveClass(/dial-checking/, { timeout: 15_000 });
  await page.getByTestId('recheck').click();
  await expect(dial).toHaveAttribute('data-met', '15');
  await expect(dial.locator('.dial-seg-pending')).toHaveCount(0);
});
