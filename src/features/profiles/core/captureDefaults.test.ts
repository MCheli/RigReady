import { describe, expect, it } from 'vitest';
import { playedWith } from '../../../core/gearKind';
import type { CaptureStep } from '../contract';
import {
  choiceFor,
  gearOf,
  keptByDefault,
  offered,
  stepAction,
  stepDefault,
  stepsFor,
  type CaptureChoice,
} from './captureDefaults';

const device = (model: string, extra: Record<string, unknown> = {}) => ({
  selectedByDefault: true,
  group: 'devices',
  title: model,
  device: { model },
  ...extra,
});
const helper = (title: string, extra: Record<string, unknown> = {}) => ({
  selectedByDefault: true,
  group: 'apps',
  title,
  ...extra,
});
const microphone = {
  selectedByDefault: true,
  group: 'audio',
  title: 'Microphone',
  check: { type: 'audio.defaultDevice', params: { flow: 'recording' } },
};

const racing: CaptureChoice = { game: 'iracing', variant: '', family: 'racing' };
const flight: CaptureChoice = { game: 'dcs', variant: '', family: 'flight' };
const gamepadGame: CaptureChoice = {
  game: 'ace-combat-8',
  variant: '',
  family: 'flight',
  uses: playedWith({
    kind: 'flight',
    playedWith: {
      gear: ['stick', 'yoke', 'throttle', 'pedals'],
      helpers: false,
      microphone: false,
      gamepad: true,
    },
  }),
};

describe('CFG-PROFILE-017: a new setup starts from the game', () => {
  it('tells the gear a device is, or a program is for, from its name', () => {
    expect(gearOf(device('WINWING Orion Throttle Base II'))).toBe('throttle');
    expect(gearOf(helper('TrackIR software'))).toBe('tracker');
    expect(gearOf(helper('Stream Deck app'))).toBe('deck');
    expect(gearOf(helper('SimHub'))).toBeUndefined();
    expect(gearOf(device('Keychron K2 Pro Keyboard'))).toBeUndefined();
    expect(gearOf({})).toBeUndefined();
  });

  it('a racing game keeps the wheel and pedals; flight gear is offered and not ticked', () => {
    expect(keptByDefault(device('FANATEC ClubSport Wheel Base DD+'), racing)).toBe(true);
    expect(keptByDefault(device('ClubSport Pedals V3'), racing)).toBe(true);
    expect(keptByDefault(device('WINWING Orion Throttle Base II'), racing)).toBe(false);
    expect(keptByDefault(device('VKB Gladiator NXT'), racing)).toBe(false);
    // Offered all the same: nothing found on the rig is hidden for being the wrong kind.
    expect(offered({ ...device('WINWING Orion Throttle Base II'), game: undefined }, racing)).toBe(
      true
    );
    expect(offered({ game: 'dcs' }, racing)).toBe(false);
  });

  it('a flight sim keeps the stick and the head tracker, and no wheel', () => {
    expect(keptByDefault(device('VKB Gladiator NXT'), flight)).toBe(true);
    expect(keptByDefault(device('TrackIR 5'), flight)).toBe(true);
    expect(keptByDefault(device('FANATEC ClubSport Wheel Base DD+'), flight)).toBe(false);
    expect(keptByDefault(device('ClubSport Shifter SQ'), flight)).toBe(false);
  });

  it('a helper is not kept merely because it is running: TrackIR software for a racing game', () => {
    expect(keptByDefault(helper('TrackIR software'), racing)).toBe(false);
    expect(keptByDefault(helper('TrackIR software'), flight)).toBe(true);
    // A helper about no particular gear is kept, and so is the deck a racing rig uses.
    expect(keptByDefault(helper('SimHub'), racing)).toBe(true);
    expect(keptByDefault(helper('Stream Deck app'), racing)).toBe(true);
  });

  it('a game played without helpers or a radio keeps neither, and still keeps its gear', () => {
    expect(keptByDefault(helper('VoiceAttack'), gamepadGame)).toBe(false);
    expect(keptByDefault(helper('TrackIR software'), gamepadGame)).toBe(false);
    expect(keptByDefault(microphone, gamepadGame)).toBe(false);
    expect(keptByDefault(microphone, flight)).toBe(true);
    expect(keptByDefault(device('VKB Gladiator NXT'), gamepadGame)).toBe(true);
    expect(keptByDefault(device('TrackIR 5'), gamepadGame)).toBe(false);
    expect(keptByDefault(device('WINWING MFD1-L'), gamepadGame)).toBe(false);
  });

  it('gear nobody can tell from its name is kept; what the rig did not propose never is', () => {
    expect(keptByDefault(device('Acme Mk II'), racing)).toBe(true);
    expect(keptByDefault(device('ClubSport Pedals V3', { selectedByDefault: false }), racing)).toBe(
      false
    );
    // What belongs to another game is not offered, so it is not kept either.
    expect(keptByDefault(device('ClubSport Pedals V3', { game: 'dcs' }), racing)).toBe(false);
    // A check marked for the other family (a flight-only check) is left out of a racing setup.
    expect(keptByDefault({ selectedByDefault: true, kind: 'flight' }, racing)).toBe(false);
    // Other sections (monitors, files) are not about gear: what the rig proposes stays.
    expect(keptByDefault({ selectedByDefault: true, group: 'displays' }, gamepadGame)).toBe(true);
  });

  it('with no game chosen, nothing is ruled out beyond what the rig proposes', () => {
    const none: CaptureChoice = { game: '', variant: '' };
    expect(keptByDefault(device('FANATEC ClubSport Wheel Base DD+'), none)).toBe(true);
    expect(keptByDefault(device('VKB Gladiator NXT'), none)).toBe(true);
    expect(keptByDefault(helper('TrackIR software'), none)).toBe(true);
  });

  it('the choice for a game carries its family and what its module says', () => {
    const captured = {
      games: [
        { id: 'ace-combat-8', kind: 'flight' as const, uses: gamepadGame.uses },
        { id: 'iracing', kind: 'racing' as const },
      ],
      suggested: { kind: 'flight' as const },
    };
    expect(choiceFor(captured, 'ace-combat-8')).toEqual({
      game: 'ace-combat-8',
      variant: '',
      family: 'flight',
      uses: gamepadGame.uses,
    });
    // A game that says nothing is played with what its kind usually uses.
    const iracing = choiceFor(captured, 'iracing', 'mx5');
    expect(iracing).toMatchObject({ game: 'iracing', variant: 'mx5', family: 'racing' });
    expect(iracing.uses?.gear).toContain('wheel');
    // A game RigReady does not know goes by the gear that is connected.
    expect(choiceFor(captured, 'other')).toMatchObject({ family: 'flight' });
    expect(choiceFor({ games: [], suggested: {} }, '').uses).toEqual({
      helpers: true,
      microphone: true,
      gamepad: false,
    });
  });
});

