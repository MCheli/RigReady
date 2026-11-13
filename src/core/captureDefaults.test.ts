import { describe, expect, it } from 'vitest';
import {
  choiceFor,
  gearOf,
  keptByDefault,
  offered,
  proposedSetup,
  stepAction,
  stepChecks,
  stepDefault,
  stepsFor,
  variantsOf,
  type CaptureChoice,
  type ProposedCheck,
  type StepOffer,
} from './captureDefaults';
import { playedWith } from './gearKind';

const device = (model: string, extra: Record<string, unknown> = {}) => ({
  selectedByDefault: true,
  group: 'devices',
  title: model,
  device: { model },
  ...extra,
});
const helper = (
  title: string,
  extra: Record<string, unknown> = {}
): Parameters<typeof keptByDefault>[0] => ({
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

  it('a helper made for one game is kept for that game only, and stays offered for any other', () => {
    const srs = helper('DCS-SRS', { kind: 'flight', forGames: ['dcs'] });
    const otherSim: CaptureChoice = { game: 'msfs2024', variant: '', family: 'flight' };
    expect(keptByDefault(srs, flight)).toBe(true);
    expect(keptByDefault(srs, otherSim)).toBe(false);
    expect(keptByDefault(srs, { game: 'other', variant: '', family: 'flight' })).toBe(false);
    // Listed all the same: it was found running, and the person may want it anyway.
    expect(offered(srs, otherSim)).toBe(true);
    // With no game chosen nothing says it does not fit.
    expect(keptByDefault(srs, { game: '', variant: '', family: 'flight' })).toBe(true);
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

const driver: ProposedCheck = {
  type: 'virtual-controller.driver',
  title: 'Virtual controller driver installed',
  required: true,
  params: {},
  remediation: { type: 'virtual-controller.installDriver', params: {} },
};
const step = (choices: StepOffer['picker']['choices'], checks = [driver]): StepOffer => ({
  need: 'gamepad',
  type: 'virtual-controller.start',
  label: 'Start a virtual controller',
  picker: { param: 'profile', choices },
  checks,
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

  it('a kept step brings the check it cannot work without, until the person leaves it out', () => {
    const kept = [step([stickPad])];
    expect(stepChecks(kept)).toEqual([driver]);
    expect(stepChecks(kept, new Set([driver.type]))).toEqual([]);
    // No step kept, no check. A step that needs nothing brings nothing.
    expect(stepChecks([])).toEqual([]);
    expect(stepChecks([step([stickPad], [])])).toEqual([]);
    expect(stepChecks([{ ...step([stickPad]), checks: undefined }])).toEqual([]);
    // Never twice: not for two steps that need the same, not when the setup keeps it already.
    expect(stepChecks([step([stickPad]), step([wheelPad])])).toEqual([driver]);
    expect(stepChecks(kept, new Set(), [{ type: driver.type, params: {} }])).toEqual([]);
    expect(stepChecks(kept, new Set(), [{ type: driver.type, params: { other: 1 } }])).toEqual([
      driver,
    ]);
  });
});

interface Row {
  key: string;
  selectedByDefault: boolean;
  group: string;
  title: string;
  game?: string;
  kind?: 'flight' | 'racing';
  forGames?: string[];
  variant?: { id: string; name: string };
  device?: { model: string };
  check: { type: string; params: Record<string, unknown> };
}
const row = (title: string, group: string, more: Partial<Row> = {}): Row => ({
  key: title,
  selectedByDefault: true,
  group,
  title,
  check: { type: `test.${group}`, params: { name: title } },
  ...more,
});
const gear = (model: string): Row => row(model, 'devices', { device: { model } });
const hornet = { id: 'FA-18C_hornet', name: 'F/A-18C' };
const viper = { id: 'F-16C_50', name: 'F-16C' };
const rig = {
  candidates: [
    gear('VKB Gladiator NXT'),
    gear('FANATEC ClubSport Wheel Base DD+'),
    row('DCS-SRS', 'apps', { kind: 'flight', forGames: ['dcs'] }),
    row('TrackIR software', 'apps'),
    row('Discord', 'apps', { selectedByDefault: false }),
    row('F/A-18C bindings', 'files', { game: 'dcs', variant: hornet }),
    row('F-16C bindings', 'files', { game: 'dcs', variant: viper }),
    row('iRacing settings', 'files', { game: 'iracing' }),
  ],
  tracked: [
    { key: 'dcs-input', selectedByDefault: true, game: 'dcs' },
    { key: 'iracing-app', selectedByDefault: true, game: 'iracing' },
    { key: 'a-tool', selectedByDefault: false },
  ],
  steps: [step([stickPad])],
  games: [
    { id: 'dcs', kind: 'flight' as const },
    { id: 'iracing', kind: 'racing' as const },
    { id: 'ace-combat-8', kind: 'flight' as const, uses: gamepadGame.uses },
  ],
  suggested: { kind: 'flight' as const },
};
const titles = (setup: { kept: Row[] }): string[] => setup.kept.map((c) => c.title);

describe('CFG-PROFILE-022: a new setup before anyone changes a tick, the same for the page and an assistant', () => {
  it('lists the aircraft or cars of a game in the order found, each once', () => {
    expect(variantsOf(rig.candidates, 'dcs')).toEqual([hornet, viper]);
    expect(variantsOf(rig.candidates, 'iracing')).toEqual([]);
  });

  it('for a flight sim: its first aircraft, its gear, its helpers and its own files', () => {
    const setup = proposedSetup(rig, 'dcs');
    expect(setup.variant).toEqual(hornet);
    expect(setup.choice).toMatchObject({ game: 'dcs', variant: hornet.id, family: 'flight' });
    expect(titles(setup)).toEqual([
      'VKB Gladiator NXT',
      'DCS-SRS',
      'TrackIR software',
      'F/A-18C bindings',
    ]);
    expect(setup.tracked.map((t) => t.key)).toEqual(['dcs-input']);
    expect(setup.steps).toEqual([]);
    expect(setup.stepChecks).toEqual([]);
  });

  it('for a racing game: the wheel, and neither flight gear nor a helper made for another game', () => {
    const setup = proposedSetup(rig, 'iracing');
    expect(setup.variant).toBeUndefined();
    expect(titles(setup)).toEqual(['FANATEC ClubSport Wheel Base DD+', 'iRacing settings']);
    expect(setup.tracked.map((t) => t.key)).toEqual(['iracing-app']);
    expect(setup.steps).toEqual([]);
  });

  it('for a game that reads a gamepad: the step with its clear choice, and the check the step needs', () => {
    const setup = proposedSetup(rig, 'ace-combat-8');
    expect(titles(setup)).toEqual(['VKB Gladiator NXT']);
    expect(setup.steps).toEqual([
      {
        id: 'a1',
        title: 'Start a virtual controller',
        type: 'virtual-controller.start',
        params: { profile: 'my-stick', profileName: 'My stick' },
        continueOnError: false,
        delaySeconds: 0,
      },
    ]);
    expect(setup.stepChecks).toEqual([driver]);
    // Two to choose from and none in use: no step, and so no check for it either.
    const unclear = proposedSetup({ ...rig, steps: [step([stickPad, wheelPad])] }, 'ace-combat-8');
    expect(unclear.steps).toEqual([]);
    expect(unclear.stepChecks).toEqual([]);
  });

  it('with no game: what the rig proposes, and nothing that belongs to one game', () => {
    const setup = proposedSetup(
      { candidates: rig.candidates, games: rig.games, suggested: {} },
      ''
    );
    expect(titles(setup)).toEqual([
      'VKB Gladiator NXT',
      'FANATEC ClubSport Wheel Base DD+',
      'DCS-SRS',
      'TrackIR software',
    ]);
    expect(setup.tracked).toEqual([]);
    expect(setup.steps).toEqual([]);
  });

  it('asked for everything, keeps all the page would list for the game, and still nothing of another game or aircraft', () => {
    const setup = proposedSetup(rig, 'dcs', { everything: true });
    expect(titles(setup)).toEqual([
      'VKB Gladiator NXT',
      'FANATEC ClubSport Wheel Base DD+',
      'DCS-SRS',
      'TrackIR software',
      'Discord',
      'F/A-18C bindings',
    ]);
    expect(setup.tracked.map((t) => t.key)).toEqual(['dcs-input']);
  });
});
