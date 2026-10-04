import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test } from './harness';

/**
 * The ready tone: off until it is switched on in the Fly menu, then two quiet notes, made
 * on the spot, when the rig becomes ready.
 */

interface Heard {
  /** Notes started (one oscillator each). */
  notes: number;
  /** The pitch of each, in hertz. */
  pitches: number[];
  /** The loudest any note was asked to be (1 is full volume). */
  peak: number;
  /** How many of them were sent to the speakers. */
  toSpeakers: number;
  /** Whether the sound system was running when the last one was made. */
  state: string;
}

/**
 * Listens in on Web Audio. What the page asks for is written down and not passed on to the
 * speakers: the tests make no sound on the machine they run on.
 */
const listen = (page: Page): Promise<void> =>
  page.evaluate(`(() => {
    const heard = { notes: 0, pitches: [], peak: 0, toSpeakers: 0, state: 'none' };
    window.__heard = heard;
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this);
      heard.notes += 1;
      heard.state = this.state;
      const setValueAtTime = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      oscillator.frequency.setValueAtTime = (value, time) => {
        heard.pitches.push(value);
        return setValueAtTime(value, time);
      };
      return oscillator;
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this);
      const ramp = gain.gain.linearRampToValueAtTime.bind(gain.gain);
      gain.gain.linearRampToValueAtTime = (value, time) => {
        heard.peak = Math.max(heard.peak, value);
        return ramp(value, time);
      };
      const destination = this.destination;
      const connect = gain.connect.bind(gain);
      gain.connect = (target, ...rest) => {
        if (target === destination) {
          heard.toSpeakers += 1;
          return target;
        }
        return connect(target, ...rest);
      };
      return gain;
    };
  })()`);

const heard = (page: Page): Promise<Heard> => page.evaluate('window.__heard') as Promise<Heard>;

const PEDALS = { vendorId: '044F', productId: 'B68F' };

test('ready tone: silent until switched on in the Fly menu; then two quiet notes each time the rig becomes ready', async ({
  rig,
}) => {
  const { page, mutate, restart, shot } = await rig.launch('flying-pedals-unplugged', 'fly-tone');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await listen(page);

  // Off as installed: the rig becomes ready without a sound.
  await mutate([{ op: 'plugDevice', match: PEDALS }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  expect((await heard(page)).notes).toBe(0);

  // Switched on: it is played once, so the user knows what was switched on.
  await page.getByTestId('fly-more').click();
  const setting = page.getByTestId('fly-ready-tone');
  await expect(setting).toContainText('Ready tone');
  await expect(setting).toContainText('Two quiet notes when the rig becomes ready');
  await expect(setting.locator('.mdi-checkbox-blank-outline')).toBeVisible();
  await shot('the-setting');
  await setting.click();
  await expect(setting.locator('.mdi-checkbox-marked-outline')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(setting).toBeHidden();
  await expect.poll(async () => (await heard(page)).notes).toBe(2);
  const sample = await heard(page);
  // A rising fifth, E5 then B5; quiet; and the sound system was running for it.
  expect(sample.pitches).toEqual([659.25, 987.77]);
  expect(sample.peak).toBeGreaterThan(0);
  expect(sample.peak).toBeLessThanOrEqual(0.1);
  expect(sample.toSpeakers).toBe(2);
  expect(sample.state).toBe('running');
  await expect(page.getByTestId('fly-tone-note')).toHaveCount(0);

  // Not ready is silent, and so is staying ready; becoming ready is the tone.
  await mutate([{ op: 'unplugDevice', match: PEDALS }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  expect((await heard(page)).notes).toBe(2);
  await mutate([{ op: 'plugDevice', match: PEDALS }]);
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect.poll(async () => (await heard(page)).notes).toBe(4);
  await page.getByTestId('recheck').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  expect((await heard(page)).notes).toBe(4);

  // The choice is kept: after a restart (the pedals are unplugged again) it is still on.
  const again = await restart();
  const next = again.page;
  await expect(next.getByTestId('fly-status-title')).toHaveText('Not ready');
  await listen(next);
  await again.mutate([{ op: 'plugDevice', match: PEDALS }]);
  await expect(next.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect.poll(async () => (await heard(next)).notes).toBe(2);

  // Switched off, it is silent again, and switching it off makes no sound either.
  await next.getByTestId('fly-more').click();
  const kept = next.getByTestId('fly-ready-tone');
  await expect(kept.locator('.mdi-checkbox-marked-outline')).toBeVisible();
  await kept.click();
  await expect(kept.locator('.mdi-checkbox-blank-outline')).toBeVisible();
  await next.keyboard.press('Escape');
  await expect(kept).toBeHidden();
  await again.mutate([{ op: 'unplugDevice', match: PEDALS }]);
  await expect(next.getByTestId('fly-status-title')).toHaveText('Not ready');
  await again.mutate([{ op: 'plugDevice', match: PEDALS }]);
  await expect(next.getByTestId('fly-status-title')).toHaveText('Ready');
  expect((await heard(next)).notes).toBe(2);
});

test('ready tone: on a PC whose sound system does not start, the Fly screen says the tone could not be played', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-all-good', 'fly-tone-no-sound');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  // A PC with no sound system: asking for one fails.
  await page.evaluate(`(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error('No audio output device was found.');
      }
    };
  })()`);
  await page.getByTestId('fly-more').click();
  const setting = page.getByTestId('fly-ready-tone');
  await setting.click();
  await expect(setting.locator('.mdi-checkbox-marked-outline')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(setting).toBeHidden();
  // The choice is kept as made, and what did not happen is said.
  const note = page.getByTestId('fly-tone-note');
  await expect(note).toContainText(
    'The ready tone could not be played: No audio output device was found.'
  );
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('could-not-be-played');
  // Switched off again, there is nothing left to say.
  await page.getByTestId('fly-more').click();
  await setting.click();
  await expect(setting.locator('.mdi-checkbox-blank-outline')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);
});