const step = (choices: CaptureStep['picker']['choices']): CaptureStep => ({
  need: 'gamepad',
  type: 'virtual-controller.start',
  label: 'Start a virtual controller',
  picker: {
    list: 'virtual-controller.profiles',
    param: 'profile',
    label: 'Virtual controller',
    fills: ['profileName'],
    empty: 'None yet.',
    choices,
  },
});
const stickPad = { value: 'my-stick', label: 'My stick', fill: { profileName: 'My stick' } };
const wheelPad = { value: 'my-wheel', label: 'My wheel', fill: { profileName: 'My wheel' } };

describe('CFG-PROFILE-018: the step a gamepad game needs', () => {
  it('is offered only for a game that reads a gamepad', () => {
    const steps = [step([stickPad])];
    expect(stepsFor(steps, gamepadGame)).toEqual(steps);
    expect(stepsFor(steps, flight)).toEqual([]);
    expect(stepsFor(steps, racing)).toEqual([]);
    expect(stepsFor(steps, { game: '', variant: '' })).toEqual([]);
  });

  it('starts with the one in use now, else the only one, and never guesses between two', () => {
    expect(stepDefault(step([stickPad]))).toBe('my-stick');
    expect(stepDefault(step([stickPad, { ...wheelPad, current: true }]))).toBe('my-wheel');
    expect(stepDefault(step([stickPad, wheelPad]))).toBeUndefined();
    expect(stepDefault(step([]))).toBeUndefined();
  });

  it('goes into the setup as a step before launch that carries the name with the id, and stops the launch when it fails', () => {
    expect(stepAction(step([stickPad, wheelPad]), 'my-wheel', 'a1')).toEqual({
      id: 'a1',
      title: 'Start a virtual controller',
      type: 'virtual-controller.start',
      params: { profile: 'my-wheel', profileName: 'My wheel' },
      continueOnError: false,
      delaySeconds: 0,
    });
    // Nothing chosen, or something that is not in the list: no step, rather than a broken one.
    expect(stepAction(step([stickPad]), undefined, 'a1')).toBeUndefined();
    expect(stepAction(step([stickPad]), 'gone', 'a1')).toBeUndefined();
  });
});

describe('DEV-017: what the user said a device is, in a new setup', () => {
  const said = (kind: string, extra: Record<string, unknown> = {}) =>
    device('Arduino Leonardo', { device: { saidKind: kind }, ...extra });

  it('the kind the user said comes before the kind the name says', () => {
    expect(gearOf(device('Arduino Leonardo'))).toBeUndefined();
    expect(gearOf(said('wheel'))).toBe('wheel');
    expect(gearOf(said('tracker'))).toBe('tracker');
    // The name says wheel; the user says it is not sim gear at all.
    const base = 'FANATEC Podium Wheel Base DD2';
    expect(gearOf(device(base))).toBe('wheel');
    expect(gearOf(device(base, { device: { model: base, saidKind: 'mouse' } }))).toBeUndefined();
    expect(gearOf(device(base, { device: { model: base, saidKind: 'other' } }))).toBeUndefined();
  });

  it('a device said to be a wheel is kept for a racing sim and left unticked for a flight sim', () => {
    // Nothing said: gear nobody can tell is kept for either.
    expect(keptByDefault(device('Arduino Leonardo'), racing)).toBe(true);
    expect(keptByDefault(device('Arduino Leonardo'), flight)).toBe(true);
    expect(keptByDefault(said('wheel'), racing)).toBe(true);
    expect(keptByDefault(said('wheel'), flight)).toBe(false);
    expect(keptByDefault(said('stick'), flight)).toBe(true);
    expect(keptByDefault(said('stick'), racing)).toBe(false);
    // What it is used for narrows it further: a panel suits both, this one is for racing.
    expect(keptByDefault(said('panel'), flight)).toBe(true);
    expect(keptByDefault(said('panel', { kind: 'racing' }), flight)).toBe(false);
    expect(keptByDefault(said('panel', { kind: 'racing' }), racing)).toBe(true);
    // It stays offered either way: the user can tick it.
    expect(offered({ ...said('wheel'), game: undefined }, flight)).toBe(true);
  });
});
