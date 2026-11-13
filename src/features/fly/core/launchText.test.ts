import { describe, expect, it } from 'vitest';
import {
  planLine,
  planLines,
  planShown,
  startingNotice,
  stepName,
  type PlannedStep,
} from './launchText';

const step = (title: string, phase: PlannedStep['phase'], choice?: string): PlannedStep => ({
  title,
  phase,
  ...(choice !== undefined ? { choice } : {}),
});

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

  it('names what a step was set to, and does not say it twice', () => {
    expect(
      planLine(
        [
          step('Start a virtual controller', 'preLaunch', 'My Ace Combat stick'),
          step('Start VoiceAttack', 'preLaunch'),
        ],
        'preLaunch'
      )
    ).toBe('Before launch: Start a virtual controller: My Ace Combat stick, Start VoiceAttack');
    // The person named the step after what it starts: once is enough.
    expect(stepName({ title: 'Start my ace combat stick', choice: 'My Ace Combat stick' })).toBe(
      'Start my ace combat stick'
    );
    expect(stepName({ title: ' Start a virtual controller ', choice: '  ' })).toBe(
      'Start a virtual controller'
    );
    // A choice does not make a step out of an empty title.
    expect(planLine([step(' ', 'preLaunch', 'My Ace Combat stick')], 'preLaunch')).toBeUndefined();
  });

  it("is not shown while the setup's game is starting or running, and is back once it has closed", () => {
    const steps = [step('Start a virtual controller', 'preLaunch', 'My Ace Combat stick')];
    const setup = { id: 'ace-nights', canLaunch: true };
    const lines = [
      {
        phase: 'preLaunch',
        text: 'Before launch: Start a virtual controller: My Ace Combat stick',
      },
    ];
    expect(planShown(steps, setup, { phase: 'idle' })).toEqual(lines);
    expect(planShown(steps, setup, { phase: 'starting', profileId: 'ace-nights' })).toEqual([]);
    expect(planShown(steps, setup, { phase: 'running', profileId: 'ace-nights' })).toEqual([]);
    expect(planShown(steps, setup, { phase: 'ended', profileId: 'ace-nights' })).toEqual(lines);
    // Another setup's game is running: this setup's Launch is still what its button does.
    expect(planShown(steps, setup, { phase: 'running', profileId: 'dcs-f-a-18c' })).toEqual(lines);
    // Nothing to launch, nothing to say.
    expect(planShown(steps, { id: 'ace-nights', canLaunch: false }, { phase: 'idle' })).toEqual([]);
    expect(planShown(steps, undefined, { phase: 'idle' })).toEqual([]);
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
