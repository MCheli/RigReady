import type { Page } from '@playwright/test';
import { checkRow, expect, test } from './harness';

/** Default audio devices: the Fly check and fix, the Audio page, and capture. */

const device = (page: Page, name: string) =>
  page.locator(`[data-testid="audio-device"][data-name="${name}"]`);

const HEADPHONES = 'Headphones (Arctis Pro Wireless Game)';
const SPEAKERS = 'Speakers (Realtek(R) Audio)';

test('audio: speakers are the default, Make ready sets the headset, Stand down puts the speakers back', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('audio-default-speakers', 'audio-default-speakers');
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  const output = checkRow(page, 'Headset is default output');
  await expect(output).toHaveAttribute('data-status', 'fail');
  await expect(output).toContainText(`Default is ${SPEAKERS}`);
  await expect(output.getByTestId('check-fix')).toContainText(
    `Make ${HEADPHONES} the default output`
  );
  await shot('wrong-default');

  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('fly-activity')).toContainText(
    `Made ${HEADPHONES} the default output`
  );
  await shot('fixed');

  // The Audio page shows the same thing.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-audio').click();
  await expect(device(page, HEADPHONES)).toHaveAttribute('data-default', 'true');
  await expect(device(page, SPEAKERS)).toHaveAttribute('data-default', 'false');
  await expect(page.getByTestId('audio-recording').getByTestId('audio-device')).toHaveCount(2);
  await shot('audio-page');

  await page.getByTestId('mode-fly').click();
  await page.getByTestId('stand-down').click();
  await expect(page.getByTestId('fly-activity')).toContainText(`${SPEAKERS} is the default again`);
  await expect(output).toHaveAttribute('data-status', 'fail');
  await shot('stood-down');
});

test('audio: another microphone is the default input; the check names it', async ({ rig }) => {
  const { page, shot } = await rig.launch('audio-mic-wrong', 'audio-mic-wrong');
  const input = checkRow(page, 'Headset mic is default input');
  await expect(input).toHaveAttribute('data-status', 'fail');
  await expect(input).toContainText('Default is Microphone (Steam Streaming Microphone)');
  await shot('wrong-mic');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-status-title')).toHaveText('Ready');
  await expect(page.getByTestId('group-audio')).toContainText('2 of 2 OK');
});

test('audio: headset unplugged — the check says so and Make ready explains it cannot help', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('audio-headset-unplugged', 'audio-headset-unplugged');
  const output = checkRow(page, 'Headset is default output');
  await expect(output).toHaveAttribute('data-status', 'fail');
  await expect(output).toContainText(`${HEADPHONES} is not connected`);
  await expect(output).toContainText('Windows is using Realtek Digital Output');
  await page.getByTestId('make-ready').click();
  await expect(page.getByTestId('fly-activity')).toContainText(
    'is not connected, so it cannot be made the default'
  );
  await expect(page.getByTestId('fly-status-title')).toHaveText('Not ready');
  await shot('unplugged');

  // The Audio page lists only what is connected.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-audio').click();
  await expect(device(page, HEADPHONES)).toHaveCount(0);
  await expect(page.getByTestId('audio-playback').getByTestId('audio-device')).toHaveCount(7);
  await shot('audio-page-without-headset');
});

test('audio page: make a device the default and the calls device, verified by reading back', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('flying-fresh', 'audio-page');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-audio').click();
  await expect(device(page, SPEAKERS)).toHaveAttribute('data-default', 'true');
  await expect(
    device(page, 'DELL G3223D (NVIDIA High Definition Audio)').getByTestId('audio-badge-calls')
  ).toBeVisible();
  await shot('as-recorded');
  await device(page, HEADPHONES).getByTestId('audio-make-default').click();
  await expect(page.getByTestId('audio-notice')).toHaveText(
    `${HEADPHONES} is now the default output`
  );
  await expect(device(page, HEADPHONES)).toHaveAttribute('data-default', 'true');
  await device(page, HEADPHONES).getByTestId('audio-use-for-calls').click();
  await expect(page.getByTestId('audio-notice')).toHaveText(
    `${HEADPHONES} is now the default for calls`
  );
  await expect(device(page, HEADPHONES)).toHaveAttribute('data-communications', 'true');
  await expect(device(page, HEADPHONES).getByTestId('audio-make-default')).toHaveCount(0);
  await shot('changed');
});

test('capture: the current default devices are offered as audio checks', async ({ rig }) => {
  const { page, shot } = await rig.launch('flying-fresh', 'audio-capture');
  await page.getByTestId('fly-create').click();
  const audio = page.getByTestId('capture-page').getByTestId('capture-group-audio');
  await expect(audio).toContainText(`Sound output: ${SPEAKERS}`);
  await expect(audio).toContainText('Microphone: Headset Microphone (Arctis Pro Wireless Chat)');
  await expect(audio).toContainText('Sound output for calls: DELL G3223D');
  await audio.scrollIntoViewIfNeeded();
  await shot('capture');
});
