import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../../../tests/helpers';
import { parseControlsFile } from './controlsFile';
import { iracingActionGroup, iracingActionLabel, iracingKeyLabel } from './names';

describe('names of iRacing actions', () => {
  it('names the common actions in plain words', () => {
    expect(iracingActionLabel('Throttle')).toBe('Throttle');
    expect(iracingActionLabel('PitSpeedLimiter')).toBe('Pit speed limiter');
    expect(iracingActionLabel('Reset')).toBe('Reset car');
    expect(iracingActionLabel('ToggleirsdkDiskLogging')).toBe('Telemetry logging');
  });

  it('spells the rest out from the id', () => {
    expect(iracingActionLabel('BrakeBiasInc')).toBe('Brake bias up');
    expect(iracingActionLabel('BrakeBiasFineDec')).toBe('Brake bias fine down');
    expect(iracingActionLabel('BrakeBiasLevel')).toBe('Brake bias (axis)');
    expect(iracingActionLabel('MGUKDeployModeInc')).toBe('MGU-K deploy mode up');
    expect(iracingActionLabel('RpyPausePlay')).toBe('Replay pause play');
    expect(iracingActionLabel('CamFOVInc')).toBe('Camera field of view up');
    expect(iracingActionLabel('DCamFOVDec')).toBe('Driver camera field of view down');
    expect(iracingActionLabel('ScaleUIUp')).toBe('Scale UI up');
  });

  it('names second bindings, gears, chat macros and black boxes by number', () => {
    expect(iracingActionLabel('Throttle2')).toBe('Throttle (second binding)');
    expect(iracingActionLabel('ShiftUp2')).toBe('Shift up (second binding)');
    expect(iracingActionLabel('Gear7')).toBe('Gear 7');
    expect(iracingActionLabel('AutoChat12')).toBe('Chat macro 12');
    expect(iracingActionLabel('BlackBoxF3')).toBe('Black box 3');
    // A "2" that is part of the name is not a second binding.
    expect(iracingActionLabel('TractionControl2Inc')).toBe('Traction control 2 up');
  });

  it('puts every action in one of four groups', () => {
    expect(iracingActionGroup('Throttle')).toBe('Driving');
    expect(iracingActionGroup('ToggleWindshieldWipers')).toBe('Driving');
    expect(iracingActionGroup('BrakeBiasInc')).toBe('In-car adjustments');
    expect(iracingActionGroup('ABSToggle')).toBe('In-car adjustments');
    expect(iracingActionGroup('CamFOVInc')).toBe('Cameras and replay');
    expect(iracingActionGroup('RpyPausePlay')).toBe('Cameras and replay');
    expect(iracingActionGroup('NextDrivingCam')).toBe('Cameras and replay');
    expect(iracingActionGroup('TChatInitiate')).toBe('Interface and chat');
    expect(iracingActionGroup('BlackBoxInc')).toBe('Interface and chat');
    expect(iracingActionGroup('VChatVolumeUp')).toBe('Interface and chat');
  });

  it('gives every action of the recorded file a name that reads as words', async () => {
    const bytes = await fs.readFile(
      path.join(fixturesDir, 'rigs', 'mark-full', 'files', 'Documents', 'iRacing', 'controls.cfg')
    );
    const file = parseControlsFile(new Uint8Array(bytes));
    if (!file.ok) throw new Error(file.error.message);
    const names = new Map<string, string>();
    for (const record of file.value.records) {
      const name = iracingActionLabel(record.action);
      expect(name.length, record.action).toBeGreaterThan(1);
      // Starts with a capital or a digit, and no two actions share a name.
      expect(name, record.action).toMatch(/^[A-Z0-9]/);
      expect(names.get(name), `${record.action} and ${names.get(name)}`).toBeUndefined();
      names.set(name, record.action);
    }
    expect(names.size).toBe(367);
  });
});

describe('names of iRacing keys', () => {
  it('names letters, digits, function keys and the number pad', () => {
    expect(iracingKeyLabel(73, 0)).toBe('I');
    expect(iracingKeyLabel(49, 0)).toBe('1');
    expect(iracingKeyLabel(197, 0)).toBe('F1');
    expect(iracingKeyLabel(208, 0)).toBe('F12');
    expect(iracingKeyLabel(12, 0)).toBe('Num 5');
    expect(iracingKeyLabel(32, 0)).toBe('Space');
  });

  it('names punctuation by iRacing’s own codes', () => {
    expect(iracingKeyLabel(118, 0)).toBe('[');
    expect(iracingKeyLabel(120, 0)).toBe(']');
    expect(iracingKeyLabel(108, 0)).toBe('-');
    expect(iracingKeyLabel(114, 0)).toBe('=');
    expect(iracingKeyLabel(128, 0)).toBe('¡');
  });

  it('puts Ctrl, Alt and Shift in front, each from its two bits', () => {
    expect(iracingKeyLabel(76, 0x30)).toBe('Alt+L');
    expect(iracingKeyLabel(82, 0x0c)).toBe('Ctrl+R');
    expect(iracingKeyLabel(33, 0x0c)).toBe('Ctrl+Page Up');
    expect(iracingKeyLabel(120, 0x03)).toBe('Shift+]');
    // One bit of a pair is enough: the left or the right key.
    expect(iracingKeyLabel(65, 0x04)).toBe('Ctrl+A');
    expect(iracingKeyLabel(65, 0x3f)).toBe('Ctrl+Alt+Shift+A');
  });

  it('shows a code it does not know as its number', () => {
    expect(iracingKeyLabel(250, 0)).toBe('Key 250');
    expect(iracingKeyLabel(7, 0)).toBe('Key 7');
  });
});
