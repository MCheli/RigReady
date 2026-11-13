import { describe, expect, it } from 'vitest';
import { planLine, planLines, startingNotice, type PlannedStep } from './launchText';

const step = (title: string, phase: PlannedStep['phase']): PlannedStep => ({ title, phase });

describe('FLY-029: what Launch will do, said before the click', () => {
  it('names the steps before launch in the order they run', () => {
    expect(planLine([step('Start a virtual controller', 'preLaunch')], 'preLaunch')).toBe(
      'Before launch: Start a virtual controller'
    );
    expect(
      planLine(
        [
          step('Start a virtual controller', 'preLaunch'),
          step('Start SRS', 'postLaunch'),
          step('Start VoiceAttack', 'preLaunch'),
        ],
        'preLaunch'
      )
    ).toBe('Before launch: Start a virtual controller, Start VoiceAttack');
  });

  it('names three and counts the rest', () => {
    const many = ['One', 'Two', 'Three', 'Four', 'Five'].map((t) => step(t, 'preLaunch'));
    expect(planLine(many, 'preLaunch')).toBe('Before launch: One, Two, Three and 2 more');
    expect(planLine(many.slice(0, 3), 'preLaunch')).toBe('Before launch: One, Two, Three');
  });

  it('says nothing for a phase without a step, and never counts a step of Stand down', () => {
    expect(planLine([], 'preLaunch')).toBeUndefined();
    expect(planLine([step('Close SRS', 'standDown')], 'preLaunch')).toBeUndefined();
    expect(planLine([step('  ', 'preLaunch')], 'preLaunch')).toBeUndefined();
    expect(planLines([step('Close SRS', 'standDown')])).toEqual([]);
  });

  it('gives a line for each side of the game that has a step', () => {
    expect(
      planLines([
        step('Start SRS', 'postLaunch'),
        step('Start a virtual controller', 'preLaunch'),
        step('Close SRS', 'standDown'),
      ])
    ).toEqual([
      { phase: 'preLaunch', text: 'Before launch: Start a virtual controller' },
      { phase: 'postLaunch', text: 'After launch: Start SRS' },
    ]);
  });
});

describe('FLY-030: the line for the moment before the game shows', () => {
  it('names the game it was given, and says why nothing shows yet', () => {
    expect(startingNotice('DCS World', false)).toEqual({
      title: 'Starting DCS World',
      body: 'It can take a minute to show. RigReady is out of the way while you play.',
    });
    expect(startingNotice('iRacing', true)).toEqual({
      title: 'Starting iRacing',
      body: 'Steam is opening it, which can take a minute. RigReady is out of the way while you play.',
    });
  });
});
